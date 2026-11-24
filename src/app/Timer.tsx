import { useEffect, useState, useSyncExternalStore } from 'react';
import { Timer as TimerIcon, Play, Pause, RotateCcw } from 'lucide-react';
import { useNow } from './ui';

type Mode = 'focus' | 'short' | 'long';
const LENGTH: Record<Mode, number> = { focus: 25, short: 5, long: 15 };
const NAME: Record<Mode, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const KEY = 'vubicle.timer';

interface State {
  mode: Mode;
  /** When the running period ends, or null when paused. */
  endsAt: number | null;
  /** Seconds left while paused. */
  left: number;
  rounds: number;
}

function load(): State {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '');
    if (s && s.mode in LENGTH) return s;
  } catch {
    /* first run or private mode */
  }
  return { mode: 'focus', endsAt: null, left: LENGTH.focus * 60, rounds: 0 };
}

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.7);
    });
  } catch {
    /* no audio */
  }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

// One timer for the whole page: the controls live in the tools drawer, and a countdown shows in the top
// bar while it runs. Both read this store, so they always agree.
let state: State = load();
const listeners = new Set<() => void>();
function setState(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

function useTimer() {
  const s = useSyncExternalStore(subscribe, () => state);
  const now = useNow(s.endsAt !== null, 500);
  const left = s.endsAt ? Math.max(0, Math.ceil((s.endsAt - now) / 1000)) : s.left;
  return { s, left, running: s.endsAt !== null };
}

/**
 * The countdown in the top bar, shown only while the timer runs; it opens the tools drawer. Always mounted,
 * so it also ends each period (chime, next period) and keeps the tab title current.
 */
export function TimerChip({ onOpen }: { onOpen: () => void }) {
  const { s, left, running } = useTimer();
  const [announce, setAnnounce] = useState('');

  // Period finished: chime, then move to the next period, paused.
  useEffect(() => {
    if (s.endsAt && left === 0) {
      chime();
      const rounds = s.mode === 'focus' ? s.rounds + 1 : s.rounds;
      const next: Mode = s.mode === 'focus' ? (rounds % 4 === 0 ? 'long' : 'short') : 'focus';
      setAnnounce(`${NAME[s.mode]} finished. Next: ${NAME[next].toLowerCase()}.`);
      setState({ mode: next, endsAt: null, left: LENGTH[next] * 60, rounds });
    }
  }, [left, s.endsAt]);

  useEffect(() => {
    const base = 'Vubicle workspace';
    document.title = s.endsAt ? `${fmt(left)} ${NAME[s.mode]} · ${base}` : base;
  }, [left, s.endsAt, s.mode]);

  return (
    <>
      <span className="sr-only" role="status">
        {announce}
      </span>
      {running && (
        <button className="btn sm timer-btn running" aria-label={`Focus timer, ${NAME[s.mode]}, ${fmt(left)} left. Open the timer`} onClick={onOpen}>
          <TimerIcon aria-hidden="true" />
          <span className="t-text num">{fmt(left)}</span>
        </button>
      )}
    </>
  );
}

/** A Pomodoro timer: 25 minutes of focus, 5 minute breaks, a long break every fourth round. */
export function TimerPanel() {
  const { s, left, running } = useTimer();
  const toggle = () => setState(running ? { ...s, endsAt: null, left } : { ...s, endsAt: Date.now() + left * 1000 });
  const setMode = (m: Mode) => setState({ ...s, mode: m, endsAt: null, left: LENGTH[m] * 60 });

  return (
    <div className="timer-panel">
      <div className="timer-modes" role="group" aria-label="Timer mode">
        {(Object.keys(LENGTH) as Mode[]).map((m) => (
          <button key={m} className="tab" aria-pressed={s.mode === m} style={s.mode === m ? { background: 'var(--surface-2)', color: 'var(--ink)' } : undefined} onClick={() => setMode(m)}>
            {NAME[m]}
          </button>
        ))}
      </div>
      <div className="timer-face" aria-hidden="true">
        {fmt(left)}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button className="btn primary" onClick={toggle}>
          {running ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {running ? 'Pause' : 'Start'}
        </button>
        <button className="btn" onClick={() => setMode(s.mode)} aria-label="Reset timer">
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
      <p className="muted small" style={{ textAlign: 'center' }}>
        {s.rounds} focus round{s.rounds === 1 ? '' : 's'} done · long break after every 4
      </p>
    </div>
  );
}
