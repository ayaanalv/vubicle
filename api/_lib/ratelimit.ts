// Per-person hourly cap. A fixed one-hour window per hashed IP, counted in Upstash Redis so every
// serverless instance sees the same count. Without Redis configured it falls back to memory.
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';

export interface Store {
  /** Increments the key and returns the new count; the key expires after ttlSec. */
  incr(key: string, ttlSec: number): Promise<number>;
  decr(key: string): Promise<void>;
}

export function memoryStore(now = Date.now): Store {
  // shortcut: per-instance only, so a person can exceed the cap across instances; configure Upstash for production.
  const m = new Map<string, { n: number; exp: number }>();
  return {
    async incr(key, ttlSec) {
      const t = now();
      const cur = m.get(key);
      const entry = cur && cur.exp > t ? cur : { n: 0, exp: t + ttlSec * 1000 };
      entry.n++;
      m.set(key, entry);
      if (m.size > 10_000) for (const [k, v] of m) if (v.exp <= t) m.delete(k);
      return entry.n;
    },
    async decr(key) {
      const cur = m.get(key);
      if (cur && cur.n > 0) cur.n--;
    },
  };
}

export function upstashStore(url: string, token: string): Store {
  const redis = new Redis({ url, token });
  return {
    async incr(key, ttlSec) {
      const [n] = await redis.multi().incr(key).expire(key, ttlSec, 'NX').exec<[number, number]>();
      return n;
    },
    async decr(key) {
      await redis.decr(key);
    },
  };
}

export interface Verdict {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  resetIn: number;
}

/** Hashing keeps raw IP addresses out of the store. */
export const personKey = (ip: string, salt = '') => createHash('sha256').update(salt + ip).digest('hex').slice(0, 24);

export interface Hit extends Verdict {
  /** Gives the request back, for requests that never reached a model (everyone busy). */
  refund(): Promise<void>;
}

export async function hit(store: Store, person: string, cap: number, now = Date.now()): Promise<Hit> {
  const hour = Math.floor(now / 3_600_000);
  const resetIn = Math.ceil(((hour + 1) * 3_600_000 - now) / 1000);
  const key = `rl:${person}:${hour}`;
  const n = await store.incr(key, resetIn + 60);
  return { allowed: n <= cap, remaining: Math.max(0, cap - n), resetIn, refund: () => store.decr(key) };
}
