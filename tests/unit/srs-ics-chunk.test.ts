import { describe, it, expect } from 'vitest';
import { newSchedule, review, preview } from '../../src/lib/srs';
import { toIcs } from '../../src/lib/ics';
import { chunkSections } from '../../src/lib/chunk';

const DAY = 86_400_000;

describe('SM-2', () => {
  it('follows 1, 6, then interval x ease', () => {
    let s = review(newSchedule(0), 'good', 0);
    expect(s.interval).toBe(1);
    s = review(s, 'good', 0);
    expect(s.interval).toBe(6);
    s = review(s, 'good', 0);
    expect(s.interval).toBe(Math.round(6 * s.ef));
    expect(s.due).toBe(s.interval * DAY);
  });
  it('resets a missed card and brings it back in 10 minutes', () => {
    const s = review({ ef: 2.5, interval: 20, reps: 4, due: 0 }, 'again', 0);
    expect(s).toMatchObject({ reps: 0, interval: 0, due: 600_000 });
    expect(s.ef).toBeLessThan(2.5);
  });
  it('never lets ease fall below 1.3', () => {
    let s = newSchedule(0);
    for (let i = 0; i < 20; i++) s = review(s, 'again', 0);
    expect(s.ef).toBe(1.3);
  });
  it('easy grows ease, hard shrinks it', () => {
    expect(review(newSchedule(0), 'easy', 0).ef).toBeGreaterThan(2.5);
    expect(review(newSchedule(0), 'hard', 0).ef).toBeLessThan(2.5);
  });
  it('previews intervals in words', () => {
    expect(preview(newSchedule(0), 'again', 0)).toBe('10 min');
    expect(preview(newSchedule(0), 'good', 0)).toBe('1 day');
  });
});

describe('toIcs', () => {
  const ics = toIcs(
    'PHYS 1080',
    [
      { id: 'a', title: 'Midterm, 25%', date: '2026-11-03', description: 'Room 101; bring a calculator' },
      { id: 'b', title: 'Bad date', date: 'soon' },
    ],
    new Date('2026-10-25T12:00:00Z'),
  );
  it('writes all-day events with escaped text and CRLF', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261104');
    expect(ics).toContain('SUMMARY:Midterm\\, 25%');
    expect(ics).toContain('DESCRIPTION:Room 101\\; bring a calculator');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it('skips events without a valid date', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
  it('folds long lines and rolls the end date over months', () => {
    const long = toIcs('x', [{ id: 'c', title: 'π'.repeat(60), date: '2026-01-31' }]);
    expect(long).toContain('\r\n ');
    expect(long).toContain('DTEND;VALUE=DATE:20260201');
  });
});

describe('chunkSections', () => {
  it('keeps passages within a page and near the target size', () => {
    const text = Array.from({ length: 30 }, (_, i) => `This is sentence ${i} about orbital mechanics.`).join(' ');
    const chunks = chunkSections('f', [{ label: 'p. 1', page: 1, text }, { label: 'p. 2', page: 2, text: 'Short page.' }], 300);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.text.length <= 360)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ label: 'p. 2', text: 'Short page.' });
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });
  it('hard-splits a giant run-on sentence', () => {
    const chunks = chunkSections('f', [{ label: 'p. 1', page: 1, text: 'word '.repeat(1000) }], 500);
    expect(chunks.length).toBeGreaterThan(5);
  });
});
