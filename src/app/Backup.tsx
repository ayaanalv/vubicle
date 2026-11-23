// Backups: one .vubicle file (a zip) holds a cubicle's records and its original files.
import { useEffect, useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import { Download, HardDriveDownload, Trash2, X } from 'lucide-react';
import { byCubicle, changed, cubicles, db, deleteCubicle, uid, PER_CUBICLE, type Cubicle } from './db';
import { SAMPLES, type Sample } from './samples';
import { daysBetween, hasOwnFiles, lastBackupText, shouldRemind } from '../lib/reminder';
import { Dialog } from './ui';
import { FORMAT, VERSION, readBackupZip, readManifest, buildImport, fitsInBackup, BackupError, TOO_BIG_TO_EXPORT } from '../lib/backup';

export async function backupBytes(c: Cubicle): Promise<Uint8Array> {
  const [files, blobs, chunks, cards, quizzes, chats, maps, deadlines, briefs] = await Promise.all(PER_CUBICLE.map((s) => byCubicle(s, c.id)));
  const manifest = strToU8(JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), cubicle: c, files, chunks, cards, quizzes, chats, maps, deadlines, briefs }));
  // Refuse before reading any file, so a student never holds a backup that import would turn away.
  if (!fitsInBackup((blobs as { data: Blob }[]).map((b) => b.data.size), manifest.length)) throw new BackupError(TOO_BIG_TO_EXPORT);
  const entries: Record<string, Uint8Array> = { 'vubicle.json': manifest };
  for (const b of blobs as { id: string; data: Blob }[]) entries[`files/${b.id}`] = new Uint8Array(await b.data.arrayBuffer());
  return zipSync(entries, { level: 6 });
}

export async function exportCubicle(c: Cubicle) {
  const bytes = await backupBytes(c);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }));
  a.download = `${c.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'cubicle'}-${new Date().toISOString().slice(0, 10)}.vubicle`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  markBackedUp(c.id);
}

// ---- when each cubicle was last backed up, kept in this browser's localStorage ----

const BACKED_UP = (id: string) => `vubicle.backup.${id}`;
const DISMISSED = (id: string) => `vubicle.backupDismissed.${id}`;
const EVENT = 'vubicle:backup';

function readTime(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeTime(key: string, t: number) {
  try {
    localStorage.setItem(key, String(t));
  } catch {
    /* private mode: the line just keeps saying what it said */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const markBackedUp = (id: string) => writeTime(BACKED_UP(id), Date.now());
const dismissReminder = (id: string) => writeTime(DISMISSED(id), Date.now());

/** The cubicle's last backup and reminder dismissal, re-read whenever either changes. */
function useBackupTimes(id: string) {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return { last: readTime(BACKED_UP(id)), dismissedAt: readTime(DISMISSED(id)) };
}

/** The small "Last backed up" line under the export menu item. */
export function LastBackup({ cubicleId }: { cubicleId: string }) {
  const { last } = useBackupTimes(cubicleId);
  return <p className="menu-note">{lastBackupText(last, Date.now())}</p>;
}

/** A gentle note when a cubicle with the student's own files has gone a week without a backup. */
export function BackupReminder({ cubicle, fileNames }: { cubicle: Cubicle; fileNames: string[] }) {
  const { last, dismissedAt } = useBackupTimes(cubicle.id);
  const [error, setError] = useState('');
  const now = Date.now();
  const sample = SAMPLES.find((s) => s.name === cubicle.name);
  if (!shouldRemind({ last, createdAt: cubicle.createdAt, dismissedAt, hasData: hasOwnFiles(fileNames, sample?.file), now })) return null;
  return (
    <div className="notice backup-reminder" role="status">
      <HardDriveDownload aria-hidden="true" />
      <div>
        <p>
          {last == null ? `${cubicle.name} has never been backed up.` : `${cubicle.name} was last backed up ${daysBetween(last, now)} days ago.`} Your work is stored only in this browser, so keep a
          backup file somewhere safe.
        </p>
        {error && <p className="bad">{error}</p>}
      </div>
      <button
        className="btn sm"
        onClick={() => {
          setError('');
          exportCubicle(cubicle).catch((e) => setError(e instanceof BackupError ? e.message : 'The backup could not be made. Nothing was saved.'));
        }}
      >
        <Download aria-hidden="true" /> Export a backup
      </button>
      <button className="btn ghost icon sm" aria-label="Dismiss backup reminder" onClick={() => dismissReminder(cubicle.id)}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}

/** Imports a backup as a new cubicle. Every id is replaced, so importing twice never collides. */
export async function importBackup(file: File): Promise<Cubicle> {
  // Size limits, the streaming unzip and the field-by-field checks live in src/lib/backup.ts.
  const entries = await readBackupZip(file);
  const r = buildImport(readManifest(entries), uid);
  const d = await db();
  const tx = d.transaction(['cubicles', ...PER_CUBICLE], 'readwrite');
  await tx.objectStore('cubicles').put(r.cubicle);
  for (const { record, entry } of r.files) {
    await tx.objectStore('files').put(record);
    const bytes = entries[entry];
    if (bytes) await tx.objectStore('blobs').put({ id: record.id, cubicleId: r.cubicle.id, data: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
  }
  for (const c of r.chunks) await tx.objectStore('chunks').put(c);
  for (const c of r.cards) await tx.objectStore('cards').put(c);
  for (const q of r.quizzes) await tx.objectStore('quizzes').put(q);
  for (const c of r.chats) await tx.objectStore('chats').put(c);
  for (const mp of r.maps) await tx.objectStore('maps').put(mp);
  for (const dl of r.deadlines) await tx.objectStore('deadlines').put(dl);
  for (const b of r.briefs) await tx.objectStore('briefs').put(b);
  await tx.done;
  changed('cubicles');
  PER_CUBICLE.forEach(changed);
  return r.cubicle;
}

/**
 * Opens a sample: the cubicle if this browser already has it, otherwise its backup file imported through the
 * same checks as any backup. No AI request. Returns the cubicle's id.
 */
export async function openSample(sample: Sample): Promise<string> {
  const have = (await cubicles()).find((c) => c.name === sample.name);
  if (have) return have.id;
  let res: Response;
  try {
    res = await fetch(`/samples/${sample.id}.vubicle`);
  } catch {
    throw new Error('That sample could not be downloaded. Check your connection and try again.');
  }
  if (!res.ok) throw new Error('That sample could not be downloaded. Try again in a moment.');
  return (await importBackup(new File([await res.blob()], `${sample.id}.vubicle`))).id;
}

export function DeleteCubicle({ cubicle, open, onClose }: { cubicle: Cubicle; open: boolean; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog open={open} onClose={onClose} label={`Delete ${cubicle.name}`}>
      <div className="dialog">
        <h2>Delete {cubicle.name}?</h2>
        <p>This removes its files, flashcards, quizzes, chats, briefs and deadlines from this browser. It cannot be undone, so export a backup first if you might want it later.</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={async () => {
              setError('');
              try {
                await exportCubicle(cubicle);
                setSaved(true);
              } catch (e) {
                setError(e instanceof BackupError ? e.message : 'The backup could not be made. Nothing was saved.');
              }
            }}
          >
            <Download aria-hidden="true" /> {saved ? 'Backup saved' : 'Export a backup first'}
          </button>
          <button
            className="btn primary"
            style={{ background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' }}
            onClick={async () => {
              await deleteCubicle(cubicle.id);
              onClose();
            }}
          >
            <Trash2 aria-hidden="true" /> Delete
          </button>
        </div>
        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
