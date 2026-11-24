// Turns course files into sections of plain text, each with the label a citation will show
// ("p. 4", "Slide 7", a heading). Runs in the browser; nothing is uploaded.
import { unzipSync, strFromU8 } from 'fflate';

export type FileKind = 'pdf' | 'pptx' | 'docx' | 'note' | 'image';

export interface Section {
  /** What a citation shows, e.g. "p. 4" or "Slide 7". */
  label: string;
  /** 1-based page, slide or part number, for ordering and for opening the original. */
  page: number;
  text: string;
}

export interface Parsed {
  kind: FileKind;
  sections: Section[];
}

/** An error whose message is safe and helpful to show the student as is. */
export class FileError extends Error {}

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

export function detectKind(name: string, bytes: Uint8Array): FileKind {
  const ext = name.toLowerCase().split('.').pop() || '';
  const ole = OLE_MAGIC.every((b, i) => bytes[i] === b);
  if (ext === 'ppt') {
    throw new FileError(`"${name}" is an older PowerPoint file (.ppt). Open it in PowerPoint or Google Slides, save it as .pptx or PDF, and add that instead.`);
  }
  if (ext === 'doc') {
    throw new FileError(`"${name}" is an older Word file (.doc). Open it in Word or Google Docs, save it as .docx or PDF, and add that instead.`);
  }
  if (ole) {
    throw new FileError(`"${name}" is in an older Office format. Save it as .pptx, .docx or PDF, and add that instead.`);
  }
  if (ext === 'pdf' || strFromU8(bytes.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'docx') return 'docx';
  if (['txt', 'md', 'markdown'].includes(ext)) return 'note';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  throw new FileError(`"${name}" is not a file type Vubicle can read. Use PDF, PowerPoint (.pptx), Word (.docx), a text file or a photo (.jpg, .png, .webp, .heic).`);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // fromCodePoint throws past U+10FFFF, which would abort the whole file over one bad character.
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

const tidy = (s: string) => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * Largest XML part read from a .pptx or .docx. A real slide is well under 1 MB and the main part of a very
 * long Word document a few MB, so this only stops files built to be slow or to fill memory.
 */
export const MAX_XML_BYTES = 20 * 1024 * 1024;

const tooBig = (name: string) =>
  new FileError(`"${name}" has a slide or section too large to read. Save it as a PDF and add that instead.`);

/** Unzips only the XML parts (slides, notes, document, relationships), never images or media. */
function unzip(name: string, bytes: Uint8Array) {
  let files: Record<string, Uint8Array>;
  try {
    // The size a zip declares is the most it can unzip to here, so a part claiming more is refused unopened.
    files = unzipSync(bytes, {
      filter: (f) => {
        if (!/\.(xml|rels)$/.test(f.name)) return false;
        if (f.originalSize > MAX_XML_BYTES) throw tooBig(name);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof FileError) throw e;
    throw new FileError(`"${name}" looks damaged or is not really a ${name.split('.').pop()} file. Try saving it again.`);
  }
  for (const part of Object.values(files)) if (part.length > MAX_XML_BYTES) throw tooBig(name);
  return files;
}

/**
 * Each <tag ...>...</tag> element, from the first opening tag to the next closing tag, the same as the regex
 * /<tag[\s>][\s\S]*?<\/tag>/g. That regex rescans to the end of the part for every opening tag that has no
 * closing tag, so a part full of them froze the page; this walks the text once.
 */
export function elements(xml: string, tag: string): string[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const out: string[] = [];
  let at = 0;
  for (;;) {
    let start = xml.indexOf(open, at);
    // "<a:p" also starts "<a:pPr"; only a space or ">" after the name makes it this tag.
    while (start >= 0 && !/[\s>]/.test(xml[start + open.length] ?? '')) start = xml.indexOf(open, start + 1);
    if (start < 0) break;
    const end = xml.indexOf(close, start);
    if (end < 0) break;
    out.push(xml.slice(start, end + close.length));
    at = end + close.length;
  }
  return out;
}

/** Text of each <a:p> paragraph in a DrawingML part (slides and notes). */
function drawingText(xml: string): string {
  // Text runs hold no tags ("<" is written &lt;), so [^<]* matches them without rescanning.
  return elements(xml, 'a:p')
    .map((p) => [...p.matchAll(/<a:t(?:\s[^<>]*)?>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''))
    .filter((t) => t.trim())
    .join('\n');
}

export function parsePptx(name: string, bytes: Uint8Array): Parsed {
  const files = unzip(name, bytes);
  const slideNames = Object.keys(files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!slideNames.length) throw new FileError(`"${name}" has no slides Vubicle can read.`);

  // Slide order comes from presentation.xml when present; file numbers can differ after reordering.
  const order = presentationOrder(files);
  const ordered = order.length ? order.filter((f) => files[f]) : slideNames;

  const sections: Section[] = [];
  ordered.forEach((slidePath, i) => {
    let text = drawingText(strFromU8(files[slidePath]));
    const rels = files[slidePath.replace('slides/', 'slides/_rels/') + '.rels'];
    const notesTarget = rels && strFromU8(rels).match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/);
    if (notesTarget) {
      const notes = files['ppt/notesSlides/' + notesTarget[1]];
      // Notes parts also contain the slide number placeholder; drop lines that are only digits.
      const nt = notes ? drawingText(strFromU8(notes)).split('\n').filter((l) => !/^\d+$/.test(l.trim())).join('\n') : '';
      if (nt.trim()) text += `\n\nSpeaker notes:\n${nt}`;
    }
    text = tidy(text);
    if (text) sections.push({ label: `Slide ${i + 1}`, page: i + 1, text });
  });
  if (!sections.length) throw new FileError(`"${name}" has slides but no text. If the slides are pictures of text, export them as a PDF with text first.`);
  return { kind: 'pptx', sections };
}

function presentationOrder(files: Record<string, Uint8Array>): string[] {
  const pres = files['ppt/presentation.xml'];
  const rels = files['ppt/_rels/presentation.xml.rels'];
  if (!pres || !rels) return [];
  const relMap = new Map<string, string>();
  for (const m of strFromU8(rels).matchAll(/<Relationship\b[^<>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) relMap.set(id, 'ppt/' + target.replace(/^\/?ppt\//, ''));
  }
  return [...strFromU8(pres).matchAll(/<p:sldId\b[^<>]*r:id="([^"<>]+)"/g)].map((m) => relMap.get(m[1]) || '').filter(Boolean);
}

export function parseDocx(name: string, bytes: Uint8Array): Parsed {
  const files = unzip(name, bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new FileError(`"${name}" is not a Word document Vubicle can read.`);
  const xml = strFromU8(doc);
  const paras = elements(xml, 'w:p').map((p) => {
    const heading = /<w:pStyle w:val="(Heading\d|Title)"/i.test(p);
    const text = p
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .match(/<w:t(?:\s[^<>]*)?>[^<]*<\/w:t>|\t|\n/g)
      ?.map((t) => (t.startsWith('<') ? decodeXml(t.replace(/<[^<>]*>/g, '')) : t))
      .join('') ?? '';
    return { heading, text: text.trim() };
  });
  return { kind: 'docx', sections: groupParagraphs(name, paras) };
}

/** Word files have no reliable pages, so sections follow headings, or ~1500-character parts without them. */
function groupParagraphs(name: string, paras: { heading: boolean; text: string }[]): Section[] {
  const sections: Section[] = [];
  let title = '';
  let buf: string[] = [];
  const flush = () => {
    const text = tidy(buf.join('\n'));
    if (text) {
      const n = sections.length + 1;
      sections.push({ label: title ? title.slice(0, 60) : `Part ${n}`, page: n, text: title ? `${title}\n${text}` : text });
    }
    buf = [];
  };
  for (const p of paras) {
    if (!p.text) continue;
    if (p.heading) {
      flush();
      title = p.text;
    } else {
      buf.push(p.text);
      if (!title && buf.join('\n').length > 1500) flush();
    }
  }
  flush();
  if (!sections.length) throw new FileError(`"${name}" has no text Vubicle can read.`);
  return sections;
}

/** Typed or pasted notes. Markdown-style headings ("# Week 3") start a new section. */
export function parseNote(title: string, text: string): Parsed {
  const paras = text.split(/\n/).map((line) => {
    const m = line.match(/^#{1,6}\s+(.*)/);
    return { heading: Boolean(m), text: (m ? m[1] : line).trim() };
  });
  return { kind: 'note', sections: groupParagraphs(title, paras) };
}

// Minimal slice of the pdf.js API we use, so tests can pass the Node build and the app the browser one.
interface PdfJs {
  OPS: Record<string, number>;
  getDocument(src: { data: Uint8Array; useSystemFonts?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; getOperatorList(): Promise<{ fnArray: number[] }> }>;
    }>;
  };
}

/**
 * Reads scanned pages with text recognition (OCR). Given the open pdf.js document and the page numbers
 * (from 1) that are pictures with no text; returns each page's text. Kept outside this file so the
 * recognition code is only loaded when a PDF needs it.
 */
export type ScanReader = (doc: unknown, pages: number[]) => Promise<Map<number, string>>;

/** At least two words of two or more letters: a diagram's labels ("Sun", "Earth") count, stray marks don't. */
const hasWords = (s: string) => (s.match(/\p{L}{2,}/gu) ?? []).length >= 2;

const IMAGE_OPS = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintImageXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat'];

export async function parsePdf(
  name: string,
  bytes: Uint8Array,
  pdfjs: PdfJs,
  onProgress?: (done: number, total: number) => void,
  readScanned?: ScanReader,
): Promise<Parsed> {
  let doc;
  try {
    // pdf.js may detach the buffer it is given, so pass a copy and keep the original for storage.
    // No isEvalSupported or enableScripting here: pdf.js 6 removed isEvalSupported and no longer uses eval,
    // and enableScripting only affects the form and annotation layer, which Vubicle never draws. Scripts in a
    // PDF never run, and the Content Security Policy blocks eval anyway.
    doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/password/i.test(msg)) throw new FileError(`"${name}" is password protected. Remove the password and add it again.`);
    // The detail lets a tester report why, e.g. a browser missing a feature the PDF reader needs.
    const detail = `${(e as Error)?.name || 'Error'}: ${msg}`.replace(/\s+/g, ' ').slice(0, 160);
    throw new FileError(`"${name}" could not be opened as a PDF. It may be damaged, or this browser may be too old to read it. (Details: ${detail})`);
  }
  const imageOps = new Set(IMAGE_OPS.map((k) => pdfjs.OPS[k]).filter((v) => v !== undefined));
  let sections: Section[] = [];
  // Pages with no selectable text that show a picture: scanned pages. Blank pages are skipped, so a
  // normal PDF never loads the recognition code.
  const scanned: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
      if (typeof it.str !== 'string') continue;
      text += it.str + (it.hasEOL ? '\n' : it.str.endsWith(' ') ? '' : ' ');
    }
    // Join words hyphenated across line ends.
    text = tidy(text.replace(/(\w)-\n(\w)/g, '$1$2'));
    if (text.length >= 3) sections.push({ label: `p. ${i}`, page: i, text });
    else if (readScanned && (await page.getOperatorList()).fnArray.some((f) => imageOps.has(f))) scanned.push(i);
    onProgress?.(i, doc.numPages);
  }
  if (scanned.length && readScanned) {
    const read = await readScanned(doc, scanned);
    for (const [page, raw] of read) {
      const text = tidy(raw.replace(/(\w)-\n(\w)/g, '$1$2'));
      // A diagram or photo often yields nothing or a few stray marks. Skip such pages quietly; whether
      // the file as a whole has enough text is decided below.
      if (hasWords(text)) sections.push({ label: `p. ${page}`, page, text });
    }
    sections = sections.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  }
  const chars = sections.reduce((n, s) => n + s.text.length, 0);
  if (chars < Math.max(40, doc.numPages * 15)) {
    throw new FileError(
      scanned.length
        ? `"${name}" is a scanned PDF, and text recognition found little or no text in it. The scan may be faint, blurry or handwritten. Try a clearer scan, or take photos of the pages and add those instead.`
        : `"${name}" looks like a scanned PDF: its pages are pictures, with no text to read. Run it through text recognition (OCR), for example by opening it in Google Drive with Google Docs, then add the result.`,
    );
  }
  return { kind: 'pdf', sections };
}
