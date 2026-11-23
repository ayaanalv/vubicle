// The landing page's hero: real answers from a sample cubicle, with the page each one cites beside it.
// It reads the same sample file the workspace opens (public/samples/), through the same backup checks, and
// draws answers with the workspace's renderer (src/app/rich.tsx). Nothing is sent to an AI.
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Rich, citedNumbers } from '../app/rich';
import { readBackupZip, readManifest, buildImport } from '../lib/backup';
import { SAMPLES, type Sample } from '../app/samples';
import type { StoredChunk } from '../app/db';

interface Turn {
  question: string;
  answer: string;
  /** Passage ids, in citation order: [1] is cites[0]. */
  cites: string[];
}

interface Loaded {
  turns: Turn[];
  chunks: Map<string, StoredChunk>;
  fileNames: Map<string, string>;
}

const cache = new Map<string, Promise<Loaded>>();

function load(sample: Sample): Promise<Loaded> {
  if (!cache.has(sample.id)) {
    cache.set(
      sample.id,
      (async () => {
        const res = await fetch(`/samples/${sample.id}.vubicle`);
        if (!res.ok) throw new Error('not found');
        let n = 0;
        const r = buildImport(readManifest(await readBackupZip(await res.blob())), () => `s${++n}`);
        const msgs = r.chats[0]?.messages ?? [];
        const turns: Turn[] = [];
        for (let i = 0; i < msgs.length - 1; i++)
          if (msgs[i].role === 'student' && msgs[i + 1].role === 'assistant') turns.push({ question: msgs[i].text, answer: msgs[i + 1].text, cites: msgs[i + 1].cites ?? [] });
        return { turns, chunks: new Map(r.chunks.map((c) => [c.id, c])), fileNames: new Map(r.files.map((f) => [f.record.id, f.record.name])) };
      })(),
    );
    cache.get(sample.id)!.catch(() => cache.delete(sample.id));
  }
  return cache.get(sample.id)!;
}

function HeroChat() {
  const [sample, setSample] = useState<Sample>(SAMPLES[0]);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [turn, setTurn] = useState(0);
  const [cite, setCite] = useState(1);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setFailed(false);
    load(sample).then(
      (d) => {
        if (!alive) return;
        setData(d);
        setTurn(0);
        setCite(citedNumbers(d.turns[0]?.answer ?? '')[0] ?? 1);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [sample]);

  const pick = (i: number) => {
    if (!data) return;
    setTurn(i);
    setCite(citedNumbers(data.turns[i].answer)[0] ?? 1);
  };

  const t = data?.turns[turn];
  const used = t ? citedNumbers(t.answer).filter((n) => n <= t.cites.length) : [];
  const cited = t ? data!.chunks.get(t.cites[cite - 1]) : undefined;
  // The cited page: every passage on it, in order, with the cited one marked.
  const page = cited ? [...data!.chunks.values()].filter((c) => c.fileId === cited.fileId && c.page === cited.page).sort((a, b) => a.ord - b.ord) : [];

  // Bring the cited passage into view inside the page panel only; the window itself never scrolls.
  useEffect(() => {
    const panel = pageRef.current;
    const hit = panel?.querySelector<HTMLElement>('.hit');
    if (panel && hit && panel.scrollHeight > panel.clientHeight) {
      panel.scrollTo({ top: hit.offsetTop - panel.offsetTop - 64, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [cited?.id]);

  return (
    <div className="hc">
      <div className="hc-samples" role="group" aria-label="Sample course">
        {SAMPLES.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === sample.id} onClick={() => setSample(s)}>
            {s.label}
          </button>
        ))}
      </div>
      {failed && <p className="hc-note">The sample could not be loaded. Open it in the workspace instead.</p>}
      {!data && !failed && <p className="hc-note">Loading the sample…</p>}
      {data && t && (
        <div className="hc-body">
          <div className="hc-chat">
            <div className="hc-questions" role="group" aria-label="Questions">
              {data.turns.map((x, i) => (
                <button key={i} type="button" aria-pressed={i === turn} onClick={() => pick(i)}>
                  {x.question}
                </button>
              ))}
            </div>
            <div className="hc-answer" aria-live="polite">
              <p className="hc-who">Vubicle</p>
              <Rich text={t.answer} onCite={setCite} max={t.cites.length} />
              <div className="sources" aria-label="Sources">
                {used.map((n) => {
                  const c = data.chunks.get(t.cites[n - 1]);
                  return (
                    <button key={n} type="button" className="source" aria-pressed={n === cite} onClick={() => setCite(n)}>
                      <b>{n}</b>
                      <span>{c ? `${data.fileNames.get(c.fileId)}, ${c.label}` : 'Source'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <aside className="hc-page" aria-label="Cited page" ref={pageRef}>
            {cited && (
              <>
                <p className="hc-file">
                  {data.fileNames.get(cited.fileId)} <span>{cited.label}</span>
                </p>
                {page.map((c) => (
                  <p key={c.id} className={c.id === cited.id ? 'hc-passage hit' : 'hc-passage'}>
                    {c.text}
                  </p>
                ))}
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

export function mountHeroChat(el: HTMLElement) {
  el.replaceChildren();
  createRoot(el).render(
    <StrictMode>
      <HeroChat />
    </StrictMode>,
  );
}
