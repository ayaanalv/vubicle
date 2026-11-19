import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readBackupZip, readManifest, buildImport, fitsInBackup, LIMITS, MAX_TOPICS, MAX_LINKS } from '../../src/lib/backup';

const manifest = (over: Record<string, unknown> = {}) => ({
  format: 'vubicle-backup',
  version: 1,
  cubicle: { name: 'PHYS 1080' },
  files: [{ id: 'f1', name: 'Lecture.pdf', kind: 'pdf', size: 10, addedAt: 1, status: 'ready' }],
  chunks: [{ id: 'f1:0', fileId: 'f1', label: 'p. 1', page: 1, ord: 0, text: 'Kepler.' }],
  cards: [],
  quizzes: [],
  chats: [],
  maps: [],
  deadlines: [],
  briefs: [],
  ...over,
});
const zip = (entries: Record<string, Uint8Array>) => new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>]);
const backup = (m: unknown, extra: Record<string, Uint8Array> = {}) => zip({ 'vubicle.json': strToU8(JSON.stringify(m)), ...extra });
let n = 0;
const id = () => `id${++n}`;

describe('reading a backup zip', () => {
  it('reads a normal backup, original files included', async () => {
    const entries = await readBackupZip(backup(manifest(), { 'files/f1': new Uint8Array([1, 2, 3]) }));
    expect(readManifest(entries).cubicle.name).toBe('PHYS 1080');
    expect([...entries['files/f1']]).toEqual([1, 2, 3]);
  });

  it('stops a zip bomb by counting the bytes that come out, not the sizes the zip claims', async () => {
    // 40 MB of zeros squeezes into about 40 KB: a ratio of 1000 to 1.
    const bomb = backup(manifest(), { 'files/f1': new Uint8Array(40 * 1024 * 1024) });
    expect(bomb.size).toBeLessThan(100 * 1024);
    await expect(readBackupZip(bomb, { ...LIMITS, totalBytes: 4 * 1024 * 1024 })).rejects.toThrow('This backup is too large or damaged.');
  });

  it('refuses files over the size cap before unzipping, and too many entries', async () => {
    await expect(readBackupZip(backup(manifest()), { ...LIMITS, fileBytes: 10 })).rejects.toThrow('too large');
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`files/x${i}`, new Uint8Array([i])]));
    await expect(readBackupZip(backup(manifest(), many), { ...LIMITS, entries: 10 })).rejects.toThrow('too large');
  });

  it('checks the size of vubicle.json before parsing it', async () => {
    const big = manifest({ chats: [{ mode: 'chat', title: 'x'.repeat(5000), messages: [] }] });
    await expect(readBackupZip(backup(big), { ...LIMITS, manifestBytes: 1000 })).rejects.toThrow('too large');
    expect(() => readManifest({ 'vubicle.json': new Uint8Array(2000) }, { ...LIMITS, manifestBytes: 1000 })).toThrow('too large');
  });

  it('says plainly when a file is not a backup', async () => {
    const entries = await readBackupZip(new Blob(['just some text']));
    expect(() => readManifest(entries)).toThrow('not a Vubicle backup');
  });
});

describe('export and import agree on size', () => {
  const MB = 1024 * 1024;
  it('lets export make only backups that import accepts', () => {
    // A term of lecture slides: 25 PDFs of 20 MB, which the old 500 MB import limit refused.
    expect(fitsInBackup(Array(25).fill(20 * MB), 30 * MB)).toBe(true);
    expect(LIMITS.fileBytes).toBeGreaterThanOrEqual(LIMITS.totalBytes);
    // Over 1 GB of files, too many files, or an oversized vubicle.json: export refuses up front.
    expect(fitsInBackup(Array(18).fill(60 * MB), 10 * MB)).toBe(false);
    expect(fitsInBackup(Array(LIMITS.entries).fill(1), 1)).toBe(false);
    expect(fitsInBackup([], LIMITS.manifestBytes + 1)).toBe(false);
  });
});

describe('checking the manifest', () => {
  const read = (m: unknown) => readManifest({ 'vubicle.json': strToU8(JSON.stringify(m)) });
  it('requires a numeric version', () => {
    expect(() => read(manifest({ version: undefined }))).toThrow('damaged');
    expect(() => read(manifest({ version: '99' }))).toThrow('damaged');
    expect(() => read(manifest({ version: 2 }))).toThrow('newer version');
    expect(read(manifest()).version).toBe(1);
  });
});

describe('building records from a backup', () => {
  it('keeps passages that share an ord instead of letting one overwrite the other', () => {
    const r = buildImport(
      manifest({
        chunks: [
          { id: 'a', fileId: 'f1', label: 'p. 1', page: 1, ord: 0, text: 'First.' },
          { id: 'b', fileId: 'f1', label: 'p. 2', page: 2, ord: 0, text: 'Second.' },
        ],
      }),
      id,
    );
    expect(r.chunks.map((c) => c.text)).toEqual(['First.', 'Second.']);
    expect(new Set(r.chunks.map((c) => c.id)).size).toBe(2);
  });

  it('stores only known fields with known values', () => {
    const r = buildImport(
      manifest({
        files: [
          { id: 'f1', name: 'Lecture.pdf', kind: 'pdf', status: 'reading', size: 'big', injected: '<img>' },
          { id: 'f2', name: 'Odd', kind: 'exe' },
        ],
        cards: [
          { front: 'Q', back: 'A', ef: 'x', due: 5, manual: 'yes', extra: { nested: true } },
          { front: 'Q2', back: 'A2', difficulty: 'hard' },
          { front: 'Q3', back: 'A3', difficulty: 'mixed' },
        ],
        deadlines: [{ title: 'Midterm', kind: 'party', date: 'soon', weight: 250, done: 'no' }],
        chats: [{ mode: 'hacker', messages: [] }, { mode: 'chat', title: 'Ok', messages: [{ role: 'system', text: 'x' }, { role: 'student', text: 'hi', verdict: 'great' }] }],
        briefs: [{ format: 'poem', length: 'short', parts: [] }],
      }),
      id,
    );
    expect(r.files).toHaveLength(1);
    expect(r.files[0].record).toMatchObject({ kind: 'pdf', status: 'ready', size: 0 });
    expect(r.files[0].record).not.toHaveProperty('injected');
    expect(r.cards[0]).toMatchObject({ front: 'Q', back: 'A', ef: 2.5, due: 5, manual: false });
    expect(r.cards[0]).not.toHaveProperty('extra');
    // Difficulty: kept when it is a real level, dropped otherwise (old cards have none).
    expect(r.cards.map((c) => c.difficulty)).toEqual([undefined, 'hard', undefined]);
    expect(r.deadlines[0]).toMatchObject({ kind: 'other', date: null, weight: null, done: false });
    expect(r.chats).toHaveLength(1);
    expect(r.chats[0].messages).toEqual([expect.objectContaining({ role: 'student', text: 'hi', verdict: undefined })]);
    expect(r.briefs).toHaveLength(0);
  });

  it('caps concept map topics and links, so a huge map cannot freeze the page', () => {
    const topics = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, label: `Topic ${i}`, summary: '', chunkIds: [] }));
    const links = Array.from({ length: 5000 }, (_, i) => ({ from: 't0', to: `t${(i % 40) + 1}`, label: 'x' }));
    const r = buildImport(manifest({ maps: [{ topics, links }] }), id);
    expect(r.maps[0].topics).toHaveLength(MAX_TOPICS);
    expect(r.maps[0].links.length).toBeLessThanOrEqual(MAX_LINKS);
  });
});
