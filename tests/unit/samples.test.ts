import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { readBackupZip, readManifest, buildImport } from '../../src/lib/backup';
import { SAMPLES } from '../../src/app/samples';

describe('sample cubicles', () => {
  for (const sample of SAMPLES) {
    it(`${sample.id}: passes the backup checks and has everything made`, async () => {
      const path = `public/samples/${sample.id}.vubicle`;
      expect(statSync(path).size).toBeLessThan(200 * 1024);
      const entries = await readBackupZip(new Blob([readFileSync(path)]));
      const manifest = readManifest(entries);
      let n = 0;
      const r = buildImport(manifest, () => `id${++n}`);
      expect(r.cubicle.name).toBe(sample.name);
      expect(r.files.map((f) => f.record.name).sort()).toEqual(['About this sample', sample.file].sort());
      // The original PDF is inside, so citations can show the printed page.
      const pdf = r.files.find((f) => f.record.name === sample.file)!;
      expect(entries[pdf.entry]?.length).toBeGreaterThan(1000);
      // Every passage has its search vector, so opening the sample sends nothing to the embedding service.
      expect(r.chunks.length).toBeGreaterThan(5);
      expect(r.chunks.every((c) => c.embedding?.length)).toBe(true);
      // Flashcards at all three levels, a quiz, a concept map, and three cited answers.
      expect(r.cards.length).toBeGreaterThanOrEqual(8);
      expect(new Set(r.cards.map((c) => c.difficulty))).toEqual(new Set(['easy', 'medium', 'hard']));
      expect(r.quizzes[0]?.questions.length).toBeGreaterThanOrEqual(5);
      expect(r.maps[0]?.topics.length).toBeGreaterThanOrEqual(4);
      const answers = r.chats.flatMap((c) => c.messages).filter((m) => m.role === 'assistant');
      expect(answers).toHaveLength(3);
      const ids = new Set(r.chunks.map((c) => c.id));
      for (const a of answers) expect(a.cites?.some((id) => ids.has(id))).toBe(true);
      // The note names the source and license.
      const about = r.chunks.filter((c) => c.fileId === r.files.find((f) => f.record.name === 'About this sample')!.record.id).map((c) => c.text).join(' ');
      expect(about).toMatch(sample.id === 'literature' ? /oldid=14833580[\s\S]*public domain/ : /oldid=\d+[\s\S]*CC BY-SA 4\.0/);
    });
  }
});
