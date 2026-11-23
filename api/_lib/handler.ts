// Request handling shared by /api/ai and /api/embed, written against plain Request/Response so tests
// can call it with a fake fetch and an in-memory store.
import { config as readConfig } from './config.js';
import { gemini, groq, geminiEmbed, ProviderError, type Fetch } from './providers.js';
import { withFailover, BusyError, UnavailableError, type Candidate, type Options } from './failover.js';
import { take, personKey, memoryStore, upstashStore, type Store, type Limit } from './ratelimit.js';
import { issueToken, checkToken, tokenSecret } from './token.js';
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

// Room for one photo the browser has shrunk to about 400 KB (base64 adds a third). Each task checks its own fields.
const MAX_BODY = 1_000_000;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** Header the browser sends its token in (src/app/api.ts). */
export const TOKEN_HEADER = 'x-vubicle-token';

/** Tokens a person may get per rolling hour. One lasts 15 minutes, so a tab needs about 4; this leaves room for more tabs and IP changes. */
const TOKENS_PER_HOUR = 30;
/** Embedding characters a person may send per rolling hour: about a 600-page course. */
const EMBED_CHARS_PER_HOUR = 1_000_000;

/**
 * Only Vubicle's own pages may call the API. Origin is a plain header anyone outside a browser can set, so
 * this is only a cheap first filter; the signed token and the rate limits do the real work.
 */
export function originAllowed(origin: string | null, c: Config): boolean {
  if (!origin) return false;
  if (c.allowedOrigins.includes(origin)) return true;
  return !c.production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/**
 * The caller's IP, for rate limits and tokens. Vercel sets x-vercel-forwarded-for itself and drops any copy the
 * caller sent. Elsewhere, the last x-forwarded-for entry is the one the nearest proxy added; earlier entries
 * can be typed by the caller, so taking the first one would let anyone pick a fresh IP for every request.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const vercel = h.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  const forwarded = h.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return vercel || forwarded || h.get('x-real-ip')?.trim() || 'unknown';
}

const notReady = () => json(503, { error: 'config', message: 'The AI service is not set up yet.' });

/** Checks the signed token. Returns an error response, or undefined when the token is good. */
function tokenProblem(req: Request, c: Config, log?: Deps['log']): Response | undefined {
  const secret = tokenSecret(c, log);
  if (!secret) return notReady();
  const check = checkToken(req.headers.get(TOKEN_HEADER), personKey(clientIp(req), c.ipSalt), secret);
  if (check === 'ok') return undefined;
  return json(401, { error: 'token', reason: check, message: 'Your session needs refreshing. Reload the page if this keeps happening.' });
}

function checkCaller(req: Request, c: Config): Response | undefined {
  if (req.method !== 'POST') return json(405, { error: 'method', message: 'Use POST.' }, { allow: 'POST' });
  if (!originAllowed(req.headers.get('origin'), c)) return json(403, { error: 'origin', message: 'This API only serves vubicle.com.' });
}

/** The checks every AI and embedding request passes before its body is read: method, origin, then token. */
export function refuseCaller(req: Request, c: Config, log?: Deps['log']): Response | undefined {
  return checkCaller(req, c) ?? tokenProblem(req, c, log);
}

async function readBody(req: Request, c: Config, log?: Deps['log']): Promise<{ body?: any; error?: Response }> {
  const refused = refuseCaller(req, c, log);
  if (refused) return { error: refused };
  if (!(req.headers.get('content-type') || '').includes('application/json')) return { error: json(415, { error: 'type', message: 'Send JSON.' }) };
  const text = await req.text();
  if (text.length > MAX_BODY) return { error: json(413, { error: 'size', message: 'That request is too large.' }) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json(400, { error: 'json', message: 'The request was not valid JSON.' }) };
  }
}

