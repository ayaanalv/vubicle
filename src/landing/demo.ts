import { buildIndex, bm25, tokenize } from '../lib/search';
import { sampleLecture } from './sample';

const docs = sampleLecture.map((s) => ({ id: String(s.slide), text: s.text }));
const index = buildIndex(docs);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Wraps words of `text` that match the query's terms in <mark>, using text nodes only. */
function highlighted(text: string, terms: Set<string>) {
  const p = el('p');
  for (const part of text.split(/(\s+)/)) {
    const t = tokenize(part)[0];
    if (t && terms.has(t)) p.append(el('mark', undefined, part));
    else p.append(part);
  }
  return p;
}

export function initDemo() {
  const form = document.querySelector<HTMLFormElement>('.try-form');
  const input = document.querySelector<HTMLInputElement>('#try-q');
  const out = document.querySelector<HTMLElement>('.try-result');
  if (!form || !input || !out) return;

  const run = (q: string) => {
    out.replaceChildren();
    if (!q.trim()) return;
    const hits = bm25(index, q, 3);
    const card = el('div', 'passage');
    // A weak single-term match is treated as not covered, the same way the workspace refuses to guess.
    if (!hits.length || hits[0].score < 1.2) {
      card.append(
        el('p', 'passage-none', 'The sample lecture does not cover that. In your workspace, Vubicle says the same instead of guessing.'),
      );
    } else {
      const top = sampleLecture.find((s) => String(s.slide) === hits[0].id)!;
      card.append(el('span', 'passage-cite', `Orbits and gravitation, slide ${top.slide}`));
      card.append(highlighted(top.text, new Set(tokenize(q))));
      if (hits.length > 1) card.append(el('p', 'passage-also', `Also relevant: ${hits.slice(1).map((h) => `slide ${h.id}`).join(', ')}`));
    }
    out.append(card);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(input.value);
  });
  form.querySelectorAll<HTMLButtonElement>('.try-chips button').forEach((b) =>
    b.addEventListener('click', () => {
      input.value = b.textContent || '';
      run(input.value);
    }),
  );
}
