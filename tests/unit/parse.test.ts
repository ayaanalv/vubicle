import { describe, it, expect } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectKind, parsePptx, parseDocx, parseNote, parsePdf, FileError, decodeXml } from '../../src/lib/parse';
import { makePdf, makePptx, makeDocx } from '../fixtures/make';

describe('detectKind', () => {
  it('rejects old Office files with a helpful message', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]);
    expect(() => detectKind('week1.ppt', ole)).toThrow(/save it as \.pptx/);
    expect(() => detectKind('essay.doc', ole)).toThrow(/save it as \.docx/);
    expect(() => detectKind('mystery.bin', ole)).toThrow(FileError);
  });
  it('recognises supported types and refuses others', () => {
    expect(detectKind('a.pdf', new Uint8Array())).toBe('pdf');
    expect(detectKind('noext', new TextEncoder().encode('%PDF-1.7'))).toBe('pdf');
    expect(detectKind('a.PPTX', new Uint8Array())).toBe('pptx');
    expect(detectKind('a.docx', new Uint8Array())).toBe('docx');
    expect(() => detectKind('a.xlsx', new Uint8Array())).toThrow(/not a file type/);
  });
});

describe('decodeXml', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &#960; &#x3A3;')).toBe('a & b <c> π Σ');
  });
});

describe('parsePptx', () => {
  it('reads slides in order with speaker notes', () => {
    const file = makePptx([{ paras: ['Orbits', 'Kepler & Newton'] }, { paras: ['Escape velocity'], notes: 'About 11.2 km/s' }]);
    const { sections } = parsePptx('l.pptx', file);
    expect(sections.map((s) => s.label)).toEqual(['Slide 1', 'Slide 2']);
    expect(sections[0].text).toBe('Orbits\nKepler & Newton');
    expect(sections[1].text).toContain('Speaker notes:\nAbout 11.2 km/s');
    expect(sections[1].text).not.toMatch(/\n2$/);
  });
  it('fails clearly on a damaged file', () => {
    expect(() => parsePptx('bad.pptx', new Uint8Array([1, 2, 3]))).toThrow(/damaged/);
  });
  it('fails clearly when slides have no text', () => {
    expect(() => parsePptx('pics.pptx', makePptx([{ paras: [] }]))).toThrow(/no text/);
  });
});

describe('parseDocx', () => {
  it('groups paragraphs under headings', () => {
    const { sections } = parseDocx('n.docx', makeDocx(['# Week 1', 'Cells are small.', 'Mitochondria make ATP.', '# Week 2', 'DNA stores genes.']));
    expect(sections.map((s) => s.label)).toEqual(['Week 1', 'Week 2']);
    expect(sections[0].text).toBe('Week 1\nCells are small.\nMitochondria make ATP.');
  });
  it('splits long documents without headings into parts', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about something worth remembering.`);
    const { sections } = parseDocx('n.docx', makeDocx(long));
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0].label).toBe('Part 1');
  });
});

describe('parseNote', () => {
  it('uses markdown headings as sections', () => {
    const { sections } = parseNote('My notes', '# Intro\nhello\n\n# Next\nworld');
    expect(sections.map((s) => s.label)).toEqual(['Intro', 'Next']);
  });
});

describe('parsePdf', () => {
  it('reads text page by page', async () => {
    const pdf = makePdf([['Lecture 4: Orbits', 'Planets move in ellipses.'], ['Escape velocity is about 11.2 km/s.']]);
    const progress: number[] = [];
    const { sections } = await parsePdf('l.pdf', pdf, pdfjs, (d) => progress.push(d));
    expect(sections.map((s) => s.label)).toEqual(['p. 1', 'p. 2']);
    expect(sections[0].text).toContain('Planets move in ellipses.');
    expect(progress).toEqual([1, 2]);
  });
  it('detects scanned PDFs with no text', async () => {
    await expect(parsePdf('scan.pdf', makePdf([[], [], []]), pdfjs)).rejects.toThrow(/scanned PDF/);
  });
  it('fails clearly on a file that is not a PDF', async () => {
    await expect(parsePdf('x.pdf', new TextEncoder().encode('not a pdf at all'), pdfjs)).rejects.toThrow(FileError);
  });
});
