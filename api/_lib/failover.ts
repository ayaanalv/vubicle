// Tries providers in order, every provider once before anyone is retried, so one slow or overloaded
// model can never use up the time the backups need. Rate limits and failures bench a provider for a
// while (a circuit breaker), so later requests skip it straight away. Transient failures get one more
// try after an exponential backoff with full jitter. When every provider is busy, the caller gets a
// BusyError with how long to wait, and the browser queues the request instead of showing an error.
import { ProviderError, type Prompt, type Provider } from './providers.js';

export interface Attempt {
  provider: string;
  status: number;
  ms: number;
}

export class BusyError extends Error {
  constructor(
    public retryAfter: number,
    public attempts: Attempt[] = [],
  ) {
    super('all providers are busy');
  }
}

/** Every provider failed for a reason waiting will not fix (bad key, unknown model). */
export class UnavailableError extends Error {
  constructor(public attempts: Attempt[] = []) {
    super('no AI provider could handle the request');
  }
}

export interface Options {
  /** Total time we may spend, so the serverless function returns before its own timeout. */
  budgetMs?: number;
  /** Longest wait for one provider call; a model that hangs past this counts as down. */
  perCallMs?: number;
  /** Extra passes over providers that failed transiently. */
  retries?: number;
  baseDelayMs?: number;
  /** How long a provider that timed out or returned 5xx is skipped, in seconds. */
  benchSec?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** Shared per-instance memory: provider name → time until which it is skipped. */
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
    budgetMs = 50_000,
    perCallMs = 15_000,
    retries = 1,
    baseDelayMs = 500,
    benchSec = 30,
    sleep = realSleep,
    random = Math.random,
    now = Date.now,
    cooldowns = sharedCooldowns,
  } = opts;
  const start = now();
  const attempts: Attempt[] = [];
  /** Shortest time, in seconds, until some provider is worth asking again. */
  let soonest = Infinity;
  const bench = (name: string, sec: number) => {
    cooldowns.set(name, now() + sec * 1000);
    soonest = Math.min(soonest, sec);
  };

  // Providers on the bench are skipped on the first pass; it only takes them back if nothing else is left.
  let queue = candidates.filter(({ provider }) => {
    const until = cooldowns.get(provider.name) ?? 0;
    if (until <= now()) return true;
    soonest = Math.min(soonest, (until - now()) / 1000);
    return false;
  });

  for (let pass = 0; pass <= retries && queue.length; pass++) {
    if (pass > 0) await sleep(backoff(pass - 1, baseDelayMs, random));
    const again: Candidate[] = [];
    for (const c of queue) {
      const left = budgetMs - (now() - start);
      if (left < 2000) break;
      const t0 = now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(perCallMs, left));
      try {
        const value = parse(await c.provider.generate(buildPrompt(c.contextChars), ctrl.signal));
        attempts.push({ provider: c.provider.name, status: 200, ms: now() - t0 });
        cooldowns.delete(c.provider.name);
        return { value, provider: c.provider.name, attempts };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError(c.provider.name, 502, (e as Error).message);
        attempts.push({ provider: c.provider.name, status: err.status, ms: now() - t0 });
        if (err.rateLimited) bench(c.provider.name, err.retryAfter ?? 20);
        else if (err.transient) {
          // A call that hung to the timeout is benched longer than a quick 5xx: hanging costs the most time.
          bench(c.provider.name, err.status === 0 ? benchSec * 4 : benchSec);
          again.push(c);
        }
        // Anything else (bad key, unknown model, blocked content) will not improve by waiting: drop it.
      } finally {
        clearTimeout(timer);
      }
    }
    queue = again;
  }

  if (Number.isFinite(soonest) || now() - start >= budgetMs - 2000) {
    // The browser waits this long before asking again; clamped so a long provider hint never strands it.
    throw new BusyError(Math.ceil(Math.min(60, Math.max(3, Number.isFinite(soonest) ? soonest : 10))), attempts);
  }
  throw new UnavailableError(attempts);
}
