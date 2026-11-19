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

/**
 * Questions that ask for a judgment or an overview of the material rather than one fact, and requests about
 * a whole assignment ("solve this assignment", "write the code for me"). Their words rarely match the spec,
 * so keyword search alone can find nothing and the model would never see the assignment.
 */
export function isBroadQuestion(q: string): boolean {
  return /\b(hardest|toughest|trickiest|most (important|difficult|confusing|tested)|key (ideas?|points?|concepts?|takeaways?)|main (ideas?|points?|topics?)|focus on|study first|prioriti[sz]e|summar(y|i[sz]e)|overview|big picture|on the (exam|test|midterm|final)|likely (to be )?(tested|asked|on)|exam|what should i know|assignments?|homework|labs?|projects?|solve|(write|code|finish|complete) (it|this|that|out|the|my)\b)/i.test(q);
}

/** Keyword hits first, then passages spread across the scope, in reading order. */
export async function broadPassages(scope: Scope, query: string, limit = 10): Promise<StoredChunk[]> {
  const all = await chunksFor(scope.cubicleId, scope.fileId);
  const hits = (await findPassages(scope, query, 4)).slice(0, 4);
  const picked = new Set(hits.map((c) => c.id));
  const rest = spread(all, limit - hits.length, picked).filter((c) => !picked.has(c.id));
  const order = new Map(all.map((c, i) => [c.id, i]));
  return [...hits, ...rest].slice(0, limit).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Evenly spaced passages across the scope, preferring ones not in `used`. */
export function spread(chunks: StoredChunk[], n: number, used = new Set<string>(), random = Math.random): StoredChunk[] {
  const fresh = chunks.filter((c) => !used.has(c.id) && c.text.length > 80);
  const pool = fresh.length >= n ? fresh : chunks;
  if (pool.length <= n) return pool;
  const step = pool.length / n;
  // A random offset so "make more" does not return the same passages every time.
  const off = random() * step;
  return Array.from({ length: n }, (_, i) => pool[Math.floor(off + i * step)]);
}

/**
 * For new flashcards: passages with the fewest cards so far come first, so new cards come from material
 * that is not covered yet. Within each level they are spread evenly across the material and kept in
 * reading order. Very short passages are used only when nothing else is left. The order matters: the
 * model reads the first passages first, and a provider with a small budget drops the last ones.
 */
export function byCoverage(chunks: StoredChunk[], cardsPer: Map<string, number>, n: number, random = Math.random): StoredChunk[] {
  const long = chunks.filter((c) => c.text.length > 80);
  const pool = long.length >= n ? long : chunks;
  const levels = new Map<number, StoredChunk[]>();
  for (const c of pool) {
    const k = cardsPer.get(c.id) ?? 0;
    levels.set(k, [...(levels.get(k) ?? []), c]);
  }
  const picked: StoredChunk[] = [];
  for (const k of [...levels.keys()].sort((a, b) => a - b)) {
    const need = n - picked.length;
    if (need <= 0) break;
    picked.push(...spread(levels.get(k)!, need, undefined, random));
  }
  return picked;
}

/** For flashcards on a topic: the best matches, those with the fewest cards first, ties kept in match order. */
export function fewestFirst(hits: StoredChunk[], cardsPer: Map<string, number>, n: number): StoredChunk[] {
  return [...hits].sort((a, b) => (cardsPer.get(a.id) ?? 0) - (cardsPer.get(b.id) ?? 0)).slice(0, n);
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
