// Reading a .vubicle backup safely. A backup is a zip someone hands us, so it is untrusted input:
// - it is unzipped as a stream, counting the bytes that actually come out (zip headers can lie about sizes),
//   so a small file that inflates to gigabytes stops early instead of crashing the tab;
// - every stored record is rebuilt from an explicit list of fields, with each value checked, so nothing
//   unexpected ends up in IndexedDB.
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import type { Brief, Card, Chat, Cubicle, Deadline, MapData, Message, Quiz, QuizQuestion, StoredChunk, StoredFile } from '../app/db';

export const FORMAT = 'vubicle-backup';
export const VERSION = 1;

/**
 * Sized for a large course: each original file may be up to 60 MB, and vubicle.json holds every passage with
 * its embedding (about 60 KB each), so 300 MB is room for about 5,000 passages.
 */
export const LIMITS = {
  /** The backup file itself, before unzipping. */
  fileBytes: 500 * 1024 * 1024,
  /** Everything that comes out of the zip, added up. */
  totalBytes: 1024 * 1024 * 1024,
  /** Files inside the zip: one per course file, plus vubicle.json. */
  entries: 2000,
  /** vubicle.json, unzipped, before it is parsed. */
  manifestBytes: 300 * 1024 * 1024,
};

/** Concept maps from the AI have at most 16 topics and 40 links; a backup may not bring more than this. */
export const MAX_TOPICS = 50;
export const MAX_LINKS = 200;

/** An error whose message is safe to show the student as is. */
export class BackupError extends Error {}
const TOO_BIG = 'This backup is too large or damaged.';
const NOT_BACKUP = 'That file is not a Vubicle backup.';

const MANIFEST = 'vubicle.json';
const wanted = (name: string) => name === MANIFEST || /^files\/[^/]+$/.test(name);

