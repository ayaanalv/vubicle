// Choosing which passages go to the AI for each tool.
import { search, buildIndex, type Index } from '../lib/search';
import { byCubicle, chunksFor, type StoredChunk, type StoredFile } from './db';
import { embed } from './api';

export interface Scope {
  cubicleId: string;
  /** One chosen file, or all files when undefined. */
  fileId?: string;
}

// The BM25 index is rebuilt only when the set of passages changes.
let cached: { key: string; index: Index } | undefined;
function indexFor(chunks: StoredChunk[]) {
  const key = chunks.length + ':' + (chunks[0]?.id ?? '') + ':' + (chunks.at(-1)?.id ?? '');
  if (cached?.key !== key) cached = { key, index: buildIndex(chunks) };
  return cached.index;
}

export async function findPassages(scope: Scope, query: string, limit = 8): Promise<StoredChunk[]> {
  const chunks = await chunksFor(scope.cubicleId, scope.fileId);
  if (!chunks.length) return [];
  let qv: number[] | undefined;
  if (chunks.some((c) => c.embedding)) qv = (await embed([query.slice(0, 2000)], 'query')).vectors?.[0];
  const ids = search(chunks, query, qv, limit, indexFor(chunks));
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

/** Evenly spaced passages across the scope, preferring ones not in `used`. */
export function spread(chunks: StoredChunk[], n: number, used = new Set<string>()): StoredChunk[] {
  const fresh = chunks.filter((c) => !used.has(c.id) && c.text.length > 80);
  const pool = fresh.length >= n ? fresh : chunks;
  if (pool.length <= n) return pool;
  const step = pool.length / n;
  // A random offset so "make more" does not return the same passages every time.
  const off = Math.random() * step;
  return Array.from({ length: n }, (_, i) => pool[Math.floor(off + i * step)]);
}

export async function fileNames(cubicleId: string): Promise<Map<string, string>> {
  const files: StoredFile[] = await byCubicle('files', cubicleId);
  return new Map(files.map((f) => [f.id, f.name]));
}

export function toPassages(chunks: StoredChunk[], names: Map<string, string>, max = 2000) {
  return chunks.map((c) => ({ label: `${names.get(c.fileId) ?? 'Notes'}, ${c.label}`, text: c.text.slice(0, max) }));
}

/** Syllabus passages most likely to hold dates and weights first. */
export function syllabusPassages(chunks: StoredChunk[], n = 30): StoredChunk[] {
  const score = (t: string) =>
    (t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/gi)?.length ?? 0) * 2 +
    (t.match(/\d+\s?%/g)?.length ?? 0) * 2 +
    (t.match(/\b(exam|midterm|final|quiz|assignment|lab|project|due|test|presentation|weight)/gi)?.length ?? 0);
  return chunks
    .map((c, i) => ({ c, i, s: score(c.text) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.c);
}
