// Reading files in the browser: parse, cut into passages, store. Studying can start as soon as a file is
// stored; embeddings are added afterwards in the background and are optional.
import { detectKind, parsePptx, parseDocx, parseNote, parsePdf, FileError, type Parsed } from '../lib/parse';
import { chunkSections } from '../lib/chunk';
import { db, put, uid, changed, type StoredFile } from './db';
import { embed, whenIdle } from './api';

/** Pause between embedding batches. A 200-page course is about ten batches, so indexing takes a minute or two. */
const EMBED_GAP_MS = 8_000;

const MAX_BYTES = 60 * 1024 * 1024;

let pdfjsP: Promise<typeof import('pdfjs-dist')> | undefined;
export function loadPdfJs() {
  pdfjsP ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsP;
}

async function store(file: StoredFile, parsed: Parsed, blob?: Blob) {
  const chunks = chunkSections(file.id, parsed.sections).map((c) => ({ ...c, cubicleId: file.cubicleId }));
  const d = await db();
  const tx = d.transaction(['chunks', 'files', 'blobs'], 'readwrite');
  for (const c of chunks) await tx.objectStore('chunks').put(c);
  if (blob) await tx.objectStore('blobs').put({ id: file.id, cubicleId: file.cubicleId, data: blob });
  await tx.objectStore('files').put({ ...file, status: 'ready', progress: 1, sections: parsed.sections.length, vectors: 'pending' });
  await tx.done;
  changed('chunks');
  changed('files');
  changed('blobs');
}

export async function addFile(cubicleId: string, f: File) {
  const rec: StoredFile = { id: uid(), cubicleId, name: f.name, kind: 'note', size: f.size, addedAt: Date.now(), status: 'reading', progress: 0 };
  await put('files', rec);
  // Ask the browser not to evict this site's storage under pressure. It may say no; that is fine.
  navigator.storage?.persist?.().catch(() => {});
  try {
    if (f.size > MAX_BYTES) throw new FileError(`"${f.name}" is larger than 60 MB. Split it or export a smaller PDF.`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kind = detectKind(f.name, bytes);
    rec.kind = kind;
    let parsed: Parsed;
    if (kind === 'pdf') {
      const pdfjs = await loadPdfJs();
      let lastPaint = 0;
      parsed = await parsePdf(f.name, bytes, pdfjs as never, (done, total) => {
        // Writing progress on every page would flood IndexedDB on long PDFs.
        if (Date.now() - lastPaint > 250 || done === total) {
          lastPaint = Date.now();
          put('files', { ...rec, progress: done / total });
        }
      });
    } else if (kind === 'pptx') parsed = parsePptx(f.name, bytes);
    else if (kind === 'docx') parsed = parseDocx(f.name, bytes);
    else parsed = parseNote(f.name, new TextDecoder().decode(bytes));
    await store(rec, parsed, new Blob([bytes], { type: f.type || 'application/octet-stream' }));
    void embedPending(cubicleId);
  } catch (e) {
    const message = e instanceof FileError ? e.message : `"${f.name}" could not be read. It may be damaged or in an unusual format.`;
    if (!(e instanceof FileError)) console.error(e);
    await put('files', { ...rec, status: 'error', error: message });
  }
}

export async function addNote(cubicleId: string, title: string, text: string) {
  const rec: StoredFile = { id: uid(), cubicleId, name: title || 'Notes', kind: 'note', size: text.length, addedAt: Date.now(), status: 'reading' };
  try {
    await store(rec, parseNote(rec.name, text), new Blob([text], { type: 'text/plain' }));
    void embedPending(cubicleId);
  } catch (e) {
    await put('files', { ...rec, status: 'error', error: e instanceof FileError ? e.message : 'Those notes could not be saved.' });
  }
}

// ---- background embeddings ----

const running = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Embeds passages that have no vector yet, 32 at a time. Pauses politely when the service is busy. */
export async function embedPending(cubicleId: string): Promise<void> {
  if (running.has(cubicleId)) return;
  running.add(cubicleId);
  clearTimeout(timers.get(cubicleId));
  try {
    const d = await db();
    for (let batch = 0; ; batch++) {
      // Indexing is optional; study requests are not. Step aside while any is running or in line,
      // and leave a gap between batches so indexing never bursts through the free tier.
      if (batch > 0) await new Promise((r) => setTimeout(r, EMBED_GAP_MS));
      await whenIdle();
      const todo = (await d.getAllFromIndex('chunks', 'cubicle', cubicleId)).filter((c) => !c.embedding).slice(0, 32);
      if (!todo.length) break;
      const { vectors, retryAfter } = await embed(todo.map((c) => c.text.slice(0, 2000)), 'document');
      if (!vectors) {
        if (retryAfter) timers.set(cubicleId, setTimeout(() => embedPending(cubicleId), retryAfter * 1000));
        else await markVectors(cubicleId, 'off');
        return;
      }
      const tx = d.transaction('chunks', 'readwrite');
      todo.forEach((c, i) => tx.store.put({ ...c, embedding: vectors[i] }));
      await tx.done;
      await markVectors(cubicleId, 'partial');
    }
    await markVectors(cubicleId, 'done');
  } finally {
    running.delete(cubicleId);
  }
}

async function markVectors(cubicleId: string, state: NonNullable<StoredFile['vectors']>) {
  const d = await db();
  const files = await d.getAllFromIndex('files', 'cubicle', cubicleId);
  const chunks = state === 'off' ? [] : await d.getAllFromIndex('chunks', 'cubicle', cubicleId);
  for (const f of files) {
    if (f.status !== 'ready') continue;
    let v = state;
    if (state !== 'off') {
      const mine = chunks.filter((c) => c.fileId === f.id);
      v = mine.every((c) => c.embedding) ? 'done' : mine.some((c) => c.embedding) ? 'partial' : 'pending';
    }
    if (f.vectors !== v) await d.put('files', { ...f, vectors: v });
  }
  changed('files');
}
