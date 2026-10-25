// Thin clients for Gemini and Groq. Both turn failures into ProviderError so failover can decide what to do.

export interface Prompt {
  system: string;
  user: string;
  /** Ask for a JSON object back. */
  json: boolean;
  maxTokens: number;
  temperature: number;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    /** HTTP status, or 0 for network errors and timeouts. */
    public status: number,
    message: string,
    /** Seconds the provider asked us to wait, when it said. */
    public retryAfter?: number,
  ) {
    super(`${provider}: ${message}`);
  }
  get rateLimited() {
    return this.status === 429;
  }
  /** Worth another try on the same provider: overload, server errors and network failures. */
  get transient() {
    return this.status === 0 || this.status === 408 || this.status >= 500;
  }
}

export type Fetch = typeof fetch;

export interface Provider {
  name: string;
  generate(p: Prompt, signal?: AbortSignal): Promise<string>;
}

function retryAfterHeader(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : undefined;
}

async function send(name: string, f: Fetch, url: string, init: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    throw new ProviderError(name, 0, (e as Error).name === 'AbortError' ? 'timed out' : 'network error');
  }
  const text = await res.text();
  let body: any = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    // Gemini puts the wait in error.details[].retryDelay ("23s"); Groq uses the Retry-After header.
    const delay = body?.error?.details?.find?.((d: any) => d?.retryDelay)?.retryDelay;
    const retryAfter = retryAfterHeader(res) ?? (delay ? parseFloat(delay) : undefined);
    throw new ProviderError(name, res.status, String(body?.error?.message || res.statusText || 'error').slice(0, 300), retryAfter);
  }
  return body;
}

export function gemini(model: string, key: string, f: Fetch = fetch, thinkingLevel = 'low'): Provider {
  const name = `gemini:${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const call = async (p: Prompt, signal: AbortSignal | undefined, thinking: boolean) => {
    const body = {
      systemInstruction: { parts: [{ text: p.system }] },
      contents: [{ role: 'user', parts: [{ text: p.user }] }],
      generationConfig: {
        temperature: p.temperature,
        maxOutputTokens: p.maxTokens,
        ...(p.json ? { responseMimeType: 'application/json' } : {}),
        ...(thinking && thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    };
    const data = await send(name, f, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal,
    });
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || [])
      .filter((part: any) => !part.thought && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('');
    if (!text) {
      const reason = cand?.finishReason || data?.promptFeedback?.blockReason || 'empty response';
      // Safety blocks will not change on retry; an empty response might.
      throw new ProviderError(name, reason === 'SAFETY' || reason === 'BLOCKLIST' ? 422 : 502, `no text (${reason})`);
    }
    return text;
  };
  return {
    name,
    async generate(p, signal) {
      try {
        return await call(p, signal, true);
      } catch (e) {
        // A model that rejects the thinking setting gets one plain retry, so a model swap never breaks the app.
        if (e instanceof ProviderError && e.status === 400 && /think/i.test(e.message)) return call(p, signal, false);
        throw e;
      }
    },
  };
}

export function groq(model: string, key: string, f: Fetch = fetch): Provider {
  const name = `groq:${model}`;
  return {
    name,
    async generate(p, signal) {
      const reasoning = /gpt-oss|qwen3/i.test(model);
      const data = await send(name, f, 'https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: p.system },
            { role: 'user', content: p.user },
          ],
          temperature: p.temperature,
          max_tokens: p.maxTokens,
          ...(p.json ? { response_format: { type: 'json_object' } } : {}),
          ...(reasoning ? { reasoning_effort: 'low', include_reasoning: false } : {}),
        }),
        signal,
      });
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new ProviderError(name, 502, 'no text');
      return text;
    },
  };
}

/** Embeds texts with Gemini. Vectors are L2-normalised so cosine similarity is a dot product. */
export async function geminiEmbed(
  model: string,
  key: string,
  texts: string[],
  kind: 'document' | 'query',
  f: Fetch = fetch,
  signal?: AbortSignal,
): Promise<number[][]> {
  const name = `gemini:${model}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`;
  const data = await send(name, f, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 768,
      })),
    }),
    signal,
  });
  const vecs: number[][] = (data?.embeddings || []).map((e: any) => e.values as number[]);
  if (vecs.length !== texts.length) throw new ProviderError(name, 502, 'wrong number of embeddings');
  return vecs.map((v) => {
    const n = Math.hypot(...v) || 1;
    // Rounded to 4 places: plenty for ranking, and a third of the size in IndexedDB and backups.
    return v.map((x) => Math.round((x / n) * 1e4) / 1e4);
  });
}
