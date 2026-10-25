// Builds small PDF, PPTX and DOCX files in memory for tests, so no binary fixtures live in the repo.
import { zipSync, strToU8 } from 'fflate';

/** A valid PDF with one line per entry on each page. An empty page list gives a page with no text, like a scan. */
export function makePdf(pages: string[][]): Uint8Array {
  const objs: string[] = [];
  const kids: number[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let n = 4;
  for (const lines of pages) {
    const pageId = n++;
    const contentId = n++;
    kids.push(pageId);
    const esc = (s: string) => s.replace(/([()\\])/g, '\\$1');
    const stream = lines.length ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET` : '';
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objs[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  objs[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Slides as lists of paragraphs, with optional speaker notes per slide. */
export function makePptx(slides: { paras: string[]; notes?: string }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const rels: string[] = [];
  const ids: string[] = [];
  slides.forEach((s, i) => {
    const n = i + 1;
    const paras = s.paras.map((p) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEsc(p)}</a:t></a:r></a:p>`).join('');
    files[`ppt/slides/slide${n}.xml`] = strToU8(`<p:sld><p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (s.notes) {
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(`<Relationships><Relationship Id="rId2" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`);
      files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(`<p:notes><a:p><a:r><a:t>${xmlEsc(s.notes)}</a:t></a:r></a:p><a:p><a:r><a:t>${n}</a:t></a:r></a:p></p:notes>`);
    }
    rels.push(`<Relationship Id="rId${n + 10}" Target="slides/slide${n}.xml"/>`);
    ids.push(`<p:sldId id="${256 + n}" r:id="rId${n + 10}"/>`);
  });
  files['ppt/presentation.xml'] = strToU8(`<p:presentation><p:sldIdLst>${ids.join('')}</p:sldIdLst></p:presentation>`);
  files['ppt/_rels/presentation.xml.rels'] = strToU8(`<Relationships>${rels.join('')}</Relationships>`);
  return zipSync(files);
}

/** Paragraphs; a leading "# " marks a heading. */
export function makeDocx(paras: string[]): Uint8Array {
  const body = paras
    .map((p) =>
      p.startsWith('# ')
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${xmlEsc(p.slice(2))}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`,
    )
    .join('');
  return zipSync({ 'word/document.xml': strToU8(`<w:document><w:body>${body}</w:body></w:document>`) });
}
