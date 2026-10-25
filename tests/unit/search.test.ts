import { describe, it, expect } from 'vitest';
import { tokenize, buildIndex, bm25, rrf, search, cosine } from '../../src/lib/search';

const docs = [
  { id: 'a', text: 'Kepler showed that planets move in elliptical orbits around the sun.' },
  { id: 'b', text: 'The periodic table orders elements by atomic number.' },
  { id: 'c', text: 'Orbiting satellites follow the same laws of gravitation as planets.' },
  { id: 'd', text: 'Hamlet hesitates, and the play studies that hesitation.' },
];

describe('tokenize', () => {
  it('lowercases, drops stopwords and strips suffixes', () => {
    expect(tokenize('The Orbits of Planets')).toEqual(['orbit', 'planet']);
    expect(tokenize('orbiting')).toEqual(['orbit']);
    expect(tokenize('Café')).toEqual(['cafe']);
  });
});

describe('bm25', () => {
  it('ranks the document with matching terms first', () => {
    const hits = bm25(buildIndex(docs), 'what is an elliptical orbit?');
    expect(hits[0].id).toBe('a');
    expect(hits.map((h) => h.id)).toContain('c');
    expect(hits.map((h) => h.id)).not.toContain('d');
  });
  it('returns nothing for unrelated queries', () => {
    expect(bm25(buildIndex(docs), 'mitochondria')).toEqual([]);
  });
});

describe('rrf and hybrid', () => {
  it('rewards ids that appear high in both lists', () => {
    expect(rrf([['x', 'y', 'z'], ['y', 'x', 'w']])[0]).toMatch(/x|y/);
    expect(rrf([['x', 'y'], ['y', 'w']])[0]).toBe('y');
  });
  it('falls back to keywords without a query embedding', () => {
    expect(search(docs, 'atomic number')[0]).toBe('b');
  });
  it('uses vectors to find a match with no shared words', () => {
    const withVec = docs.map((d, i) => ({ ...d, embedding: [i === 3 ? 1 : 0, i === 3 ? 0 : 1] }));
    expect(search(withVec, 'tragic indecision', [1, 0])[0]).toBe('d');
  });
  it('cosine handles zero vectors', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
