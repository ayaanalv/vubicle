import type { Section } from './parse';

export interface Chunk {
  id: string;
  fileId: string;
  label: string;
  page: number;
  /** Position within the file, for reading passages in order. */
  ord: number;
  text: string;
}

/** Splits text into sentences, keeping line breaks as boundaries too (slides are mostly lines). */
function sentences(text: string): string[] {
  return text.match(/[^.!?\n]+(?:[.!?]+["')\]]*|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/**
 * Cuts each section into passages of about `target` characters. Passages never cross a page or slide,
 * so every citation points at one place. Consecutive passages share one sentence of overlap.
 */
export function chunkSections(fileId: string, sections: Section[], target = 900): Chunk[] {
  const out: Chunk[] = [];
  for (const s of sections) {
    const sents = sentences(s.text);
    let buf: string[] = [];
    let len = 0;
    const push = () => {
      if (!buf.length) return;
      out.push({ id: `${fileId}:${out.length}`, fileId, label: s.label, page: s.page, ord: out.length, text: buf.join(' ') });
    };
    for (const sent of sents) {
      // A single sentence longer than the target is hard-split so no passage is unbounded.
      const pieces = sent.length > target * 1.5 ? sent.match(new RegExp(`.{1,${target}}(\\s|$)`, 'g')) ?? [sent] : [sent];
      for (const piece of pieces) {
        if (len + piece.length > target && buf.length) {
          push();
          const last = buf[buf.length - 1];
          buf = last.length < target / 3 ? [last] : [];
          len = buf.join(' ').length;
        }
        buf.push(piece.trim());
        len += piece.length + 1;
      }
    }
    push();
  }
  return out;
}
