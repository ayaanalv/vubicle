// Per-person limits, counted in Upstash Redis so every serverless instance sees the same count. Without
// Redis configured it falls back to memory.
//
// Each limit is a sliding window: the count for the current window plus the previous window's count, scaled
// by how much of it still overlaps the last windowSec seconds. A fixed window let someone use the whole cap
// just before the hour turned and again just after it, twice the cap in a few minutes; this does not.
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';

export interface Store {
  /** Adds `by` to `key` (which expires after ttlSec) and returns its new value and the current value of `other`. */
  add(key: string, by: number, ttlSec: number, other: string): Promise<[number, number]>;
  /** Takes `by` off `key`. Never goes below zero and never creates a missing key. */
  sub(key: string, by: number): Promise<void>;
}

export function memoryStore(now = Date.now): Store {
  // shortcut: per-instance only, so a person can exceed the cap across instances; configure Upstash for production.
  const m = new Map<string, { n: number; exp: number }>();
  const live = (key: string) => {
    const cur = m.get(key);
    return cur && cur.exp > now() ? cur : undefined;
  };
  return {
    async add(key, by, ttlSec, other) {
      const t = now();
      const entry = live(key) ?? { n: 0, exp: t + ttlSec * 1000 };
      entry.n += by;
      m.set(key, entry);
      if (m.size > 10_000) for (const [k, v] of m) if (v.exp <= t) m.delete(k);
      return [entry.n, live(other)?.n ?? 0];
    },
    async sub(key, by) {
      const cur = live(key);
      if (cur) cur.n = Math.max(0, cur.n - by);
    },
  };
}

// Atomic "decrement, but not below zero": a refund that arrives after the key expired must not leave a
// negative count (or a key with no expiry) behind.
const SUB = `local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v <= 0 then return 0 end
return redis.call('DECRBY', KEYS[1], math.min(v, tonumber(ARGV[1])))`;

export function upstashStore(url: string, token: string): Store {
  const redis = new Redis({ url, token });
  return {
    async add(key, by, ttlSec, other) {
      const [n, , o] = await redis.multi().incrby(key, by).expire(key, ttlSec, 'NX').get(other).exec<[number, number, unknown]>();
      return [Number(n), Number(o) || 0];
    },
    async sub(key, by) {
      await redis.eval(SUB, [key], [by]);
    },
  };
}

/** Hashing keeps raw IP addresses out of the store. */
export const personKey = (ip: string, salt = '') => createHash('sha256').update(salt + ip).digest('hex').slice(0, 24);

export interface Limit {
  /** Part of the store key, and what `blockedBy` reports. */
  name: string;
  cap: number;
  windowSec: number;
  /** How much this request uses: 1 for a request, or a character count. Default 1. */
  amount?: number;
}

export interface Hit {
  allowed: boolean;
  /** The limit that said no, when one did. */
  blockedBy?: string;
  /** Requests left under the first limit. */
  remaining: number;
  /** Seconds until this request would be allowed. 0 when allowed. */
  resetIn: number;
  /** Gives the request back, for requests that never reached a model (everyone busy). */
  refund(): Promise<void>;
}

/** Seconds until `amount` more fits under `cap`, given the counts before this request. */
function waitFor(cap: number, amount: number, cur: number, prev: number, elapsed: number, windowSec: number): number {
  if (amount > cap) return windowSec * 2;
  // Still inside this window: wait for enough of the previous window's count to slide out.
  if (cur + amount <= cap && prev > 0) return Math.max(1, Math.ceil((1 - (cap - cur - amount) / prev - elapsed) * windowSec));
  // Not this window: in the next one, this window's count becomes the one sliding out.
  const into = cur > 0 ? Math.max(0, 1 - (cap - amount) / cur) : 0;
  return Math.max(1, Math.ceil((1 - elapsed + into) * windowSec));
}

/** Counts one request against every limit. If any limit says no, nothing is counted. */
export async function take(store: Store, person: string, limits: Limit[], now = Date.now()): Promise<Hit> {
  const taken: { key: string; amount: number }[] = [];
  let remaining = Infinity;
  let blocked: { name: string; resetIn: number } | undefined;
  for (const l of limits) {
    const amount = l.amount ?? 1;
    const w = l.windowSec * 1000;
    const idx = Math.floor(now / w);
    const elapsed = (now - idx * w) / w;
    const key = `rl:${l.name}:${person}:${idx}`;
    const [cur, prev] = await store.add(key, amount, l.windowSec * 2 + 60, `rl:${l.name}:${person}:${idx - 1}`);
    taken.push({ key, amount });
    const estimate = cur + prev * (1 - elapsed);
    if (remaining === Infinity) remaining = Math.max(0, Math.floor(l.cap - estimate));
    if (estimate > l.cap) {
      const resetIn = waitFor(l.cap, amount, cur - amount, prev, elapsed, l.windowSec);
      if (!blocked || resetIn > blocked.resetIn) blocked = { name: l.name, resetIn };
    }
  }
  // Best effort: a refund that fails only leaves a count slightly high, which must not turn a 429 into a 500.
  const refund = async () => {
    await Promise.all(taken.map((t) => store.sub(t.key, t.amount).catch((e) => console.error(JSON.stringify({ refund: 'failed', error: String(e) })))));
  };
  if (blocked) {
    await refund();
    return { allowed: false, blockedBy: blocked.name, remaining: 0, resetIn: blocked.resetIn, refund: async () => {} };
  }
  return { allowed: true, remaining: remaining === Infinity ? 0 : remaining, resetIn: 0, refund };
}
