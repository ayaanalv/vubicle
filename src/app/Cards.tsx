import { useEffect, useMemo, useState } from 'react';
import { Sparkles, Plus, Pencil, Trash2, Play, Check, BookOpen } from 'lucide-react';
import { byCubicle, chunksFor, put, remove, uid, useLive, type Card } from './db';
import { ai, AiError } from './api';
import { findPassages, fileNames, spread, toPassages } from './retrieve';
import { newSchedule, review, preview, type Grade } from '../lib/srs';
import { Working, useNow } from './ui';
import { Rich } from './rich';
import { useDesk } from './App';

const MAKING = 'Making flashcards';

function when(due: number, now: number) {
  const ms = due - now;
  if (ms <= 0) return 'Due now';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `In ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `In ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Tomorrow' : `In ${d} days`;
}

export function Cards() {
  const { cubicle, fileId, openSource } = useDesk();
  const cards = useLive(() => byCubicle('cards', cubicle.id), ['cards'], [cubicle.id]);
  useNow(true, 30_000); // re-render so "due" stays current
  const now = Date.now();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [count, setCount] = useState(10);
  const [topic, setTopic] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { seed } = useDesk();
  // A topic handed over from the concept map.
  useEffect(() => {
    if (seed?.tool === 'cards') setTopic(seed.text);
  }, [seed?.n]);

  const due = (cards ?? []).filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
  const sorted = useMemo(() => [...(cards ?? [])].sort((a, b) => a.due - b.due), [cards]);

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      const existing = cards ?? [];
      const used = new Set(existing.map((c) => c.chunkId).filter(Boolean) as string[]);
      const scope = { cubicleId: cubicle.id, fileId };
      const chunks = topic.trim() ? await findPassages(scope, topic, 10) : spread(await chunksFor(cubicle.id, fileId), 10, used);
      if (!chunks.length) throw new AiError(`Nothing in your material matches “${topic}”.`);
      const names = await fileNames(cubicle.id);
      const out = await ai<{ cards: { front: string; back: string; source: number | null }[] }>(
        'flashcards',
        { passages: toPassages(chunks, names), count, avoid: existing.slice(-40).map((c) => c.front.slice(0, 200)) },
        { label: MAKING },
      );
      const t = Date.now();
      for (const c of out.cards)
        await put('cards', { id: uid(), cubicleId: cubicle.id, front: c.front, back: c.back, chunkId: c.source ? chunks[c.source - 1]?.id : undefined, manual: false, createdAt: t, ...newSchedule(t) });
      setTopic('');
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Those cards could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (reviewing) return <Review queue={due} onDone={() => setReviewing(false)} />;

  return (
    <div className="pane">
      <div className="head">
        <h1>Flashcards</h1>
        <div className="group">
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" /> Write a card
          </button>
          <button className="btn primary" disabled={!due.length} onClick={() => setReviewing(true)}>
            <Play aria-hidden="true" /> Review {due.length ? due.length : ''}
          </button>
        </div>
      </div>
      <div className="stats">
        <div className="stat due">
          <b className="num">{due.length}</b>
          <span>due now</span>
        </div>
        <div className="stat">
          <b className="num">{cards?.length ?? 0}</b>
          <span>cards</span>
        </div>
        <div className="stat">
          <b className="num">{(cards ?? []).filter((c) => c.reps >= 3).length}</b>
          <span>well known</span>
        </div>
      </div>

      <form
        className="notice"
        style={{ display: 'grid', gap: 12, marginBottom: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <strong>Make cards from your material</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className="sr-only" htmlFor="card-topic">
            Topic
          </label>
          <input id="card-topic" className="input" style={{ flex: '1 1 220px' }} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional), like “enzymes”" maxLength={200} />
          <label className="sr-only" htmlFor="card-count">
            How many
          </label>
          <select id="card-count" className="input" style={{ width: 'auto' }} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n} cards
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={busy}>
            <Sparkles aria-hidden="true" /> Make cards
          </button>
        </div>
        <span className="hint">Without a topic, new cards come from passages you have no cards for yet.</span>
      </form>
      {busy && <Working label={MAKING} />}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}

      {adding && <CardForm onCancel={() => setAdding(false)} onSave={async (front, back) => {
        const t = Date.now();
        await put('cards', { id: uid(), cubicleId: cubicle.id, front, back, manual: true, createdAt: t, ...newSchedule(t) });
        setAdding(false);
      }} />}

      {!!sorted.length && (
        <>
          <h2 style={{ margin: '28px 0 12px' }}>All cards</h2>
          <ul className="list">
            {sorted.map((c) =>
              editing === c.id ? (
                <li key={c.id}>
                  <CardForm
                    initial={c}
                    onCancel={() => setEditing(null)}
                    onSave={async (front, back) => {
                      await put('cards', { ...c, front, back });
                      setEditing(null);
                    }}
                  />
                </li>
              ) : (
                <li key={c.id}>
                  <Rich inline className="q" text={c.front} />
                  <Rich inline className="a" text={c.back} />
                  <span className="row-actions">
                    <span className="when" style={{ alignSelf: 'center', marginRight: 6 }}>
                      {when(c.due, now)}
                    </span>
                    {c.chunkId && (
                      <button className="btn ghost icon sm" aria-label="Open source" onClick={() => openSource(c.chunkId!)}>
                        <BookOpen aria-hidden="true" />
                      </button>
                    )}
                    <button className="btn ghost icon sm" aria-label={`Edit card: ${c.front}`} onClick={() => setEditing(c.id)}>
                      <Pencil aria-hidden="true" />
                    </button>
                    <button className="btn ghost icon sm" aria-label={`Delete card: ${c.front}`} onClick={() => remove('cards', c.id)}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function CardForm({ initial, onSave, onCancel }: { initial?: Card; onSave: (f: string, b: string) => void; onCancel: () => void }) {
  const [front, setFront] = useState(initial?.front ?? '');
  const [back, setBack] = useState(initial?.back ?? '');
  return (
    <form
      className="edit-grid"
      style={{ marginBottom: initial ? 0 : 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (front.trim() && back.trim()) onSave(front.trim(), back.trim());
      }}
    >
      <label className="field">
        <span>Front</span>
        <textarea className="input" style={{ minHeight: 80 }} value={front} onChange={(e) => setFront(e.target.value)} autoFocus required maxLength={300} />
      </label>
      <label className="field">
        <span>Back</span>
        <textarea className="input" style={{ minHeight: 80 }} value={back} onChange={(e) => setBack(e.target.value)} required maxLength={600} />
      </label>
      <div className="row-actions" style={{ gridColumn: '1 / -1', justifyContent: 'flex-end' }}>
        <button type="button" className="btn sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary sm">
          <Check aria-hidden="true" /> Save card
        </button>
      </div>
    </form>
  );
}

const GRADES: { g: Grade; label: string; key: string }[] = [
  { g: 'again', label: 'Again', key: '1' },
  { g: 'hard', label: 'Hard', key: '2' },
  { g: 'good', label: 'Good', key: '3' },
  { g: 'easy', label: 'Easy', key: '4' },
];

function Review({ queue, onDone }: { queue: Card[]; onDone: () => void }) {
  const { openSource } = useDesk();
  // Snapshot the queue so cards graded "again" do not jump straight back in.
  const [list] = useState(queue);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const card = list[i];

  const grade = async (g: Grade) => {
    if (!card) return;
    // Move on first, so a fast second key press lands on the next card.
    setShown(false);
    setI(i + 1);
    await put('cards', { ...card, ...review(card, g) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === ' ' && !shown) {
        e.preventDefault();
        setShown(true);
      } else if (shown) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) void grade(g.g);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!card)
    return (
      <div className="pane">
        <div className="empty" style={{ margin: '6vh auto 0' }}>
          <h1>All caught up</h1>
          <p>You reviewed {list.length} card{list.length === 1 ? '' : 's'}. They will come back right before you would forget them.</p>
          <button className="btn primary" onClick={onDone}>
            Back to flashcards
          </button>
        </div>
      </div>
    );

  return (
    <div className="pane">
      <div className="head">
        <h1>Review</h1>
        <div className="group">
          <span className="muted num" style={{ alignSelf: 'center' }}>
            {i + 1} of {list.length}
          </span>
          <button className="btn" onClick={onDone}>
            Stop
          </button>
        </div>
      </div>
      <div className="study">
        <button className="flash" onClick={() => setShown(true)} aria-label={shown ? undefined : 'Show the answer'} aria-live="polite">
          <Rich inline className="face" text={card.front} />
          {shown ? <Rich inline className="back" text={card.back} /> : <span className="muted small">Tap or press Space to show the answer</span>}
        </button>
        {shown && (
          <>
            <div className="grades" role="group" aria-label="How well did you know it?">
              {GRADES.map((x) => (
                <button key={x.g} className="btn" onClick={() => grade(x.g)} aria-keyshortcuts={x.key}>
                  {x.label}
                  <small>{preview(card, x.g)}</small>
                </button>
              ))}
            </div>
            {card.chunkId && (
              <button className="btn ghost sm" onClick={() => openSource(card.chunkId!)}>
                <BookOpen aria-hidden="true" /> See where this came from
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