/** Unzips the entries Vubicle uses, stopping as soon as any limit is passed. */
export async function readBackupZip(file: Blob, limits = LIMITS): Promise<Record<string, Uint8Array>> {
  if (file.size > limits.fileBytes) throw new BackupError(TOO_BIG);
  const out: Record<string, Uint8Array> = {};
  let total = 0;
  let entries = 0;
  let failed: BackupError | undefined;
  const unzip = new Unzip((entry) => {
    if (failed) return;
    if (++entries > limits.entries) {
      failed = new BackupError(TOO_BIG);
      return;
    }
    // Entries Vubicle never reads are skipped without being unzipped.
    if (!wanted(entry.name)) return;
    const parts: Uint8Array[] = [];
    let size = 0;
    entry.ondata = (err, data, final) => {
      if (failed) return;
      if (err) {
        failed = new BackupError(TOO_BIG);
        return;
      }
      size += data.length;
      total += data.length;
      if (total > limits.totalBytes || (entry.name === MANIFEST && size > limits.manifestBytes)) {
        failed = new BackupError(TOO_BIG);
        entry.terminate();
        return;
      }
      parts.push(data);
      if (final) out[entry.name] = join(parts, size);
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  try {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Small pieces, so one push can never inflate to more than a few MB before the limits are checked.
      for (let i = 0; i < value.length && !failed; i += 16_384) unzip.push(value.subarray(i, i + 16_384));
      if (failed) {
        await reader.cancel();
        throw failed;
      }
    }
    unzip.push(new Uint8Array(0), true);
  } catch (e) {
    throw e instanceof BackupError ? e : new BackupError(TOO_BIG);
  }
  if (failed) throw failed;
  return out;
}

function join(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Parses and checks vubicle.json. */
export function readManifest(entries: Record<string, Uint8Array>, limits = LIMITS): any {
  const raw = entries[MANIFEST];
  if (!raw) throw new BackupError(NOT_BACKUP);
  if (raw.length > limits.manifestBytes) throw new BackupError(TOO_BIG);
  let m: any;
  try {
    m = JSON.parse(strFromU8(raw));
  } catch {
    throw new BackupError(NOT_BACKUP);
  }
  if (m?.format !== FORMAT || typeof m.cubicle?.name !== 'string' || ![m.files, m.chunks, m.cards, m.quizzes, m.chats, m.maps, m.deadlines].every(Array.isArray)) {
    throw new BackupError('That backup is damaged or from a newer version of Vubicle.');
  }
  // A missing or text version would slip past a plain "greater than" check.
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || m.version < 1) throw new BackupError('That backup is damaged or from a newer version of Vubicle.');
  if (m.version > VERSION) throw new BackupError('That backup comes from a newer version of Vubicle. Reload the page and try again.');
  return m;
}

// ---- field checks ----

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const optStr = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const optNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const optBool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

const FILE_KINDS = ['pdf', 'pptx', 'docx', 'note', 'image'] as const;
const VECTORS = ['pending', 'partial', 'done', 'off'] as const;
const ROLES = ['student', 'tutor', 'assistant'] as const;
const VERDICTS = ['correct', 'partial', 'incorrect', 'none'] as const;
const DEADLINE_KINDS = ['exam', 'test', 'quiz', 'assignment', 'lab', 'project', 'presentation', 'other'] as const;
const BRIEF_FORMATS = ['summary', 'guide', 'terms'] as const;
const BRIEF_LENGTHS = ['short', 'medium', 'long'] as const;

export interface Imported {
  cubicle: Cubicle;
  /** Each kept file, with the zip entry its original bytes are in. */
  files: { record: StoredFile; entry: string }[];
  chunks: StoredChunk[];
  cards: Card[];
  quizzes: Quiz[];
  chats: Chat[];
  maps: MapData[];
  deadlines: Deadline[];
  briefs: Brief[];
}

/** Builds the records to store from a checked manifest. Every id is new, so importing twice never collides. */
export function buildImport(m: any, newId: () => string, now = Date.now()): Imported {
  const cubicleId = newId();
  const cubicle: Cubicle = { id: cubicleId, name: str(m.cubicle.name, 80), subject: optStr(m.cubicle.subject, 40), createdAt: now };

  const fileIds = new Map<string, string>();
  const files: Imported['files'] = [];
  for (const f of arr(m.files)) {
    const kind = oneOf(f?.kind, FILE_KINDS);
    if (!kind || fileIds.has(String(f.id))) continue;
    const id = newId();
    fileIds.set(String(f.id), id);
    const status = f.status === 'error' ? 'error' : 'ready';
    files.push({
      entry: `files/${f.id}`,
      record: {
        id,
        cubicleId,
        name: str(f.name, 260, 'File'),
        kind,
        size: Math.max(0, num(f.size)),
        addedAt: num(f.addedAt, now),
        status,
        error: status === 'error' ? optStr(f.error, 500) : undefined,
        sections: optNum(f.sections),
        vectors: oneOf(f.vectors, VECTORS),
      },
    });
  }

  const chunkIds = new Map<string, string>();
  const perFile = new Map<string, number>();
  const chunks: StoredChunk[] = [];
  for (const c of arr(m.chunks)) {
    const fileId = fileIds.get(String(c?.fileId));
    if (!fileId || typeof c.text !== 'string') continue;
    // Numbered per file as they are read, not from the stored ord: two passages with the same ord would
    // otherwise get the same id, and one would silently replace the other.
    const n = perFile.get(fileId) ?? 0;
    perFile.set(fileId, n + 1);
    const id = `${fileId}:${n}`;
    if (!chunkIds.has(String(c.id))) chunkIds.set(String(c.id), id);
    const embedding = Array.isArray(c.embedding) && c.embedding.length <= 8192 && c.embedding.every((x: unknown) => typeof x === 'number' && Number.isFinite(x)) ? (c.embedding as number[]) : undefined;
    chunks.push({ id, fileId, cubicleId, label: str(c.label, 120), page: Math.max(1, Math.floor(num(c.page, 1))), ord: num(c.ord, n), text: c.text.slice(0, 20_000), embedding });
  }
  const ck = (id: unknown) => (id === undefined || id === null ? undefined : chunkIds.get(String(id)));
  const fk = (id: unknown) => (id === undefined || id === null ? undefined : fileIds.get(String(id)));

  const cards: Card[] = [];
  for (const c of arr(m.cards)) {
    const front = str(c?.front, 300).trim();
    const back = str(c?.back, 600).trim();
    if (!front || !back) continue;
    cards.push({
      id: newId(),
      cubicleId,
      front,
      back,
      chunkId: ck(c.chunkId),
      manual: c.manual === true,
      createdAt: num(c.createdAt, now),
      ef: Math.max(1.3, num(c.ef, 2.5)),
      interval: Math.max(0, num(c.interval)),
      reps: Math.max(0, Math.floor(num(c.reps))),
      due: num(c.due, now),
    });
  }

  const quizzes: Quiz[] = [];
  for (const q of arr(m.quizzes)) {
    const questions: QuizQuestion[] = [];
    for (const x of arr(q?.questions)) {
      const type = oneOf(x?.type, ['mcq', 'short'] as const);
      const question = str(x?.question, 500);
      if (!type || !question) continue;
      const base = { question, explanation: str(x.explanation, 800), chunkId: ck(x.chunkId) };
      if (type === 'mcq') {
        const options = arr(x.options).filter((o) => typeof o === 'string').map((o: string) => o.slice(0, 300));
        if (options.length !== 4 || !Number.isInteger(x.answer) || x.answer < 0 || x.answer > 3) continue;
        questions.push({ type, ...base, options, answer: x.answer });
      } else questions.push({ type, ...base, answer: str(x.answer, 600) });
    }
    if (!questions.length) continue;
    quizzes.push({
      id: newId(),
      cubicleId,
      title: str(q.title, 200, 'Quiz'),
      fileId: fk(q.fileId),
      questions,
      attempts: arr(q.attempts).map((a) => ({
        at: num(a?.at, now),
        answers: arr(a?.answers).map((v) => (typeof v === 'number' || typeof v === 'string' ? (typeof v === 'string' ? v.slice(0, 1500) : v) : null)),
        scores: arr(a?.scores).map((v) => optNum(v) ?? null),
        feedback: arr(a?.feedback).map((v) => optStr(v, 800) ?? null),
      })),
      createdAt: num(q.createdAt, now),
    });
  }

  const chats: Chat[] = [];
  for (const c of arr(m.chats)) {
    const mode = oneOf(c?.mode, ['chat', 'tutor'] as const);
    if (!mode) continue;
    const messages: Message[] = [];
    for (const x of arr(c.messages)) {
      const role = oneOf(x?.role, ROLES);
      if (!role) continue;
      messages.push({
        role,
        text: str(x.text, 20_000),
        cites: Array.isArray(x.cites) ? x.cites.map((id: unknown) => ck(id) ?? '') : undefined,
        covered: optBool(x.covered),
        gradedWork: optBool(x.gradedWork),
        verdict: oneOf(x.verdict, VERDICTS),
        at: num(x.at, now),
      });
    }
    chats.push({
      id: newId(),
      cubicleId,
      mode,
      title: str(c.title, 200, 'Chat'),
      fileId: fk(c.fileId),
      chunkIds: Array.isArray(c.chunkIds) ? (c.chunkIds.map(ck).filter(Boolean) as string[]) : undefined,
      messages,
      updatedAt: num(c.updatedAt, now),
    });
  }

  const maps: MapData[] = [];
  for (const mp of arr(m.maps)) {
    const topics = arr(mp?.topics)
      .slice(0, MAX_TOPICS)
      .map((t) => ({ id: str(t?.id, 40), label: str(t?.label, 60), summary: str(t?.summary, 300), chunkIds: arr(t?.chunkIds).map(ck).filter(Boolean) as string[] }))
      .filter((t) => t.id && t.label);
    const ids = new Set(topics.map((t) => t.id));
    const links = arr(mp?.links)
      .slice(0, MAX_LINKS)
      .map((l) => ({ from: str(l?.from, 40), to: str(l?.to, 40), label: str(l?.label, 40) }))
      .filter((l) => ids.has(l.from) && ids.has(l.to));
    if (!topics.length) continue;
    maps.push({ id: newId(), cubicleId, fileId: fk(mp.fileId), topics, links, createdAt: num(mp.createdAt, now) });
  }

  const deadlines: Deadline[] = [];
  for (const d of arr(m.deadlines)) {
    const title = str(d?.title, 160);
    if (!title) continue;
    const weight = optNum(d.weight);
    deadlines.push({
      id: newId(),
      cubicleId,
      title,
      date: typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null,
      weight: weight !== undefined && weight >= 0 && weight <= 100 ? weight : null,
      kind: oneOf(d.kind, DEADLINE_KINDS) ?? 'other',
      done: d.done === true,
      chunkId: ck(d.chunkId),
      createdAt: num(d.createdAt, now),
    });
  }

  // Backups made before briefs existed have none.
  const briefs: Brief[] = [];
  for (const b of arr(m.briefs)) {
    const format = oneOf(b?.format, BRIEF_FORMATS);
    const length = oneOf(b?.length, BRIEF_LENGTHS);
    if (!format || !length) continue;
    briefs.push({
      id: newId(),
      cubicleId,
      format,
      length,
      parts: arr(b.parts).map((p) => ({ fileId: fk(p?.fileId) ?? '', name: str(p?.name, 260), text: str(p?.text, 20_000), chunkIds: arr(p?.chunkIds).map((id) => ck(id) ?? '') })),
      createdAt: num(b.createdAt, now),
    });
  }

  return { cubicle, files, chunks, cards, quizzes, chats, maps, deadlines, briefs };
}
