// Keeping new flashcards from repeating old ones: a near-duplicate check run before saving, and the
// "do not repeat these" list sent with each request.

export interface CardText {
  front: string;
  back: string;
}

// Words that carry no meaning on their own, so "What is escape velocity?" and "Define escape velocity"
// compare on "escape velocity".
const STOP = new Set(
  'a an the of to in on for and or nor is are was were be been being by with as at from that this these those it its what which who whom whose how why when where does do did done can could would should will shall may might about into than then there their they them your you we our us his her he she s define describe explain state give name list'.split(
    ' ',
  ),
);

/** The meaningful words of a text: lower case, no punctuation, no filler words, a plural "s" dropped. */
export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(' ')
      .filter((w) => w && !STOP.has(w))
      .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  );
}

/** Shared words over all words: 1 for the same set, 0 for nothing in common. */
export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Two cards count as near-duplicates when 60% or more of their meaningful words match, either on the
 * fronts alone or on front and back together. The second catches the same fact asked another way, such as
 * a question and its answer swapped, or "What are the features of a geostationary orbit?" against "What is
 * the altitude and period of a geostationary orbit?" with the same answer.
 */
export const DUPLICATE_THRESHOLD = 0.6;

export function isNearDuplicate(a: CardText, b: CardText): boolean {
  return (
    overlap(words(a.front), words(b.front)) >= DUPLICATE_THRESHOLD ||
    overlap(words(`${a.front} ${a.back}`), words(`${b.front} ${b.back}`)) >= DUPLICATE_THRESHOLD
  );
}

/** The new cards that repeat neither an existing card nor an earlier card in the same batch. */
export function dropRepeats<T extends CardText>(fresh: T[], existing: CardText[]): T[] {
  const kept: T[] = [];
  for (const c of fresh) if (![...existing, ...kept].some((o) => isNearDuplicate(c, o))) kept.push(c);
  return kept;
}

/** Limits for the "do not repeat these" list, so it stays well inside the server's request limits. */
export const AVOID = { cards: 40, chars: 150, total: 6000 };

/**
 * Fronts of existing cards to send as "do not repeat or rephrase these": first the cards that came from the
 * passages being sent (the ones most likely to be repeated), then the newest.
 */
export function avoidList(cards: (CardText & { chunkId?: string; createdAt: number })[], sentIds: Set<string>, limits = AVOID): string[] {
  const ranked = [...cards].sort((a, b) => Number(sentIds.has(b.chunkId ?? '')) - Number(sentIds.has(a.chunkId ?? '')) || b.createdAt - a.createdAt);
  const out: string[] = [];
  let total = 0;
  for (const c of ranked) {
    if (out.length >= limits.cards) break;
    const front = c.front.replace(/\s+/g, ' ').trim().slice(0, limits.chars);
    if (!front || total + front.length > limits.total) continue;
    out.push(front);
    total += front.length;
  }
  return out;
}
