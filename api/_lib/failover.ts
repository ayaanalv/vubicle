// Tries providers in order. Transient failures get a short retry with exponential backoff and full
// jitter; rate limits move straight to the next provider. When every provider is busy, the caller gets
// a BusyError with how long to wait, and the browser queues the request instead of showing an error.
import { ProviderError, type Prompt, type Provider } from './providers.js';

export class BusyError extends Error {
  constructor(public retryAfter: number) {
    super('all providers are busy');
  }
}

/** Every provider failed for a reason waiting will not fix (bad key, unknown model). */
export class UnavailableError extends Error {}

export interface Attempt {
  provider: string;
  status: number;
  ms: number;
}

export interface Options {
  /** Total time we may spend, so the serverless function returns before its own timeout. */
  budgetMs?: number;
  perCallMs?: number;
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Shared per-instance memory of providers that recently said "slow down". */
  cooldowns?: Map<string, number>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const sharedCooldowns = new Map<string, number>();

/** Full jitter: a random wait between 0 and base * 2^attempt, so many retrying clients spread out. */
export const backoff = (attempt: number, base: number, random = Math.random) => Math.round(random() * base * 2 ** attempt);

export interface Candidate {
  provider: Provider;
  /** How many characters of passages this provider's free tier can take in one request. */
  contextChars: number;
}

export async function withFailover<T>(
  candidates: Candidate[],
  buildPrompt: (contextChars: number) => Prompt,
  parse: (text: string) => T,
  opts: Options = {},
): Promise<{ value: T; provider: string; attempts: Attempt[] }> {
  const {
    budgetMs = 45_000,
    perCallMs = 25_000,
    retries = 1,
    baseDelayMs = 500,
    sleep = realSleep,
    random = Math.random,
    now = Date.now,
    cooldowns = sharedCooldowns,
  } = opts;
  const start = now();
  const attempts: Attempt[] = [];
  let busyFor: number | undefined;
  let sawBusy = false;

  for (const { provider, contextChars } of candidates) {
    const cool = cooldowns.get(provider.name);
    if (cool && cool > now()) {
      sawBusy = true;
      busyFor = Math.min(busyFor ?? Infinity, (cool - now()) / 1000);
      continue;
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
      const left = budgetMs - (now() - start);
      if (left < 2000) break;
      const t0 = now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(perCallMs, left));
      try {
        const text = await provider.generate(buildPrompt(contextChars), ctrl.signal);
        const value = parse(text);
        attempts.push({ provider: provider.name, status: 200, ms: now() - t0 });
        cooldowns.delete(provider.name);
        return { value, provider: provider.name, attempts };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError(provider.name, 502, (e as Error).message);
        attempts.push({ provider: provider.name, status: err.status, ms: now() - t0 });
        if (err.rateLimited) {
          sawBusy = true;
          const wait = err.retryAfter ?? 20;
          busyFor = Math.min(busyFor ?? Infinity, wait);
          cooldowns.set(provider.name, now() + wait * 1000);
          break; // next provider
        }
        if (!err.transient) break; // config or content problem: next provider, no retry
        sawBusy = true;
        if (attempt < retries) await sleep(backoff(attempt, baseDelayMs, random));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  if (sawBusy || now() - start >= budgetMs - 2000) throw new BusyError(Math.ceil(Math.min(60, Math.max(3, busyFor ?? 10))));
  throw new UnavailableError('no AI provider could handle the request');
}
