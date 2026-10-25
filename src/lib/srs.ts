// SM-2 spaced repetition (Wozniak, 1987) with a short relearning step for missed cards.

export interface Schedule {
  /** Ease factor, never below 1.3. */
  ef: number;
  /** Days until the next review after a successful recall. */
  interval: number;
  /** Successful reviews in a row. */
  reps: number;
  /** When the card is next due, in ms since epoch. */
  due: number;
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';
const QUALITY: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 };

const DAY = 86_400_000;
const RELEARN = 10 * 60_000;

export const newSchedule = (now = Date.now()): Schedule => ({ ef: 2.5, interval: 0, reps: 0, due: now });

export function review(s: Schedule, grade: Grade, now = Date.now()): Schedule {
  const q = QUALITY[grade];
  const ef = Math.max(1.3, s.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (q < 3) return { ef, interval: 0, reps: 0, due: now + RELEARN };
  const interval = s.reps === 0 ? 1 : s.reps === 1 ? 6 : Math.round(s.interval * ef);
  return { ef, interval, reps: s.reps + 1, due: now + interval * DAY };
}

/** Shown on the grade buttons, e.g. "10 min", "6 days". */
export function preview(s: Schedule, grade: Grade, now = Date.now()): string {
  const ms = review(s, grade, now).due - now;
  if (ms < DAY) return `${Math.round(ms / 60_000)} min`;
  const d = Math.round(ms / DAY);
  return d === 1 ? '1 day' : d < 60 ? `${d} days` : `${Math.round(d / 30)} months`;
}
