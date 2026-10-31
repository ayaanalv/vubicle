// Request handling shared by /api/ai and /api/embed, written against plain Request/Response so tests
// can call it with a fake fetch and an in-memory store.
import { config as readConfig } from './config.js';
import { gemini, groq, geminiEmbed, ProviderError, type Fetch } from './providers.js';
import { withFailover, BusyError, UnavailableError, type Candidate, type Options } from './failover.js';
import { hit, personKey, memoryStore, upstashStore, type Store } from './ratelimit.js';
import { plan, isTask, BadRequest, extractJson } from './tasks.js';

type Config = ReturnType<typeof readConfig>;

export interface Deps {
  config: Config;
  store: Store;
  fetch?: Fetch;
  failover?: Options;
  log?: (entry: Record<string, unknown>) => void;
}

let defaultStore: Store | undefined;
export function defaultDeps(): Deps {
  const config = readConfig();
  defaultStore ??= config.redisUrl && config.redisToken ? upstashStore(config.redisUrl, config.redisToken) : memoryStore();
  return { config, store: defaultStore, log: (e) => console.log(JSON.stringify(e)) };
}

const MAX_BODY = 300_000;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** Only Vubicle's own pages may call the API. Origin can be forged outside a browser, so the hourly cap still applies. */
export function originAllowed(origin: string | null, c: Config): boolean {
  if (!origin) return false;
  if (c.allowedOrigins.includes(origin)) return true;
  return !c.production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function clientIp(req: Request): string {
  return (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim();
}

async function readBody(req: Request, c: Config): Promise<{ body?: any; error?: Response }> {
  if (req.method !== 'POST') return { error: json(405, { error: 'method', message: 'Use POST.' }, { allow: 'POST' }) };
  if (!originAllowed(req.headers.get('origin'), c)) return { error: json(403, { error: 'origin', message: 'This API only serves vubicle.com.' }) };
  if (!(req.headers.get('content-type') || '').includes('application/json')) return { error: json(415, { error: 'type', message: 'Send JSON.' }) };
  const text = await req.text();
  if (text.length > MAX_BODY) return { error: json(413, { error: 'size', message: 'That request is too large.' }) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json(400, { error: 'json', message: 'The request was not valid JSON.' }) };
  }
}

function candidates(c: Config, f: Fetch | undefined): Candidate[] {
  const out: Candidate[] = [];
  // Gemini's free tier takes long prompts; Groq's free tier has a small tokens-per-minute budget, so send it less.
  if (c.geminiKey) for (const m of c.geminiModels) out.push({ provider: gemini(m, c.geminiKey, f, c.geminiThinking), contextChars: 40_000 });
  if (c.groqKey) out.push({ provider: groq(c.groqModel, c.groqKey, f), contextChars: 12_000 });
  return out;
}

const busy = (retryAfter: number, reason: 'busy' | 'cap', message: string) =>
  json(429, { error: reason, retryAfter, message }, { 'retry-after': String(retryAfter) });

export async function handleAi(req: Request, deps: Deps): Promise<Response> {
  const { config: c, store } = deps;
  const { body, error } = await readBody(req, c);
  if (error) return error;
  if (!isTask(body?.task)) return json(400, { error: 'task', message: 'Unknown task.' });

  let p;
  try {
    p = plan(body.task, body);
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: 'input', message: e.message });
    throw e;
  }

  const list = candidates(c, deps.fetch);
  if (!list.length) return json(503, { error: 'config', message: 'The AI service is not set up yet.' });

  const quota = await hit(store, personKey(clientIp(req), c.ipSalt), c.hourlyCap);
  if (!quota.allowed) {
    return busy(quota.resetIn, 'cap', `You have used this hour's ${c.hourlyCap} AI requests. More open up in ${Math.ceil(quota.resetIn / 60)} min.`);
  }

  const t0 = Date.now();
  try {
    const out = await withFailover(list, p.prompt, (text) => p.parse(extractJson(text)), deps.failover);
    deps.log?.({ task: body.task, provider: out.provider, attempts: out.attempts, ms: Date.now() - t0 });
    return json(200, { result: out.value, provider: out.provider.split(':')[0] }, { 'x-remaining': String(quota.remaining) });
  } catch (e) {
    if (e instanceof BusyError) {
      await quota.refund();
      deps.log?.({ task: body.task, busy: e.retryAfter, attempts: e.attempts, ms: Date.now() - t0 });
      return busy(e.retryAfter, 'busy', 'The free AI services are busy right now.');
    }
    if (e instanceof UnavailableError) {
      await quota.refund();
      deps.log?.({ task: body.task, unavailable: true, attempts: e.attempts });
      return json(503, { error: 'unavailable', message: 'The AI service could not answer. Try again later.' });
    }
    throw e;
  }
}

export async function handleEmbed(req: Request, deps: Deps): Promise<Response> {
  const { config: c, store } = deps;
  const { body, error } = await readBody(req, c);
  if (error) return error;
  const texts = body?.texts;
  const kind = body?.kind === 'query' ? 'query' : 'document';
  if (!Array.isArray(texts) || !texts.length || texts.length > 64 || !texts.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 2000)) {
    return json(400, { error: 'input', message: 'Send 1 to 64 texts of at most 2000 characters.' });
  }
  if (!c.geminiKey) return json(503, { error: 'config', message: 'Embeddings are not set up. Keyword search still works.' });

  // Embeddings have their own, larger allowance: a long PDF needs several batches.
  const quota = await hit(store, personKey(clientIp(req), c.ipSalt) + ':emb', c.hourlyCap * 5);
  if (!quota.allowed) return busy(quota.resetIn, 'cap', 'Embedding limit reached for this hour. Keyword search still works.');

  try {
    const vectors = await geminiEmbed(c.geminiEmbedModel, c.geminiKey, texts, kind, deps.fetch, AbortSignal.timeout(20_000));
    return json(200, { vectors });
  } catch (e) {
    await quota.refund();
    if (e instanceof ProviderError && (e.rateLimited || e.transient)) return busy(Math.ceil(e.retryAfter ?? 20), 'busy', 'Embeddings are busy. Keyword search still works.');
    deps.log?.({ embed: 'failed', status: e instanceof ProviderError ? e.status : 'error' });
    return json(503, { error: 'unavailable', message: 'Embeddings are unavailable. Keyword search still works.' });
  }
}
