// Keyword search (BM25) plus optional vector search, merged with reciprocal rank fusion.
// BM25 needs nothing from the network, so search still works when embeddings are unavailable.

const STOP = new Set(
  'a an and are as at be but by can do does for from has have how i if in into is it its of on or so than that the their them then there these they this to was we were what when where which who why will with you your'.split(' '),
);

/** Light suffix stripping so "orbits", "orbiting" and "orbit" match. Not a full stemmer. */
function stem(w: string): string {
  if (w.length <= 4) return w;
  for (const s of ['ations', 'ation', 'ings', 'ing', 'edly', 'ed', 'ies', 'es', 'ly', 's']) {
    if (w.endsWith(s) && w.length - s.length >= 3) return s === 'ies' ? w.slice(0, -3) + 'y' : w.slice(0, -s.length);
  }
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

export interface Doc {
  id: string;
  text: string;
}

export interface Index {
  docs: { id: string; tf: Map<string, number>; len: number }[];
  df: Map<string, number>;
  avgLen: number;
}

export function buildIndex(docs: Doc[]): Index {
  const df = new Map<string, number>();
  let total = 0;
  const out = docs.map((d) => {
    const tf = new Map<string, number>();
    const toks = tokenize(d.text);
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    total += toks.length;
    return { id: d.id, tf, len: toks.length };
  });
  return { docs: out, df, avgLen: total / Math.max(1, docs.length) };
}

export interface Hit {
  id: string;
  score: number;
}

export function bm25(index: Index, query: string, limit = 8, k1 = 1.4, b = 0.75): Hit[] {
  const terms = [...new Set(tokenize(query))];
  const N = index.docs.length;
  const hits: Hit[] = [];
  for (const d of index.docs) {
    let score = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / (index.avgLen || 1)));
    }
    if (score > 0) hits.push({ id: d.id, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Reciprocal rank fusion: rewards ids that rank well in any list, without comparing raw scores. */
export function rrf(lists: string[][], limit = 8, k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

export interface Searchable extends Doc {
  embedding?: ArrayLike<number>;
}

/** Hybrid search. Pass queryEmbedding when available; chunks without embeddings still rank by keywords. */
export function search(chunks: Searchable[], query: string, queryEmbedding?: ArrayLike<number>, limit = 8, index = buildIndex(chunks)): string[] {
  const keyword = bm25(index, query, limit * 2).map((h) => h.id);
  if (!queryEmbedding) return keyword.slice(0, limit);
  const vector = chunks
    .filter((c) => c.embedding)
    .map((c) => ({ id: c.id, score: cosine(queryEmbedding, c.embedding!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 2)
    .map((h) => h.id);
  return rrf([keyword, vector], limit);
}
