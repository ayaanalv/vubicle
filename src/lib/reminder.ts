// Backup reminders. Everything a student makes lives in one browser, so clearing that browser's data loses it.
// These rules decide what the "Last backed up" line says and when to suggest a new backup.

export const DAY = 86_400_000;
/** Suggest a backup once the last one (or the cubicle itself, if never backed up) is this old. */
export const REMIND_AFTER_DAYS = 7;

const midnight = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Whole calendar days between two times in the browser's time zone. Rounded, so a daylight saving day still counts as one. */
export function daysBetween(from: number, to: number) {
  return Math.max(0, Math.round((midnight(to) - midnight(from)) / DAY));
}

export function lastBackupText(last: number | null, now: number) {
  if (last == null) return 'Never backed up';
  const days = daysBetween(last, now);
  if (days === 0) return 'Last backed up today';
  if (days === 1) return 'Last backed up yesterday';
  return `Last backed up ${days} days ago`;
}

/** A sample cubicle's own reading is not the student's work; anything they add to it is. */
export function hasOwnFiles(fileNames: string[], sampleFile?: string) {
  return fileNames.some((n) => n !== sampleFile);
}

export function shouldRemind(o: { last: number | null; createdAt: number; dismissedAt: number | null; hasData: boolean; now: number }) {
  if (!o.hasData) return false;
  if (daysBetween(o.last ?? o.createdAt, o.now) < REMIND_AFTER_DAYS) return false;
  // Dismissing quiets it for another week, not forever.
  if (o.dismissedAt != null && daysBetween(o.dismissedAt, o.now) < REMIND_AFTER_DAYS) return false;
  return true;
}
