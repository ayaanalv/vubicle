import { useEffect, useMemo, useState } from 'react';
import { Sparkles, MessagesSquare, Layers, BookOpen, RotateCcw, GraduationCap } from 'lucide-react';
import { byCubicle, chunksFor, put, uid, useLive, type MapData } from './db';
import { ai, AiError } from './api';
import { fileNames, spread, toPassages } from './retrieve';
import { forceLayout } from '../lib/layout';
import { Working } from './ui';
import { useDesk } from './App';

const MAPPING = 'Mapping the topics';

export function MapTool() {
  const { cubicle, fileId, go, openSource } = useDesk();
  const map = useLive(async () => (await byCubicle('maps', cubicle.id)).filter((m) => m.fileId === fileId).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null, ['maps'], [cubicle.id, fileId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 700px)').matches);
  useEffect(() => {
    const mq = matchMedia('(max-width: 700px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      const chunks = spread(await chunksFor(cubicle.id, fileId), 36);
      const names = await fileNames(cubicle.id);
      const out = await ai<{ topics: { id: string; label: string; summary: string; sources: number[] }[]; links: MapData['links'] }>(
        'map',
        { passages: toPassages(chunks, names, 700) },
        { label: MAPPING },
      );
      await put('maps', {
        id: uid(),
        cubicleId: cubicle.id,
        fileId,
        topics: out.topics.map((t) => ({ id: t.id, label: t.label, summary: t.summary, chunkIds: t.sources.map((s) => chunks[s - 1]?.id).filter(Boolean) })),
        links: out.links,
        createdAt: Date.now(),
      });
      setPicked(null);
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'The map could not be made. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const aspect = narrow ? 0.8 : 1.7;
  const pos = useMemo(() => (map ? forceLayout(map.topics.map((t) => t.id), map.links, aspect) : new Map()), [map?.id, aspect]);
  const topic = map?.topics.find((t) => t.id === picked);

  return (
    <div className="pane" style={{ maxWidth: 1100 }}>
      <div className="head">
        <h1>Concept map</h1>
        {map && (
          <button className="btn sm" onClick={make} disabled={busy}>
            <RotateCcw aria-hidden="true" /> Make a new map
          </button>
        )}
      </div>
      {map === null && !busy && (
        <div className="empty" style={{ margin: '2vh 0 0', padding: 0 }}>
          <p>See how the main topics in {fileId ? 'this file' : 'this course'} connect. Pick a topic to read its passages, ask about it, or turn it into cards.</p>
          <button className="btn primary" onClick={make}>
            <Sparkles aria-hidden="true" /> Map the topics
          </button>
        </div>
      )}
      {busy && <Working label={MAPPING} />}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
      {map && (
        <>
          <div className="mapbox" style={{ aspectRatio: String(aspect) }}>
            <svg viewBox={`0 0 ${aspect * 100} 100`} aria-hidden="true" preserveAspectRatio="none">
              {map.links.map((l, i) => {
                const a = pos.get(l.from);
                const b = pos.get(l.to);
                if (!a || !b) return null;
                return <line key={i} x1={a.x * aspect * 100} y1={a.y * 100} x2={b.x * aspect * 100} y2={b.y * 100} vectorEffect="non-scaling-stroke" />;
              })}
            </svg>
            {map.topics.map((t) => {
              const p = pos.get(t.id)!;
              return (
                <button key={t.id} className="node" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-pressed={picked === t.id} onClick={() => setPicked(picked === t.id ? null : t.id)}>
                  {t.label}
                </button>
              );
            })}
          </div>
          {topic ? (
            <div className="topic-panel" aria-live="polite">
              <h2>{topic.label}</h2>
              <p>{topic.summary}</p>
              {(() => {
                const rel = map.links.filter((l) => l.from === topic.id || l.to === topic.id);
                return rel.length ? (
                  <p className="muted small">
                    {rel
                      .map((l) => {
                        const other = map.topics.find((x) => x.id === (l.from === topic.id ? l.to : l.from))?.label;
                        return l.from === topic.id ? `${l.label} ${other}` : `${other} ${l.label} this`;
                      })
                      .join(' · ')}
                  </p>
                ) : null;
              })()}
              <div className="chips">
                <button className="btn sm" onClick={() => go('chat', `Explain ${topic.label} using my notes`)}>
                  <MessagesSquare aria-hidden="true" /> Ask about it
                </button>
                <button className="btn sm" onClick={() => go('tutor', topic.label)}>
                  <GraduationCap aria-hidden="true" /> Get quizzed on it
                </button>
                <button className="btn sm" onClick={() => go('cards', topic.label)}>
                  <Layers aria-hidden="true" /> Make cards
                </button>
                {topic.chunkIds[0] && (
                  <button className="btn sm" onClick={() => openSource(topic.chunkIds[0], topic.chunkIds)}>
                    <BookOpen aria-hidden="true" /> Read the passages
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="muted small" style={{ marginTop: 12 }}>
              {map.topics.length} topics. Pick one to study it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
