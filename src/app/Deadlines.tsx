import { useEffect, useState } from 'react';
import { Sparkles, Plus, Trash2, CalendarPlus, BookOpen } from 'lucide-react';
import { byCubicle, chunksFor, put, remove, uid, useLive, type Deadline } from './db';
import { ai, AiError } from './api';
import { fileNames, syllabusPassages, toPassages } from './retrieve';
import { toIcs } from '../lib/ics';
import { Working } from './ui';
import { useDesk } from './App';

const FINDING = 'Reading the syllabus';
const KINDS = ['exam', 'test', 'quiz', 'assignment', 'lab', 'project', 'presentation', 'other'];

function daysUntil(date: string) {
  const d = new Date(date + 'T00:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function Deadlines() {
  const { cubicle, fileId, openSource } = useDesk();
  const items = useLive(
    async () => (await byCubicle('deadlines', cubicle.id)).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.createdAt - b.createdAt),
    ['deadlines'],
    [cubicle.id],
  );
  const files = useLive(async () => (await byCubicle('files', cubicle.id)).filter((f) => f.status === 'ready'), ['files'], [cubicle.id]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState<number | null>(null);

  // Guess the syllabus: the chosen file, or one whose name says so.
  useEffect(() => {
    if (!files?.length || source) return;
    setSource(fileId ?? files.find((f) => /syllab|outline|course.?info/i.test(f.name))?.id ?? files[0].id);
  }, [files, fileId]);

  const find = async () => {
    setBusy(true);
    setError('');
    setFound(null);
    try {
      const chunks = syllabusPassages(await chunksFor(cubicle.id, source), 30);
      if (!chunks.length) throw new AiError('That file has no text to read.');
      const names = await fileNames(cubicle.id);
      const out = await ai<{ items: { title: string; date: string | null; weight: number | null; kind: string; source: number | null }[] }>(
        'deadlines',
        { passages: toPassages(chunks, names) },
        { label: FINDING, cache: true },
      );
      // Running it again only adds what is not on the list yet, so edits are never overwritten.
      const have = new Set((items ?? []).map((d) => `${d.title.toLowerCase()}|${d.date}`));
      let added = 0;
      for (const d of out.items) {
        if (have.has(`${d.title.toLowerCase()}|${d.date}`)) continue;
        await put('deadlines', { id: uid(), cubicleId: cubicle.id, title: d.title, date: d.date, weight: d.weight, kind: d.kind, done: false, chunkId: d.source ? chunks[d.source - 1]?.id : undefined, createdAt: Date.now() + added });
        added++;
      }
      setFound(added);
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'The dates could not be found. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const update = (d: Deadline, patch: Partial<Deadline>) => put('deadlines', { ...d, ...patch });
  const exportIcs = () => {
    const ics = toIcs(
      cubicle.name,
      (items ?? []).filter((d) => d.date && !d.done).map((d) => ({ id: d.id, title: `${d.title}${d.weight !== null ? ` (${d.weight}%)` : ''}`, date: d.date!, description: `${cubicle.name}. Added from Vubicle.` })),
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    a.download = `${cubicle.name.replace(/[^\w-]+/g, '-')}-deadlines.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const weight = (items ?? []).reduce((s, d) => s + (d.weight ?? 0), 0);
  const dated = (items ?? []).filter((d) => d.date && !d.done).length;

  return (
    <div className="pane" style={{ maxWidth: 1000 }}>
      <div className="head">
        <h1>Deadlines</h1>
        <div className="group">
          <button className="btn" onClick={() => put('deadlines', { id: uid(), cubicleId: cubicle.id, title: 'New item', date: null, weight: null, kind: 'assignment', done: false, createdAt: Date.now() })}>
            <Plus aria-hidden="true" /> Add a row
          </button>
          <button className="btn primary" onClick={exportIcs} disabled={!dated}>
            <CalendarPlus aria-hidden="true" /> Add to calendar
          </button>
        </div>
      </div>
      <form
        className="notice"
        style={{ display: 'grid', gap: 12, marginBottom: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <strong>Find dates in a syllabus</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className="sr-only" htmlFor="syllabus">
            Syllabus file
          </label>
          <select id="syllabus" className="input" style={{ flex: '1 1 220px' }} value={source} onChange={(e) => setSource(e.target.value)}>
            {files?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={busy || !source}>
            <Sparkles aria-hidden="true" /> Find deadlines
          </button>
        </div>
        <span className="hint">Exams, assignments and their weights go into the list below. Check them against the syllabus; you can edit everything.</span>
      </form>
      {busy && <Working label={FINDING} />}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
      {found !== null && (
        <p className="notice" role="status" style={{ marginBottom: 16 }}>
          {found ? `Added ${found} item${found === 1 ? '' : 's'}.` : 'Nothing new found. Everything in the syllabus is already on the list.'}
        </p>
      )}

      {!!items?.length && (
        <>
          <div className="stats">
            <div className="stat">
              <b className="num">{dated}</b>
              <span>dated and not done</span>
            </div>
            <div className="stat">
              <b className="num">{Math.round(weight * 10) / 10}%</b>
              <span>of the grade listed</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="t-check">Done</th>
                  <th>What</th>
                  <th className="t-date">Date</th>
                  <th className="t-weight" style={{ textAlign: 'right' }}>
                    Weight (%)
                  </th>
                  <th className="t-kind">Kind</th>
                  <th className="t-act">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => {
                  const days = d.date ? daysUntil(d.date) : null;
                  return (
                    <tr key={d.id} className={d.done ? 'done' : undefined}>
                      <td className="t-check">
                        <input type="checkbox" checked={d.done} onChange={(e) => update(d, { done: e.target.checked })} aria-label={`Mark ${d.title} done`} />
                      </td>
                      <td className="t-title">
                        <input className="input" defaultValue={d.title} aria-label="Title" onBlur={(e) => e.target.value.trim() !== d.title && update(d, { title: e.target.value.trim() || d.title })} />
                        {days !== null && !d.done && days >= 0 && days <= 7 && <span className="soon small">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`}</span>}
                      </td>
                      <td className="t-date">
                        <input className="input num" type="date" value={d.date ?? ''} aria-label={`Date for ${d.title}`} onChange={(e) => update(d, { date: e.target.value || null })} />
                      </td>
                      <td className="t-weight">
                        <input
                          className="input num"
                          inputMode="decimal"
                          defaultValue={d.weight ?? ''}
                          aria-label={`Weight of ${d.title}, percent`}
                          placeholder="–"
                          onBlur={(e) => {
                            const v = e.target.value.trim() === '' ? null : Number(e.target.value.replace('%', ''));
                            if (v === null || (Number.isFinite(v) && v >= 0 && v <= 100)) update(d, { weight: v });
                            else e.target.value = String(d.weight ?? '');
                          }}
                        />
                      </td>
                      <td className="t-kind">
                        <select className="input" value={d.kind} aria-label={`Kind of ${d.title}`} onChange={(e) => update(d, { kind: e.target.value })}>
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k[0].toUpperCase() + k.slice(1)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="t-act">
                        <span className="row-actions">
                          {d.chunkId && (
                            <button className="btn ghost icon sm" aria-label={`Source for ${d.title}`} onClick={() => openSource(d.chunkId!)}>
                              <BookOpen aria-hidden="true" />
                            </button>
                          )}
                          <button className="btn ghost icon sm" aria-label={`Delete ${d.title}`} onClick={() => remove('deadlines', d.id)}>
                            <Trash2 aria-hidden="true" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
