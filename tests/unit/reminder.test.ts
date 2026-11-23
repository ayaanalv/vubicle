import { describe, expect, it } from 'vitest';
import { DAY, daysBetween, hasOwnFiles, lastBackupText, shouldRemind } from '../../src/lib/reminder';

const at = (s: string) => new Date(s).getTime();

describe('last backup line', () => {
  it('says never, today, yesterday and days ago by calendar day', () => {
    const now = at('2026-11-23T10:00:00');
    expect(lastBackupText(null, now)).toBe('Never backed up');
    expect(lastBackupText(at('2026-11-23T00:30:00'), now)).toBe('Last backed up today');
    // Late last night is yesterday, even though it was under 24 hours ago.
    expect(lastBackupText(at('2026-11-22T23:00:00'), now)).toBe('Last backed up yesterday');
    expect(lastBackupText(at('2026-11-14T12:00:00'), now)).toBe('Last backed up 9 days ago');
  });

  it('never goes negative when the clock moves back', () => {
    expect(daysBetween(at('2026-11-24T10:00:00'), at('2026-11-23T10:00:00'))).toBe(0);
  });
});

describe('backup reminder', () => {
  const now = at('2026-11-23T10:00:00');
  const base = { last: null, createdAt: now - 30 * DAY, dismissedAt: null, hasData: true, now };

  it('shows after 7 days without a backup, counting from creation when never backed up', () => {
    expect(shouldRemind(base)).toBe(true);
    expect(shouldRemind({ ...base, createdAt: now - 3 * DAY })).toBe(false);
    expect(shouldRemind({ ...base, last: now - 6 * DAY })).toBe(false);
    expect(shouldRemind({ ...base, last: now - 7 * DAY })).toBe(true);
  });

  it('stays quiet without the student’s own data', () => {
    expect(shouldRemind({ ...base, hasData: false })).toBe(false);
  });

  it('dismissing quiets it for a week', () => {
    expect(shouldRemind({ ...base, dismissedAt: now - 2 * DAY })).toBe(false);
    expect(shouldRemind({ ...base, dismissedAt: now - 8 * DAY })).toBe(true);
  });

  it('a sample’s own reading does not count as data, but anything added to it does', () => {
    expect(hasOwnFiles(['Keplers-laws-excerpt.pdf'], 'Keplers-laws-excerpt.pdf')).toBe(false);
    expect(hasOwnFiles(['Keplers-laws-excerpt.pdf', 'my-notes.pdf'], 'Keplers-laws-excerpt.pdf')).toBe(true);
    expect(hasOwnFiles([], undefined)).toBe(false);
    expect(hasOwnFiles(['lecture.pdf'], undefined)).toBe(true);
  });
});
