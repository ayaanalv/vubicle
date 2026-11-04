import { useState } from 'react';
import { ArrowLeft, FileText, Trash2 } from 'lucide-react';
import { byCubicle, chunksFor, put, remove, uid, useLive, type Brief, type BriefFormat, type BriefLength } from './db';
import { ai, AiError } from './api';
import { spread, toPassages } from './retrieve';
import { Working } from './ui';
import { Rich, citedNumbers } from './rich';
import { SourceChips } from './Chat';
import { useDesk } from './App';

const FORMATS: Record<BriefFormat, string> = { summary: 'Summary', guide: 'Study guide', terms: 'Key terms' };
const LENGTHS: Record<BriefLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' };
// Passages sampled evenly across each file, and how much of each is sent.
const SIZES: Record<BriefLength, { n: number; chars: number }> = { short: { n: 16, chars: 700 }, medium: { n: 28, chars: 800 }, long: { n: 36, chars: 900 } };
const MAX_FILES = 5;

const title = (b: Brief) => `${FORMATS[b.format]}: ${b.parts.map((p) => p.name.replace(/\.[a-z]+$/i, '')).join(', ')}`;

export function Briefs() {
  const { cubicle, fileId } = useDesk();
  const briefs = useLive(async () => (await byCubicle('briefs', cubicle.id)).sort((a, b) => b.createdAt - a.createdAt), ['briefs'], [cubicle.id]);
  // Same order as the file list: newest first.
  const files = useLive(async () => (await byCubicle('files', cubicle.id)).filter((f) => f.status === 'ready').sort((a, b) => b.addedAt - a.addedAt), ['files'], [cubicle.id]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [format, setFormat] = useState<BriefFormat>('summary');
  const [length, setLength] = useState<BriefLength>('medium');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Until the student picks, start from the file chosen at the top, or the first few files.
  const picked = (chosen ?? (fileId ? [fileId] : (files ?? []).slice(0, MAX_FILES).map((f) => f.id))).filter((id) => files?.some((f) => f.id === id));
  const toggle = (id: string) => setChosen(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const make = async () => {
    setError('');
    const todo = files!.filter((f) => picked.includes(f.id));
    const parts: Brief['parts'] = [];
    try {
      for (const [i, f] of todo.entries()) {
        const label = todo.length > 1 ? `Writing brief ${i + 1} of ${todo.length}` : 'Writing your brief';
        setBusy(label);
        const chunks = spread(await chunksFor(cubicle.id, f.id), SIZES[length].n);
        const out = await ai<{ text: string }>('brief', { passages: toPassages(chunks, new Map([[f.id, f.name]]), SIZES[length].chars), format, length }, { label });
        parts.push({ fileId: f.id, name: f.name, text: out.text, chunkIds: chunks.map((c) => c.id) });
      }
    } catch (e) {
      const why = e instanceof AiError ? e.message : 'That brief could not be written. Try again.';
      setError(parts.length ? `${why} The files done so far are saved.` : why);
    } finally {
      setBusy('');
    }
    if (!parts.length) return;
    const b: Brief = { id: uid(), cubicleId: cubicle.id, format, length, parts, createdAt: Date.now() };
    await put('briefs', b);
    setOpen(b.id);
  };

  const brief = briefs?.find((b) => b.id === open);
  if (brief) return <ReadBrief brief={brief} onBack={() => setOpen(null)} />;

  return (
    <div className="pane">
      <div className="head">
        <h1>Briefs</h1>
      </div>
      <form
        className="notice"
        style={{ display: 'grid', gap: 12, marginBottom: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <strong>New brief</strong>
        <fieldset className="brief-files">
          <legend className="small muted">Files, up to {MAX_FILES}</legend>
          {files?.map((f) => (
            <label key={f.id} className="option">
              <input type="checkbox" checked={picked.includes(f.id)} disabled={!picked.includes(f.id) && picked.length >= MAX_FILES} onChange={() => toggle(f.id)} />
              <span className="brief-name">{f.name}</span>
            </label>
          ))}
        </fieldset>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className="sr-only" htmlFor="brief-format">
            Format
          </label>
          <select id="brief-format" className="input" style={{ width: 'auto' }} value={format} onChange={(e) => setFormat(e.target.value as BriefFormat)}>
            {Object.entries(FORMATS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="brief-length">
            Length
          </label>
          <select id="brief-length" className="input" style={{ width: 'auto' }} value={length} onChange={(e) => setLength(e.target.value as BriefLength)}>
            {Object.entries(LENGTHS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!!busy || !picked.length}>
            <FileText aria-hidden="true" /> Write a brief
          </button>
        </div>
        <span className="hint">Each file gets its own brief, drawn from pages across the whole file. Every point links to its page.</span>
      </form>
      {busy && <Working label={busy} />}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
      {!!briefs?.length && (
        <>
          <h2 style={{ margin: '28px 0 12px' }}>Saved briefs</h2>
          <ul className="list">
            {briefs.map((b) => (
              <li key={b.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <span>
                  <button className="btn ghost" style={{ padding: 0, minHeight: 0, fontSize: 15, textAlign: 'left' }} onClick={() => setOpen(b.id)}>
                    {title(b)}
                  </button>
                  <span className="muted small" style={{ display: 'block' }}>
                    {LENGTHS[b.length]} · {b.parts.length} file{b.parts.length === 1 ? '' : 's'} · {new Date(b.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="row-actions">
                  <button className="btn sm" onClick={() => setOpen(b.id)}>
                    Read
                  </button>
                  <button className="btn ghost icon sm" aria-label={`Delete brief ${title(b)}`} onClick={() => remove('briefs', b.id)}>
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReadBrief({ brief, onBack }: { brief: Brief; onBack: () => void }) {
  const { openSource } = useDesk();
  return (
    <div className="pane">
      <div className="head">
        <button className="btn ghost sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> All briefs
        </button>
      </div>
      <h1 style={{ marginBottom: 6 }}>{FORMATS[brief.format]}</h1>
      <p className="muted" style={{ marginBottom: 20 }}>
        {LENGTHS[brief.length]} · from passages sampled across each file
      </p>
      {brief.parts.map((p) => {
        const used = citedNumbers(p.text).filter((n) => n <= p.chunkIds.length);
        return (
          <section key={p.fileId + p.name} className="brief">
            {brief.parts.length > 1 && <h2>{p.name}</h2>}
            <Rich text={p.text} onCite={(n) => openSource(p.chunkIds[n - 1], p.chunkIds)} max={p.chunkIds.length} />
            {used.length > 0 && <SourceChips ids={p.chunkIds} nums={used} />}
          </section>
        );
      })}
    </div>
  );
}
