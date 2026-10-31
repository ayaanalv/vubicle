import { useEffect, useRef, useState } from 'react';
import { Send, Plus, Lightbulb, Eye, Sparkles, GraduationCap } from 'lucide-react';
import { byCubicle, chunksFor, getChunks, put, uid, useLive, type Chat, type Message } from './db';
import { ai, AiError } from './api';
import { findPassages, broadPassages, isBroadQuestion, fileNames, spread, toPassages } from './retrieve';
import { Rich, Working } from './ui';
import { useDesk } from './App';

const ANSWERING = 'Answering your question';
const TUTORING = 'The tutor is thinking';

export function ChatTool({ mode }: { mode: 'chat' | 'tutor' }) {
  const { cubicle, fileId, seed } = useDesk();
  const chats = useLive(async () => (await byCubicle('chats', cubicle.id)).filter((c) => c.mode === mode).sort((a, b) => b.updatedAt - a.updatedAt), ['chats'], [cubicle.id, mode]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [topic, setTopic] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const chat = currentId === 'new' ? undefined : chats?.find((c) => c.id === currentId) ?? chats?.[0];
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [chat?.messages.length, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const save = async (c: Chat, m: Message) => {
    const next = { ...c, messages: [...c.messages, m], updatedAt: Date.now() };
    await put('chats', next);
    setCurrentId(next.id);
    return next;
  };

  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    setBusy(true);
    setError('');
    abort.current = new AbortController();
    try {
      await fn(abort.current.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof AiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const ask = (question: string) =>
    run(async (signal) => {
      const q = question.trim();
      if (!q) return;
      setDraft('');
      let c: Chat = chat ?? { id: uid(), cubicleId: cubicle.id, mode: 'chat', title: q.slice(0, 60), fileId, messages: [], updatedAt: Date.now() };
      c = await save(c, { role: 'student', text: q, at: Date.now() });
      const scope = { cubicleId: cubicle.id, fileId };
      // Judgment and overview questions ("hardest idea", "what to focus on") need a view of the whole
      // material, so keyword hits are topped up with passages spread across it.
      let found = isBroadQuestion(q) ? await broadPassages(scope, q, 10) : await findPassages(scope, q, 8);
      // A follow-up like "why?" or "give an example of that" leans on the previous question.
      const prev = c.messages.filter((m) => m.role === 'student').slice(-2, -1)[0]?.text;
      const followUp = q.split(/\s+/).length < 8 && /\b(it|this|that|these|those|they|them|why|how so|more|example)\b/i.test(q);
      if (!found.length && prev && followUp) found = await findPassages(scope, `${q} ${prev}`, 8);
      if (!found.length) {
        await save(c, {
          role: 'assistant',
          covered: false,
          text: 'I could not find anything about that in your material. Try other words, or check that the file with this topic has been added.',
          at: Date.now(),
        });
        return;
      }
      const names = await fileNames(cubicle.id);
      const history = c.messages.slice(-7, -1).map((m) => ({ role: m.role === 'student' ? 'student' : 'tutor', text: m.text.slice(0, 2000) }));
      const out = await ai<{ covered: boolean; answer: string }>('chat', { question: q, passages: toPassages(found, names), history }, { label: ANSWERING, cache: history.length === 0, signal });
      await save(c, { role: 'assistant', text: out.answer, covered: out.covered, cites: found.map((x) => x.id), at: Date.now() });
    });

  const tutor = (request: 'continue' | 'hint' | 'reveal', answer?: string, start?: Chat) =>
    run(async (signal) => {
      let c = start ?? chat!;
      if (answer?.trim()) {
        setDraft('');
        c = await save(c, { role: 'student', text: answer.trim(), at: Date.now() });
      }
      const chunks = (await getChunks(c.chunkIds ?? [])).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof getChunks>>[number]>[];
      if (!chunks.length) throw new AiError('The passages for this session were removed. Start a new session.');
      const names = await fileNames(cubicle.id);
      const history = c.messages.slice(-12).map((m) => ({ role: m.role === 'student' ? 'student' : 'tutor', text: m.text.slice(0, 2000) }));
      const out = await ai<{ message: string; verdict: string }>('tutor', { passages: toPassages(chunks, names), history, request }, { label: TUTORING, signal });
      await save(c, { role: 'tutor', text: out.message, verdict: out.verdict, cites: chunks.map((x) => x.id), at: Date.now() });
    });

  const startTutor = (t: string) =>
    run(async () => {
      const scope = { cubicleId: cubicle.id, fileId };
      const chunks = t.trim() ? await findPassages(scope, t, 8) : spread(await chunksFor(cubicle.id, fileId), 8);
      if (!chunks.length) throw new AiError(`Nothing in your material matches “${t}”. Try another topic or leave it blank.`);
      const c: Chat = { id: uid(), cubicleId: cubicle.id, mode: 'tutor', title: t.trim() || 'Mixed topics', fileId, chunkIds: chunks.map((x) => x.id), messages: [], updatedAt: Date.now() };
      await put('chats', c);
      setCurrentId(c.id);
      setBusy(false);
      await tutor('continue', undefined, c);
    });

  // A topic handed over from another tool (the concept map, a quiz).
  const seen = useRef(0);
  useEffect(() => {
    if (!seed || seed.tool !== mode || seed.n === seen.current || chats === undefined) return;
    seen.current = seed.n;
    setCurrentId('new');
    if (mode === 'chat') void ask(seed.text);
    else {
      setTopic(seed.text);
      void startTutor(seed.text);
    }
  }, [seed, chats === undefined]);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !draft.trim()) return;
    if (mode === 'chat') void ask(draft);
    else void tutor('continue', draft);
  };

  const showStart = mode === 'tutor' && !chat;
  return (
    <div className="chat">
      {!!chats?.length && (
        <div className="history">
          <label className="sr-only" htmlFor={`${mode}-history`}>
            {mode === 'chat' ? 'Earlier chats' : 'Earlier sessions'}
          </label>
          <select id={`${mode}-history`} className="input" value={chat?.id ?? 'new'} onChange={(e) => setCurrentId(e.target.value)}>
            {currentId === 'new' && <option value="new">New {mode === 'chat' ? 'chat' : 'session'}</option>}
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {new Date(c.updatedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => setCurrentId('new')} disabled={busy}>
            <Plus aria-hidden="true" /> New
          </button>
        </div>
      )}
      <div className="thread">
        <div className="msgs" aria-live="polite">
          {showStart ? (
            <TutorStart topic={topic} setTopic={setTopic} onStart={() => startTutor(topic)} busy={busy} />
          ) : !chat?.messages.length && !busy ? (
            <ChatStart onAsk={ask} />
          ) : (
            chat?.messages.map((m, i) => <Bubble key={i} m={m} />)
          )}
          {busy && <Working label={mode === 'chat' ? ANSWERING : TUTORING} />}
          {error && (
            <p className="notice bad" role="alert">
              {error}
            </p>
          )}
          <div ref={end} />
        </div>
      </div>
      {!showStart && (
        <div className="composer">
          {mode === 'tutor' && chat && (
            <div className="row">
              <button className="btn sm" disabled={busy} onClick={() => tutor('hint')}>
                <Lightbulb aria-hidden="true" /> Hint
              </button>
              <button className="btn sm" disabled={busy} onClick={() => tutor('reveal')}>
                <Eye aria-hidden="true" /> Show the answer
              </button>
            </div>
          )}
          <form onSubmit={send}>
            <label className="sr-only" htmlFor={`${mode}-input`}>
              {mode === 'chat' ? 'Ask about your material' : 'Your answer'}
            </label>
            <textarea
              id={`${mode}-input`}
              className="input"
              rows={1}
              value={draft}
              maxLength={1000}
              placeholder={mode === 'chat' ? 'Ask about your material' : 'Type your answer'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) send(e);
              }}
            />
            <button className="btn primary icon" aria-label={mode === 'chat' ? 'Ask' : 'Send answer'} disabled={busy || !draft.trim()}>
              <Send aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const { openSource } = useDesk();
  if (m.role === 'student') return <div className="msg student">{m.text}</div>;
  const cites = m.cites ?? [];
  const used = [...new Set([...m.text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((x) => x[1].split(',').map((n) => Number(n.trim()))))].filter((n) => n >= 1 && n <= cites.length);
  const open = (n: number) => openSource(cites[n - 1], cites);
  return (
    <div className="msg ai">
      <span className="who">
        {m.role === 'tutor' ? <GraduationCap size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
        {m.role === 'tutor' ? 'Tutor' : 'Vubicle'}
      </span>
      {m.verdict && m.verdict !== 'none' && <span className={`verdict ${m.verdict}`}>{m.verdict === 'correct' ? 'Correct' : m.verdict === 'partial' ? 'Partly right' : 'Not quite'}</span>}
      {m.covered === false && <span className="verdict partial">Not in your material</span>}
      <Rich text={m.text} onCite={open} max={cites.length} />
      {used.length > 0 && m.role === 'assistant' && <SourceChips ids={cites} nums={used} />}
    </div>
  );
}

function SourceChips({ ids, nums }: { ids: string[]; nums: number[] }) {
  const { openSource } = useDesk();
  const chunks = useLive(() => getChunks(nums.map((n) => ids[n - 1])), ['chunks'], [ids.join(), nums.join()]);
  const names = useLive(async () => {
    const c = chunks?.find(Boolean);
    return c ? fileNames(c.cubicleId) : new Map<string, string>();
  }, ['files'], [chunks]);
  return (
    <div className="sources" aria-label="Sources">
      {nums.map((n, i) => {
        const c = chunks?.[i];
        return (
          <button key={n} className="source" onClick={() => openSource(ids[n - 1], ids)} disabled={!c}>
            <b>{n}</b>
            <span>{c ? `${names?.get(c.fileId) ?? ''}, ${c.label}` : 'Removed'}</span>
          </button>
        );
      })}
    </div>
  );
}

function ChatStart({ onAsk }: { onAsk: (q: string) => void }) {
  const { cubicle, fileId } = useDesk();
  const files = useLive(() => byCubicle('files', cubicle.id), ['files'], [cubicle.id]);
  const f = files?.find((x) => x.id === fileId) ?? files?.find((x) => x.status === 'ready');
  const name = f?.name.replace(/\.[a-z]+$/i, '');
  const ideas = [name ? `Summarize the main ideas in ${name}` : 'Summarize the main ideas', 'What terms should I know for the exam?', 'Explain the hardest idea here simply'];
  return (
    <div className="empty" style={{ margin: '4vh 0 0', padding: 0 }}>
      <h1>Ask your course</h1>
      <p>Answers come only from your files, with a numbered link to each page or slide they use.</p>
      <div className="chips">
        {ideas.map((q) => (
          <button key={q} className="chip" onClick={() => onAsk(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function TutorStart({ topic, setTopic, onStart, busy }: { topic: string; setTopic: (t: string) => void; onStart: () => void; busy: boolean }) {
  return (
    <form
      className="empty"
      style={{ margin: '4vh 0 0', padding: 0 }}
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <h1>Study with a tutor</h1>
      <p>The tutor asks one question at a time, checks your answer against your notes, and gives hints before answers.</p>
      <label className="field" style={{ width: '100%' }}>
        <span>Topic (optional)</span>
        <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Leave blank for a mix of everything" maxLength={200} />
      </label>
      <button className="btn primary" disabled={busy}>
        <GraduationCap aria-hidden="true" /> Start a session
      </button>
    </form>
  );
}