function candidates(c: Config, f: Fetch | undefined, vision = false): Candidate[] {
  const out: Candidate[] = [];
  // Gemini's free tier takes long prompts; Groq's free tier has a small tokens-per-minute budget, so send it less.
  if (c.geminiKey) for (const m of c.geminiModels) out.push({ provider: gemini(m, c.geminiKey, f, c.geminiThinking), contextChars: 40_000 });
  if (c.groqKey) out.push({ provider: groq(vision ? c.groqVisionModel : c.groqModel, c.groqKey, f), contextChars: 12_000 });
  return out;
}

const busy = (retryAfter: number, reason: 'busy' | 'cap', message: string) =>
  json(429, { error: reason, retryAfter, message }, { 'retry-after': String(retryAfter) });

const minutes = (s: number) => (s < 5400 ? `${Math.ceil(s / 60)} min` : `${Math.round(s / 3600)} h`);

/** Hands the page a short-lived token for /api/ai and /api/embed. */
export async function handleToken(req: Request, deps: Deps): Promise<Response> {
  const { config: c, store } = deps;
  const refused = checkCaller(req, c);
  if (refused) return refused;
  const secret = tokenSecret(c, deps.log);
  if (!secret) return notReady();
  const person = personKey(clientIp(req), c.ipSalt);
  // Local servers (npm run dev, the browser tests) skip this limit: every test browser there has the same
  // address, so one full test run used up the hour's tokens and later tests waited in line. Every Vercel
  // deployment, production or preview, keeps it (the same "is local" rule as the development secret).
  if (!c.localDev) {
    const quota = await take(store, person, [{ name: 'tok', cap: TOKENS_PER_HOUR, windowSec: 3600 }]);
    if (!quota.allowed) return busy(quota.resetIn, 'cap', `Too many sessions started from this address. Try again in ${minutes(quota.resetIn)}.`);
  }
  return json(200, issueToken(person, secret));
}

export async function handleAi(req: Request, deps: Deps): Promise<Response> {
  const { config: c, store } = deps;
  const { body, error } = await readBody(req, c, deps.log);
  if (error) return error;
  if (!isTask(body?.task)) return json(400, { error: 'task', message: 'Unknown task.' });

  let p;
  try {
    p = plan(body.task, body);
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: 'input', message: e.message });
    throw e;
  }

  const list = candidates(c, deps.fetch, body.task === 'image');
  if (!list.length) return notReady();

  const limits: Limit[] = [
    { name: 'ai-h', cap: c.hourlyCap, windowSec: 3600 },
    { name: 'ai-d', cap: c.dailyCap, windowSec: 86_400 },
  ];
  const quota = await take(store, personKey(clientIp(req), c.ipSalt), limits);
  if (!quota.allowed) {
    const message =
      quota.blockedBy === 'ai-d'
        ? `You have used today's ${c.dailyCap} AI requests. More open up in about ${minutes(quota.resetIn)}.`
        : `You have used the ${c.hourlyCap} AI requests allowed per hour. The next one opens in ${minutes(quota.resetIn)}.`;
    return busy(quota.resetIn, 'cap', message);
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
  const { body, error } = await readBody(req, c, deps.log);
  if (error) return error;
  const texts = body?.texts;
  const kind = body?.kind === 'query' ? 'query' : 'document';
  if (!Array.isArray(texts) || !texts.length || texts.length > 64 || !texts.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 2000)) {
    return json(400, { error: 'input', message: 'Send 1 to 64 texts of at most 2000 characters.' });
  }
  if (!c.geminiKey) return json(503, { error: 'config', message: 'Embeddings are not set up. Keyword search still works.' });

  // Embeddings have their own allowance, so indexing a long PDF never uses up study requests: a count of
  // requests (a 250-page course is about 20 batches, plus one per search) and a count of characters.
  const chars = texts.reduce((n: number, t: string) => n + t.length, 0);
  const quota = await take(store, personKey(clientIp(req), c.ipSalt), [
    { name: 'emb-h', cap: c.hourlyCap * 2, windowSec: 3600 },
    { name: 'emb-chars', cap: EMBED_CHARS_PER_HOUR, windowSec: 3600, amount: chars },
  ]);
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
