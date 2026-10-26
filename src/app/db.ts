// Everything a student makes lives in IndexedDB in their own browser. No accounts, no server copy.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';
import type { FileKind } from '../lib/parse';
import type { Chunk } from '../lib/chunk';
import type { Schedule } from '../lib/srs';

export interface Cubicle {
  id: string;
  name: string;
  subject?: string;
  createdAt: number;
}

export interface StoredFile {
  id: string;
  cubicleId: string;
  name: string;
  kind: FileKind;
  size: number;
  addedAt: number;
  status: 'reading' | 'ready' | 'error';
  progress?: number;
  error?: string;
  sections?: number;
  /** Embeddings: none yet, some done, all done, or unavailable (keyword search only). */
  vectors?: 'pending' | 'partial' | 'done' | 'off';
}

export interface StoredChunk extends Chunk {
  cubicleId: string;
  embedding?: number[];
}

export interface Card extends Schedule {
  id: string;
  cubicleId: string;
  front: string;
  back: string;
  chunkId?: string;
  manual: boolean;
  createdAt: number;
}

export interface QuizQuestion {
  type: 'mcq' | 'short';
  question: string;
  options?: string[];
  /** Index for mcq, model answer for short. */
  answer: number | string;
  explanation: string;
  chunkId?: string;
}

export interface Attempt {
  at: number;
  answers: (number | string | null)[];
  /** 0 to 1 per question. */
  scores: (number | null)[];
  feedback: (string | null)[];
}

export interface Quiz {
  id: string;
  cubicleId: string;
  title: string;
  fileId?: string;
  questions: QuizQuestion[];
  attempts: Attempt[];
  createdAt: number;
}

export interface Message {
  role: 'student' | 'tutor' | 'assistant';
  text: string;
  /** Passage number in the answer → chunk id. */
  cites?: string[];
  covered?: boolean;
  verdict?: string;
  at: number;
}

export interface Chat {
  id: string;
  cubicleId: string;
  mode: 'chat' | 'tutor';
  title: string;
  fileId?: string;
  /** Tutor sessions keep the same passages throughout. */
  chunkIds?: string[];
  messages: Message[];
  updatedAt: number;
}

export interface MapData {
  id: string;
  cubicleId: string;
  fileId?: string;
  topics: { id: string; label: string; summary: string; chunkIds: string[] }[];
  links: { from: string; to: string; label: string }[];
  createdAt: number;
}

export interface Deadline {
  id: string;
  cubicleId: string;
  title: string;
  date: string | null;
  weight: number | null;
  kind: string;
  done: boolean;
  chunkId?: string;
  createdAt: number;
}

interface Schema extends DBSchema {
  cubicles: { key: string; value: Cubicle };
  files: { key: string; value: StoredFile; indexes: { cubicle: string } };
  /** Original file bytes, kept so PDFs can show the cited page and backups are complete. */
  blobs: { key: string; value: { id: string; cubicleId: string; data: Blob } ; indexes: { cubicle: string } };
  chunks: { key: string; value: StoredChunk; indexes: { cubicle: string; file: string } };
  cards: { key: string; value: Card; indexes: { cubicle: string } };
  quizzes: { key: string; value: Quiz; indexes: { cubicle: string } };
  chats: { key: string; value: Chat; indexes: { cubicle: string } };
  maps: { key: string; value: MapData; indexes: { cubicle: string } };
  deadlines: { key: string; value: Deadline; indexes: { cubicle: string } };
  /** Cached AI answers, so asking the same thing twice costs nothing. */
  cache: { key: string; value: { key: string; value: unknown; at: number } };
}

export type Store = 'cubicles' | 'files' | 'blobs' | 'chunks' | 'cards' | 'quizzes' | 'chats' | 'maps' | 'deadlines';
export const PER_CUBICLE: Exclude<Store, 'cubicles'>[] = ['files', 'blobs', 'chunks', 'cards', 'quizzes', 'chats', 'maps', 'deadlines'];

let dbp: Promise<IDBPDatabase<Schema>> | undefined;
export function db() {
  dbp ??= openDB<Schema>('vubicle', 1, {
    upgrade(d) {
      d.createObjectStore('cubicles', { keyPath: 'id' });
      for (const s of PER_CUBICLE) {
        const os = d.createObjectStore(s, { keyPath: 'id' });
        os.createIndex('cubicle', 'cubicleId');
        if (s === 'chunks') (os as unknown as IDBObjectStore).createIndex('file', 'fileId');
      }
      d.createObjectStore('cache', { keyPath: 'key' });
    },
  });
  return dbp;
}

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// ---- change notifications: components re-read when a store they use changes ----

const listeners = new Set<(s: Store) => void>();
export function changed(s: Store) {
  listeners.forEach((l) => l(s));
}

/** Re-runs `read` whenever one of `stores` changes. Returns undefined until the first read finishes. */
export function useLive<T>(read: () => Promise<T>, stores: Store[], deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const n = ++seq;
      read().then((v) => alive && n === seq && setValue(() => v));
    };
    run();
    const l = (s: Store) => stores.includes(s) && run();
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

// ---- helpers ----

export async function put<S extends Store>(store: S, value: Schema[S]['value']) {
  await (await db()).put(store, value as never);
  changed(store);
}

export async function remove(store: Store, id: string) {
  await (await db()).delete(store, id);
  changed(store);
}

export async function byCubicle<S extends Exclude<Store, 'cubicles'>>(store: S, cubicleId: string): Promise<Schema[S]['value'][]> {
  return (await db()).getAllFromIndex(store, 'cubicle', cubicleId as never) as never;
}

export async function cubicles(): Promise<Cubicle[]> {
  return (await (await db()).getAll('cubicles')).sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteCubicle(id: string) {
  const d = await db();
  const tx = d.transaction([...PER_CUBICLE, 'cubicles'] as Store[], 'readwrite');
  for (const s of PER_CUBICLE) {
    const keys = await tx.objectStore(s).index('cubicle').getAllKeys(id);
    await Promise.all(keys.map((k) => tx.objectStore(s).delete(k)));
  }
  await tx.objectStore('cubicles').delete(id);
  await tx.done;
  PER_CUBICLE.forEach(changed);
  changed('cubicles');
}

export async function deleteFile(file: StoredFile) {
  const d = await db();
  const tx = d.transaction(['files', 'chunks', 'blobs'], 'readwrite');
  const keys = await tx.objectStore('chunks').index('file').getAllKeys(file.id);
  await Promise.all(keys.map((k) => tx.objectStore('chunks').delete(k)));
  await tx.objectStore('blobs').delete(file.id);
  await tx.objectStore('files').delete(file.id);
  await tx.done;
  changed('files');
  changed('chunks');
}

/** Chunks for a cubicle, or for one file in it. */
export async function chunksFor(cubicleId: string, fileId?: string): Promise<StoredChunk[]> {
  const d = await db();
  const all = fileId ? await d.getAllFromIndex('chunks', 'file', fileId) : await d.getAllFromIndex('chunks', 'cubicle', cubicleId as never);
  return all.sort((a, b) => (a.fileId === b.fileId ? a.ord - b.ord : a.fileId < b.fileId ? -1 : 1));
}

export async function getChunks(ids: string[]): Promise<(StoredChunk | undefined)[]> {
  const d = await db();
  return Promise.all(ids.map((id) => d.get('chunks', id)));
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('cache', key))?.value as T | undefined;
}

export async function cacheSet(key: string, value: unknown) {
  await (await db()).put('cache', { key, value, at: Date.now() });
}
