// Browser side of the AI API. When the free tiers are busy the request waits in line: it retries with
// exponential backoff and jitter, and the line shows the real time until the next try, or "trying now"
// while a try is in flight. Long waits are stated plainly, and every wait can be cancelled.
import { useSyncExternalStore } from 'react';
import { cacheGet, cacheSet } from './db';

export class AiError extends Error {}
/** The student pressed Cancel while waiting in line. */
export class CancelledError extends AiError {
  constructor() {
    super('Cancelled. Nothing else will be sent for this request.');
  }
}

export interface Waiting {
  id: number;
  label: string;
  reason: 'busy' | 'cap' | 'network';
  /** "waiting" until `until`, then "trying" while the next request is in flight. */
  state: 'waiting' | 'trying';
  /** When the next try happens, ms since epoch. */
  until: number;
  /** When this request first had to wait, ms since epoch. */
  since: number;
  tries: number;
  cancel: () => void;
}

// ---- the line, and how many generation requests are running: tiny stores React can subscribe to ----

let line: Waiting[] = [];
let running = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
const setLine = (next: Waiting[]) => {
  line = next;
  emit();
};
const subscribe = (cb: () => void) => (subs.add(cb), () => subs.delete(cb));
export const useLine = () => useSyncExternalStore(subscribe, () => line);
export const getLine = () => line;

/** True while any generation request is in flight or waiting in line. Background indexing yields to it. */
export const generating = () => running > 0;

/** Resolves once no generation request is running. */
export function whenIdle(): Promise<void> {
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const un = subscribe(() => {
      if (!running) {
        un();
        resolve();
      }
    });
  });
}

let nextId = 1;
/** Give up on a busy service after this long; an hourly cap is waited out instead, since it has a known end. */
const MAX_BUSY_WAIT_MS = 20 * 60_000;

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });
}

/** Wait before the next try: the server's hint, or exponential backoff, plus up to 30% jitter. Never under 1s. */
export function nextDelay(tries: number, retryAfterSec?: number, random = Math.random): number {
  const base = retryAfterSec && retryAfterSec > 0 ? retryAfterSec * 1000 : Math.min(60_000, 2000 * 2 ** tries);
  return Math.max(1000, Math.round(base * (1 + random() * 0.3)));
}

/** "8s", "2 min 5s", "41 min", "1 h 2 min". Rounds up, so it never shows 0 while there is still a wait. */
export function formatWait(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (s < 600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60}s` : ''}`;
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
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
  /** Aborted when the tool goes away; ends the request silently with an AbortError. */
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
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort(new DOMException('cancelled', 'AbortError'));
  if (opts.signal?.aborted) onOuterAbort();
  opts.signal?.addEventListener('abort', onOuterAbort);
  const update = (patch: Partial<Waiting>) => setLine(line.map((w) => (w.id === id ? { ...w, ...patch } : w)));

  running++;
  emit();
  let since = 0;
  let tries = 0;
  try {
    for (;;) {
      let res: Response | undefined;
      try {
        res = await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal: ctrl.signal });
      } catch {
        if (ctrl.signal.aborted) throw ctrl.signal.reason;
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
      const retryHeader = Number(res?.headers.get('retry-after'));
      const wait = nextDelay(tries, reason === 'network' ? undefined : info.retryAfter ?? (retryHeader || undefined));
      since ||= Date.now();
      if (reason !== 'cap' && Date.now() - since + wait > MAX_BUSY_WAIT_MS) {
        throw new AiError('Both free AI services have been busy for 20 minutes, so Vubicle stopped waiting. Try again later; your files and saved work are fine.');
      }
      tries++;
      const entry: Waiting = { id, label: opts.label, reason, state: 'waiting', until: Date.now() + wait, since, tries, cancel: () => ctrl.abort(new CancelledError()) };
      setLine(line.some((w) => w.id === id) ? line.map((w) => (w.id === id ? entry : w)) : [...line, entry]);
      await sleep(wait, ctrl.signal);
      update({ state: 'trying' });
    }
  } finally {
    opts.signal?.removeEventListener('abort', onOuterAbort);
    running--;
    setLine(line.filter((w) => w.id !== id));
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
