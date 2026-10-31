import { useState } from 'react';
import { Sparkles, RotateCcw, BookOpen, Trash2, ArrowLeft, Check } from 'lucide-react';
import { byCubicle, chunksFor, getChunks, put, remove, uid, useLive, type Attempt, type Quiz } from './db';
import { ai, AiError } from './api';
import { findPassages, fileNames, spread, toPassages } from './retrieve';
import { Working } from './ui';
import { Rich } from './rich';
import { useDesk } from './App';

const WRITING = 'Writing your quiz';
const GRADING = 'Grading your answers';

type Raw = { type: 'mcq' | 'short'; question: string; options?: string[]; answer: number | string; explanation: string; source: number | null };

export function QuizTool() {
  const { cubicle, fileId } = useDesk();
  const quizzes = useLive(async () => (await byCubicle('quizzes', cubicle.id)).sort((a, b) => b.createdAt - a.createdAt), ['quizzes'], [cubicle.id]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(8);

  const make = async () => {
    setBusy(true);
    setError('');
    try {
      const scope = { cubicleId: cubicle.id, fileId };
      const chunks = topic.trim() ? await findPassages(scope, topic, 10) : spread(await chunksFor(cubicle.id, fileId), 10);
      if (!chunks.length) throw new AiError(`Nothing in your material matches “${topic}”.`);
      const names = await fileNames(cubicle.id);
      const out = await ai<{ questions: Raw[] }>('quiz', { passages: toPassages(chunks, names), count }, { label: WRITING });
      const fileName = fileId ? names.get(fileId) : undefined;
      const q: Quiz = {
        id: uid(),
        cubicleId: cubicle.id,
        title: topic.trim() || fileName?.replace(/\.[a-z]+$/i, '') || 'Mixed practice',
        fileId,
        questions: out.questions.map((x) => ({ ...x, chunkId: x.source ? chunks[x.source - 1]?.id : undefined })),
        attempts: [],
        createdAt: Date.now(),
      };
      await put('quizzes', q);
      setTopic('');
      setOpen(q.id);
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'That quiz could not be written. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const quiz = quizzes?.find((q) => q.id === open);
  if (quiz) return <TakeQuiz quiz={quiz} onBack={() => setOpen(null)} />;

  return (
    <div className="pane">
      <div className="head">
        <h1>Practice quizzes</h1>
      </div>
      <form
        className="notice"
        style={{ display: 'grid', gap: 12, marginBottom: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <strong>New quiz</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className="sr-only" htmlFor="quiz-topic">
            Topic
          </label>
          <input id="quiz-topic" className="input" style={{ flex: '1 1 220px' }} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)" maxLength={200} />
          <label className="sr-only" htmlFor="quiz-count">
            Questions
          </label>
          <select id="quiz-count" className="input" style={{ width: 'auto' }} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 8, 12, 15].map((n) => (
              <option key={n} value={n}>
                {n} questions
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={busy}>
            <Sparkles aria-hidden="true" /> Write a quiz
          </button>
        </div>
        <span className="hint">Multiple choice and short answer. Short answers are graded with partial credit.</span>
      </form>
      {busy && <Working label={WRITING} />}
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
      {!!quizzes?.length && (
        <>
          <h2 style={{ margin: '28px 0 12px' }}>Saved quizzes</h2>
          <ul className="list">
            {quizzes.map((q) => {
              const best = q.attempts.length ? Math.max(...q.attempts.map(total)) : null;
              return (
                <li key={q.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                  <span>
                    <button className="btn ghost" style={{ padding: 0, minHeight: 0, fontSize: 15 }} onClick={() => setOpen(q.id)}>
                      {q.title}
                    </button>
                    <span className="muted small" style={{ display: 'block' }}>
                      {q.questions.length} questions · {q.attempts.length ? `best ${Math.round(best! * 100)}%, ${q.attempts.length} attempt${q.attempts.length === 1 ? '' : 's'}` : 'not taken yet'}
                    </span>
                  </span>
                  <span className="row-actions">
                    <button className="btn sm" onClick={() => setOpen(q.id)}>
                      {q.attempts.length ? 'Retake' : 'Start'}
                    </button>
                    <button className="btn ghost icon sm" aria-label={`Delete quiz ${q.title}`} onClick={() => remove('quizzes', q.id)}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

const total = (a: Attempt) => a.scores.reduce<number>((s, x) => s + (x ?? 0), 0) / Math.max(1, a.scores.length);

function TakeQuiz({ quiz, onBack }: { quiz: Quiz; onBack: () => void }) {
  const { cubicle, openSource, go } = useDesk();
  const [answers, setAnswers] = useState<(number | string | null)[]>(() => quiz.questions.map(() => null));
  const [result, setResult] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const names = await fileNames(cubicle.id);
      const scores: (number | null)[] = [];
      const feedback: (string | null)[] = [];
      for (const [i, q] of quiz.questions.entries()) {
        const a = answers[i];
        if (q.type === 'mcq') {
          scores.push(a === q.answer ? 1 : 0);
          feedback.push(null);
        } else if (typeof a !== 'string' || !a.trim()) {
          scores.push(0);
          feedback.push('No answer given.');
        } else {
          const [chunk] = q.chunkId ? await getChunks([q.chunkId]) : [undefined];
          const passages = chunk ? toPassages([chunk], names) : [{ label: 'Model answer', text: String(q.answer) }];
          // Cached, so retaking with the same answer costs nothing.
          const g = await ai<{ score: number; feedback: string }>('grade', { question: q.question, reference: String(q.answer), answer: a.trim(), passages }, { label: GRADING, cache: true });
          scores.push(g.score);
          feedback.push(g.feedback);
        }
      }
      const attempt = { at: Date.now(), answers, scores, feedback };
      await put('quizzes', { ...quiz, attempts: [...quiz.attempts, attempt] });
      setResult(attempt);
      window.scrollTo?.({ top: 0 });
    } catch (e) {
      setError(e instanceof AiError ? e.message : 'Grading failed. Your answers are still here; try again.');
    } finally {
      setBusy(false);
    }
  };

  const retake = () => {
    setAnswers(quiz.questions.map(() => null));
    setResult(null);
  };

  const done = !!result;
  return (
    <div className="pane">
      <div className="head">
        <button className="btn ghost sm" onClick={onBack}>
          <ArrowLeft aria-hidden="true" /> All quizzes
        </button>
      </div>
      <h1 style={{ marginBottom: 6 }}>{quiz.title}</h1>
      <p className="muted" style={{ marginBottom: 12 }}>
        {quiz.questions.length} questions{quiz.attempts.length ? ` · attempt ${quiz.attempts.length + (done ? 0 : 1)}` : ''}
      </p>
      {result && (
        <div className="notice" style={{ alignItems: 'center', marginBottom: 12 }} role="status">
          <span className="score num">{Math.round(total(result) * 100)}%</span>
          <span>
            {total(result) >= 0.8 ? 'Strong work.' : total(result) >= 0.5 ? 'Getting there. Read the explanations below.' : 'Worth another pass. Each explanation links to its source.'}
          </span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={retake}>
            <RotateCcw aria-hidden="true" /> Retake
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {quiz.questions.map((q, i) => {
          const a = answers[i];
          const s = result?.scores[i];
          return (
            <fieldset key={i} className="question" disabled={done || busy}>
              <legend>
                {i + 1}. <Rich inline text={q.question} />
              </legend>
              {q.type === 'mcq' ? (
                q.options!.map((o, j) => (
                  <label key={j} className={`option${done && j === q.answer ? ' right' : ''}${done && a === j && j !== q.answer ? ' wrong' : ''}`}>
                    <input type="radio" name={`q${i}`} checked={a === j} onChange={() => setAnswers(answers.map((x, k) => (k === i ? j : x)))} />
                    <Rich inline text={o} />
                  </label>
                ))
              ) : (
                <label className="field">
                  <span className="sr-only">Your answer</span>
                  <textarea className="input" style={{ minHeight: 80 }} value={(a as string) ?? ''} maxLength={1500} onChange={(e) => setAnswers(answers.map((x, k) => (k === i ? e.target.value : x)))} placeholder="Your answer" />
                </label>
              )}
              {done && (
                <div className="feedback">
                  <span className={`verdict ${s === 1 ? 'correct' : s ? 'partial' : 'incorrect'}`}>
                    {s === 1 ? 'Correct' : s ? `Partly right, ${Math.round(s * 100)}%` : 'Not quite'}
                  </span>
                  {/* Grading sends one passage, the question's source, so [1] opens it. */}
                  {result!.feedback[i] && <Rich inline text={result!.feedback[i]!} onCite={q.chunkId ? () => openSource(q.chunkId!) : undefined} max={1} />}
                  {q.type === 'short' && (
                    <span>
                      <strong>Model answer:</strong> <Rich inline text={String(q.answer)} />
                    </span>
                  )}
                  <Rich inline text={q.explanation} />
                  <span className="row-actions">
                    {q.chunkId && (
                      <button type="button" className="btn ghost sm" onClick={() => openSource(q.chunkId!)}>
                        <BookOpen aria-hidden="true" /> Source
                      </button>
                    )}
                    {s !== 1 && (
                      <button type="button" className="btn ghost sm" onClick={() => go('chat', `Explain this: ${q.question}`)}>
                        Ask about it
                      </button>
                    )}
                  </span>
                </div>
              )}
            </fieldset>
          );
        })}
        {busy && <Working label={GRADING} />}
        {error && (
          <p className="notice bad" role="alert">
            {error}
          </p>
        )}
        {!done && (
          <div style={{ marginTop: 16 }}>
            <button className="btn primary" disabled={busy || answers.every((a) => a === null || a === '')}>
              <Check aria-hidden="true" /> Check my answers
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
