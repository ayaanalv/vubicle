// Browser side of the AI API. When the free tiers are busy the request waits in line: it retries with
// exponential backoff and jitter, and the line shows a countdown. Nothing here throws "rate limited".
import { useSyncExternalStore } from 'react';
import { cacheGet, cacheSet } from './db';

export class AiError extends Error {}

export interface Waiting {
  id: number;
  label: string;
  /** When the next try happens, ms since epoch. */
  until: number;
  reason: 'busy' | 'cap' | 'network';
  tries: number;
}

// ---- the line: a tiny external store React can subscribe to ----

let line: Waiting[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const setLine = (next: Waiting[]) => {
  line = next;
  emit();
};
export function useLine() {
  return useSyncExternalStore(
    (cb) => (subs.add(cb), () => subs.delete(cb)),
    () => line,
  );
}

let nextId = 1;
const MAX_WAIT_MS = 10 * 60_000;

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('cancelled', 'AbortError'));
    });
  });
}

/** Wait before the next try: the server's hint, or exponential backoff, plus up to 30% jitter. */
export function nextDelay(tries: number, retryAfterSec?: number, random = Math.random): number {
  const base = retryAfterSec ? retryAfterSec * 1000 : Math.min(60_000, 2000 * 2 ** tries);
  return Math.round(base * (1 + random() * 0.3));
}

async function hash(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf.slice(0, 16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AiOptions {
  /** What the line shows, e.g. "Answering your question". */
  label: string;
  /** Reuse a saved answer to an identical request. */
  cache?: boolean;
  signal?: AbortSignal;
}

export async function ai<T>(task: string, body: Record<string, unknown>, opts: AiOptions): Promise<T> {
  const payload = JSON.stringify({ task, ...body });
  const key = opts.cache ? `ai:${await hash(payload)}` : '';
  if (key) {
    const hit = await cacheGet<T>(key);
    if (hit !== undefined) return hit;
  }

  const id = nextId++;
  const started = Date.now();
  let tries = 0;
  try {
    for (;;) {
      let res: Response | undefined;
      try {
        res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: opts.signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        if (!navigator.onLine) throw new AiError('You are offline. Your files and saved cards still work; AI tools need a connection.');
      }
      if (res?.ok) {
        const { result } = await res.json();
        if (key) await cacheSet(key, result);
        return result as T;
      }
      let info: { error?: string; message?: string; retryAfter?: number } = {};
      if (res) info = await res.json().catch(() => ({}));
      const reason = !res ? 'network' : res.status === 429 ? (info.error === 'cap' ? 'cap' : 'busy') : null;
      if (!reason) throw new AiError(info.message || 'Something went wrong. Try again in a moment.');
      const wait = nextDelay(tries, reason === 'network' ? undefined : info.retryAfter);
      // An hourly cap that resets far in the future is not worth waiting in line for.
      if (reason === 'cap' && wait > 3 * 60_000) throw new AiError(info.message || 'You have reached this hour’s limit.');
      if (Date.now() - started + wait > MAX_WAIT_MS) throw new AiError('The free AI services are still busy. Try again in a few minutes.');
      tries++;
      setLine([...line.filter((w) => w.id !== id), { id, label: opts.label, until: Date.now() + wait, reason, tries }]);
      await sleep(wait, opts.signal);
    }
  } finally {
    if (line.some((w) => w.id === id)) setLine(line.filter((w) => w.id !== id));
  }
}

/** One try only: callers fall back to keyword search when this returns null. */
export async function embed(texts: string[], kind: 'document' | 'query', signal?: AbortSignal): Promise<{ vectors?: number[][]; retryAfter?: number }> {
  try {
    const res = await fetch('/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts, kind }), signal });
    if (res.ok) return { vectors: (await res.json()).vectors };
    if (res.status === 429) return { retryAfter: Number((await res.json().catch(() => ({}))).retryAfter) || 30 };
    return {};
  } catch {
    return {};
  }
}
