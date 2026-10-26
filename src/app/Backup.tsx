// Backups: one .vubicle file (a zip) holds a cubicle's records and its original files.
import { useState } from 'react';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { Download, Trash2 } from 'lucide-react';
import { byCubicle, changed, db, deleteCubicle, uid, PER_CUBICLE, type Cubicle } from './db';
import { Dialog } from './ui';

const FORMAT = 'vubicle-backup';
const VERSION = 1;

export async function backupBytes(c: Cubicle): Promise<Uint8Array> {
  const [files, blobs, chunks, cards, quizzes, chats, maps, deadlines] = await Promise.all(PER_CUBICLE.map((s) => byCubicle(s, c.id)));
  const entries: Record<string, Uint8Array> = {};
  for (const b of blobs as { id: string; data: Blob }[]) entries[`files/${b.id}`] = new Uint8Array(await b.data.arrayBuffer());
  const manifest = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), cubicle: c, files, chunks, cards, quizzes, chats, maps, deadlines };
  entries['vubicle.json'] = strToU8(JSON.stringify(manifest));
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

const isArr = (v: unknown): v is any[] => Array.isArray(v);

/** Imports a backup as a new cubicle. Every id is replaced, so importing twice never collides. */
export async function importBackup(file: File): Promise<Cubicle> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('That file is not a Vubicle backup.');
  }
  let m: any;
  try {
    m = JSON.parse(strFromU8(entries['vubicle.json']));
  } catch {
    throw new Error('That file is not a Vubicle backup.');
  }
  if (m?.format !== FORMAT || typeof m.cubicle?.name !== 'string' || ![m.files, m.chunks, m.cards, m.quizzes, m.chats, m.maps, m.deadlines].every(isArr)) {
    throw new Error('That backup is damaged or from a newer version of Vubicle.');
  }
  if (m.version > VERSION) throw new Error('That backup comes from a newer version of Vubicle. Reload the page and try again.');

  const cubicleId = uid();
  const fileIds = new Map<string, string>(m.files.map((f: any) => [String(f.id), uid()]));
  const chunkIds = new Map<string, string>();
  const chunks = m.chunks
    .filter((c: any) => fileIds.has(String(c.fileId)) && typeof c.text === 'string')
    .map((c: any) => {
      const fileId = fileIds.get(String(c.fileId))!;
      const id = `${fileId}:${Number(c.ord) || 0}`;
      chunkIds.set(String(c.id), id);
      return { id, fileId, cubicleId, label: String(c.label ?? ''), page: Number(c.page) || 1, ord: Number(c.ord) || 0, text: c.text, embedding: isArr(c.embedding) ? c.embedding.map(Number) : undefined };
    });
  const ck = (id: unknown) => (id === undefined ? undefined : chunkIds.get(String(id)));
  const fk = (id: unknown) => (id === undefined ? undefined : fileIds.get(String(id)));

  const cubicle: Cubicle = { id: cubicleId, name: String(m.cubicle.name).slice(0, 80), subject: m.cubicle.subject, createdAt: Date.now() };
  const d = await db();
  const tx = d.transaction(['cubicles', ...PER_CUBICLE], 'readwrite');
  await tx.objectStore('cubicles').put(cubicle);
  for (const f of m.files) {
    const id = fk(f.id)!;
    await tx.objectStore('files').put({ ...f, id, cubicleId, status: f.status === 'error' ? 'error' : 'ready' });
    const bytes = entries[`files/${f.id}`];
    if (bytes) await tx.objectStore('blobs').put({ id, cubicleId, data: new Blob([bytes as Uint8Array<ArrayBuffer>]) });
  }
  for (const c of chunks) await tx.objectStore('chunks').put(c);
  for (const c of m.cards) await tx.objectStore('cards').put({ ...c, id: uid(), cubicleId, chunkId: ck(c.chunkId) });
  for (const q of m.quizzes)
    await tx.objectStore('quizzes').put({ ...q, id: uid(), cubicleId, fileId: fk(q.fileId), questions: isArr(q.questions) ? q.questions.map((x: any) => ({ ...x, chunkId: ck(x.chunkId) })) : [], attempts: isArr(q.attempts) ? q.attempts : [] });
  for (const c of m.chats)
    await tx.objectStore('chats').put({
      ...c,
      id: uid(),
      cubicleId,
      fileId: fk(c.fileId),
      chunkIds: isArr(c.chunkIds) ? c.chunkIds.map(ck).filter(Boolean) : undefined,
      messages: isArr(c.messages) ? c.messages.map((x: any) => ({ ...x, text: String(x.text ?? ''), cites: isArr(x.cites) ? x.cites.map((id: unknown) => ck(id) ?? '') : undefined })) : [],
    });
  for (const mp of m.maps)
    await tx.objectStore('maps').put({ ...mp, id: uid(), cubicleId, fileId: fk(mp.fileId), topics: isArr(mp.topics) ? mp.topics.map((t: any) => ({ ...t, chunkIds: isArr(t.chunkIds) ? t.chunkIds.map(ck).filter(Boolean) : [] })) : [], links: isArr(mp.links) ? mp.links : [] });
  for (const dl of m.deadlines) await tx.objectStore('deadlines').put({ ...dl, id: uid(), cubicleId, chunkId: ck(dl.chunkId) });
  await tx.done;
  changed('cubicles');
  PER_CUBICLE.forEach(changed);
  return cubicle;
}

export function DeleteCubicle({ cubicle, open, onClose }: { cubicle: Cubicle; open: boolean; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} label={`Delete ${cubicle.name}`}>
      <div className="dialog">
        <h2>Delete {cubicle.name}?</h2>
        <p>This removes its files, flashcards, quizzes, chats and deadlines from this browser. It cannot be undone, so export a backup first if you might want it later.</p>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={async () => {
              await exportCubicle(cubicle);
              setSaved(true);
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
      </div>
    </Dialog>
  );
}
