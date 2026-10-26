import { useEffect, useRef, useState } from 'react';
import { X, FileSearch } from 'lucide-react';
import { db, useLive } from './db';
import { loadPdfJs } from './ingest';

/** Shows a cited passage in context: the passage, its neighbours, and for PDFs the page itself. */
export function Viewer({ chunkId, all, onPick, onClose }: { chunkId: string; all: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const data = useLive(
    async () => {
      const d = await db();
      const c = await d.get('chunks', chunkId);
      if (!c) return null;
      const file = await d.get('files', c.fileId);
      const near = (await d.getAllFromIndex('chunks', 'file', c.fileId)).filter((x) => Math.abs(x.ord - c.ord) === 1).sort((a, b) => a.ord - b.ord);
      const labels = await Promise.all(all.map(async (id) => (await d.get('chunks', id))?.label ?? ''));
      return { c, file, before: near.filter((x) => x.ord < c.ord), after: near.filter((x) => x.ord > c.ord), labels };
    },
    ['chunks', 'files'],
    [chunkId, all.join()],
  );
  const [showPage, setShowPage] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  const hit = useRef<HTMLDivElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    setShowPage(false);
    hit.current?.scrollIntoView({ block: 'center' });
  }, [chunkId, data?.c?.id]);

  return (
    <aside className="viewer" aria-label="Source">
      <div className="viewer-head">
        <div>
          <h2>{data?.file?.name ?? (data === null ? 'Source removed' : 'Source')}</h2>
          {data?.c && <p className="muted small">{data.c.label}</p>}
        </div>
        <button ref={close} className="btn ghost icon" aria-label="Close source" onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="viewer-body">
        {all.length > 1 && (
          <div className="sources" aria-label="Sources in this answer">
            {all.map((id, i) => (
              <button key={id} className="source" aria-pressed={id === chunkId} onClick={() => onPick(id)} style={id === chunkId ? { borderColor: 'var(--data)' } : undefined}>
                <b>{i + 1}</b> <span>{data?.labels[i]}</span>
              </button>
            ))}
          </div>
        )}
        {data === null && <p className="muted">The file this came from has been removed from the cubicle.</p>}
        {data?.c && (
          <>
            {data.file?.kind === 'pdf' && (
              <button className="btn sm" onClick={() => setShowPage(!showPage)} aria-expanded={showPage}>
                <FileSearch aria-hidden="true" /> {showPage ? 'Hide the page' : `Show ${data.c.label} as printed`}
              </button>
            )}
            {showPage && data.file && <PdfPage fileId={data.file.id} page={data.c.page} />}
            {data.before.map((b) => (
              <div key={b.id} className="passage near">
                {b.text}
              </div>
            ))}
            <div ref={hit} className="passage hit">
              {data.c.text}
            </div>
            {data.after.map((b) => (
              <div key={b.id} className="passage near">
                {b.text}
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function PdfPage({ fileId, page }: { fileId: string; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await (await db()).get('blobs', fileId);
        if (!blob) throw new Error('missing');
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.data.arrayBuffer()) }).promise;
        const p = await doc.getPage(page);
        const el = canvas.current;
        if (cancelled || !el) return;
        const width = el.parentElement?.clientWidth || 380;
        const base = p.getViewport({ scale: 1 });
        const vp = p.getViewport({ scale: (width / base.width) * Math.min(2, devicePixelRatio || 1) });
        el.width = vp.width;
        el.height = vp.height;
        await p.render({ canvas: el, viewport: vp }).promise;
        if (!cancelled) setState('ok');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, page]);
  return (
    <>
      {state === 'loading' && <p className="muted small">Drawing the page…</p>}
      {state === 'error' && <p className="muted small">This page could not be drawn.</p>}
      <canvas ref={canvas} className="page-canvas" hidden={state !== 'ok'} aria-label={`Page ${page} of the PDF`} role="img" />
    </>
  );
}
