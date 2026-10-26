import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { useLine } from './api';

/** A native <dialog>: focus is trapped and Escape closes it without extra code. */
export function Dialog({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-label={label} onClose={onClose} onCancel={onClose}>
      {open && children}
    </dialog>
  );
}

/** A button that opens a small menu; closes on outside click and Escape, and returns focus. */
export function Menu({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector<HTMLElement>('.menu button, .menu a, .menu input')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={wrap}>
      <button ref={btn} type="button" className="btn ghost icon" aria-label={label} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div className="menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ---- safe rendering of AI text: never HTML, only a few patterns turned into elements ----

function inline(text: string, onCite?: (n: number) => void, max = Infinity): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[(\d+(?:\s*,\s*\d+)*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>);
    else
      for (const n of m[2].split(',').map((s) => Number(s.trim()))) {
        if (n >= 1 && n <= max && onCite)
          out.push(
            <button key={k++} type="button" className="cite" onClick={() => onCite(n)} aria-label={`Open source ${n}`}>
              {n}
            </button>,
          );
      }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Rich({ text, onCite, max }: { text: string; onCite?: (n: number) => void; max?: number }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
  return (
    <div className="rich">
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''), onCite, max)}</li>
              ))}
            </ul>
          );
        if (lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
          return (
            <ol key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''), onCite, max)}</li>
              ))}
            </ol>
          );
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l, onCite, max)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// ---- the line: waiting, shown calmly ----

export function useNow(active: boolean, ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}

/** A small badge in the top bar while anything is waiting. It never blocks the page. */
export function LineBadge() {
  const line = useLine();
  const now = useNow(line.length > 0);
  if (!line.length) return null;
  const soonest = Math.max(0, Math.ceil((Math.min(...line.map((w) => w.until)) - now) / 1000));
  return (
    <div className="line" role="status" title={line.map((w) => w.label).join(', ')}>
      <Clock size={16} aria-hidden="true" />
      <span className="label">{line.length === 1 ? 'In line' : `${line.length} in line`}</span>
      <span className="num">{soonest}s</span>
    </div>
  );
}

/** Inline state for a request in progress: working, or waiting in line with a countdown. */
export function Working({ label }: { label: string }) {
  const line = useLine();
  const mine = line.find((w) => w.label === label);
  const now = useNow(Boolean(mine));
  if (!mine)
    return (
      <div className="wait" role="status">
        <span className="dots">{label}</span>
      </div>
    );
  const s = Math.max(0, Math.ceil((mine.until - now) / 1000));
  const why =
    mine.reason === 'cap'
      ? 'You have used this hour’s free requests. A spot opens soon.'
      : mine.reason === 'network'
        ? 'The connection dropped. Trying again.'
        : 'The free AI services are busy, so you are in line.';
  return (
    <div className="wait" role="status" aria-live="polite">
      <Clock size={18} aria-hidden="true" />
      <span>
        {why} Next try in <strong className="num">{s}s</strong>. You can keep studying while you wait.
      </span>
    </div>
  );
}
