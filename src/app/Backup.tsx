// Backups: one .vubicle file (a zip) holds a cubicle's records and its original files.
import { useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import { Download, Trash2 } from 'lucide-react';
import { byCubicle, changed, db, deleteCubicle, uid, PER_CUBICLE, type Cubicle } from './db';
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
