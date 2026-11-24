import { describe, it, expect } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectKind, parsePptx, parseDocx, parseNote, parsePdf, FileError, decodeXml, elements, MAX_XML_BYTES } from '../../src/lib/parse';
import { zipSync, strToU8 } from 'fflate';
import { makePdf, makePptx, makeDocx, makeScannedPdf } from '../fixtures/make';

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
    expect(detectKind('board.JPG', new Uint8Array())).toBe('image');
    expect(detectKind('IMG_0042.heic', new Uint8Array())).toBe('image');
    expect(() => detectKind('a.xlsx', new Uint8Array())).toThrow(/not a file type/);
  });
});

describe('decodeXml', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &#960; &#x3A3;')).toBe('a & b <c> π Σ');
  });
});

describe('decodeXml limits', () => {
  it('keeps character references past U+10FFFF as they are, instead of throwing', () => {
    expect(decodeXml('x &#x110000; y &#99999999999; z &#x10FFFF;')).toBe('x &#x110000; y &#99999999999; z \u{10FFFF}');
  });
});

describe('reading Office XML', () => {
  const slide = (body: string) =>
    zipSync({ 'ppt/slides/slide1.xml': strToU8(`<p:sld><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`) });
  it('finds elements the same way the old regex did', () => {
    expect(elements('<a:p><a:pPr/>x</a:p><a:p/><a:p a="1">y</a:p>', 'a:p')).toEqual(['<a:p><a:pPr/>x</a:p>', '<a:p a="1">y</a:p>']);
  });
  it('reads a slide full of unclosed tags quickly', () => {
    const hostile = '<a:p><a:t>'.repeat(200_000) + '</a:t></a:p><a:p><a:r><a:t>Real text</a:t></a:r></a:p>';
    const t = Date.now();
    const { sections } = parsePptx('hostile.pptx', slide(hostile));
    expect(Date.now() - t).toBeLessThan(2000);
    expect(sections[0].text).toContain('Real text');
  });
  it('refuses a part too large to read, with a clear message', () => {
    const huge = slide('<a:p><a:r><a:t>' + 'x'.repeat(MAX_XML_BYTES) + '</a:t></a:r></a:p>');
    expect(() => parsePptx('huge.pptx', huge)).toThrow(/too large to read/);
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

  const scan = { width: 8, height: 8, gray: new Uint8Array(64).fill(200) };
  const ocrText: Record<number, string> = {
    2: 'Escape velocity is the minimum speed needed to leave a body with-\nout further thrust.',
    3: 'Satellites in lower orbits move faster than those further out.',
  };
  it('sends only picture pages with no text to text recognition, and keeps every page number', async () => {
    const asked: number[][] = [];
    const reader = async (_doc: unknown, pages: number[]) => (asked.push(pages), new Map(pages.map((p) => [p, ocrText[p]])));
    // Page 1 has text, 2 and 3 are scans, 4 is blank (no picture), 5 has text.
    const pdf = makeScannedPdf([['Lecture 4: Orbits and gravitation'], scan, scan, [], ['Kepler showed that orbits are ellipses.']]);
    const { sections } = await parsePdf('mixed.pdf', pdf, pdfjs, undefined, reader);
    expect(asked).toEqual([[2, 3]]);
    expect(sections.map((s) => s.label)).toEqual(['p. 1', 'p. 2', 'p. 3', 'p. 5']);
    expect(sections[1].page).toBe(2);
    expect(sections[1].text).toContain('leave a body without further thrust');
  });
  it('never calls text recognition for a normal PDF', async () => {
    let called = false;
    await parsePdf('l.pdf', makePdf([['Planets move in ellipses around the Sun.'], ['Escape velocity is about 11.2 km/s.']]), pdfjs, undefined, async () => ((called = true), new Map()));
    expect(called).toBe(false);
  });
  it('says plainly when text recognition finds nothing to read', async () => {
    await expect(parsePdf('blurry.pdf', makeScannedPdf([scan, scan]), pdfjs, undefined, async () => new Map([[1, ''], [2, ' ~ ']]))).rejects.toThrow(/text recognition found little or no text/);
  });
});
