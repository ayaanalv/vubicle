// Text recognition (OCR) for scanned PDF pages, entirely in this browser. Tesseract.js and its files are
// served from this site under /ocr/ (copied there by vite.config.ts) and loaded only when a PDF has a
// scanned page, never on normal page load. Nothing is sent anywhere.
//
// The Content Security Policy allows WebAssembly only for files under /ocr/ (see vercel.json), which is
// why the worker is started from its own URL there instead of from a blob.

import { FileError } from '../lib/parse';

export interface ScanStep {
  /** True while the recognition files load (only slow the first time). */
  preparing: boolean;
  /** The scanned page being read, counted among scanned pages only (1-based), and how many there are. */
  page: number;
  total: number;
}

/** Thrown when the student cancels; the caller drops the file quietly. */
export class Cancelled extends Error {}

// About 300 dots per inch, which Tesseract reads best, capped so a poster-sized page can't exhaust memory.
const DPI_SCALE = 300 / 72;
const MAX_SIDE = 3500;

interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; viewport: unknown }): { promise: Promise<void>; cancel(): void };
  cleanup(): void;
}
interface PdfDoc {
  getPage(n: number): Promise<PdfPage>;
}

/** Waits for `p`, but rejects with Cancelled as soon as `signal` aborts. */
function orCancel<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Cancelled());
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Cancelled());
    signal.addEventListener('abort', stop, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

async function renderPage(doc: PdfDoc, n: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(DPI_SCALE, MAX_SIDE / Math.max(base.width, base.height)) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Reads each scanned page in order, so every passage keeps its own page number for citations. */
export async function readScannedPages(doc: unknown, pages: number[], signal: AbortSignal, onStep: (s: ScanStep) => void): Promise<Map<number, string>> {
  const total = pages.length;
  onStep({ preparing: true, page: 0, total });
  const base = `${location.origin}/ocr`;
  let worker: import('tesseract.js').Worker;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A missing worker file comes back as a web page, and Tesseract then waits forever. Check it first.
    const head = await orCancel(fetch(`${base}/worker.min.js`, { method: 'HEAD' }), signal);
    if (!head.ok || !/javascript/.test(head.headers.get('content-type') ?? '')) throw new Error(`OCR worker not found (${head.status} ${head.headers.get('content-type')})`);
    const tesseract = await orCancel(import('tesseract.js'), signal);
    // About 4 MB on first use. Three minutes covers a slow connection; past that, say so instead of hanging.
    const tooSlow = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('OCR took too long to start')), 180_000)));
    worker = await orCancel(
      Promise.race([
        tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, {
          workerPath: `${base}/worker.min.js`,
          corePath: base,
          langPath: base,
          workerBlobURL: false,
        }),
        tooSlow,
      ]),
      signal,
    );
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    console.error(e);
    throw new FileError('This PDF is scanned, and the text recognition tools could not be loaded. Check your connection and add the file again.');
  } finally {
    clearTimeout(timer);
  }
  const stop = () => void worker.terminate();
  signal.addEventListener('abort', stop, { once: true });
  const out = new Map<number, string>();
  try {
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new Cancelled();
      onStep({ preparing: false, page: i + 1, total });
      const canvas = await orCancel(renderPage(doc as PdfDoc, pages[i]), signal);
      const { data } = await orCancel(worker.recognize(canvas), signal);
      out.set(pages[i], data.text);
      // Free the large canvas right away; long scans would otherwise hold hundreds of MB.
      canvas.width = canvas.height = 0;
    }
  } finally {
    signal.removeEventListener('abort', stop);
    void worker.terminate().catch(() => {});
  }
  return out;
}
