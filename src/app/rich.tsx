// Safe rendering of model text. It is never inserted as HTML: a small parser turns a subset of Markdown
// (paragraphs, lists, fenced code, `code`, **bold**, *italics*) and citations like [3] into React
// elements, so any markup in the text, including <script>, shows up as plain characters.
import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export type Block =
  | { type: 'code'; lang: string; code: string }
  | { type: 'p'; lines: string[] }
  | { type: 'ul' | 'ol'; items: string[]; start?: number };

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*(\d+)[.)]\s+/;

/** Splits text into fenced code blocks, paragraphs and lists. An unclosed fence runs to the end. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(...splitLists(para));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(FENCE);
    if (open) {
      flush();
      const [, indent, fence, lang] = open;
      const body: string[] = [];
      for (i++; i < lines.length; i++) {
        const close = lines[i].match(/^\s*(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
        // A fence indented inside a list item indents its body too; drop that much.
        body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i].trimStart());
      }
      blocks.push({ type: 'code', lang: lang.toLowerCase(), code: body.join('\n').replace(/\n+$/, '') });
      continue;
    }
    if (!lines[i].trim()) flush();
    else para.push(lines[i]);
  }
  flush();
  return blocks;
}

/** A paragraph run can mix plain lines and list items ("Key points:\n- a\n- b"). Wrapped item lines join their item. */
function splitLists(lines: string[]): Block[] {
  const out: Block[] = [];
  for (const line of lines) {
    const kind = BULLET.test(line) ? 'ul' : NUMBER.test(line) ? 'ol' : null;
    const last = out[out.length - 1];
    if (kind) {
      const item = line.replace(kind === 'ul' ? BULLET : NUMBER, '');
      if (last?.type === kind) last.items.push(item);
      else out.push({ type: kind, items: [item], ...(kind === 'ol' ? { start: Number(line.match(NUMBER)![1]) } : {}) });
    } else if ((last?.type === 'ul' || last?.type === 'ol') && /^\s+/.test(line)) {
      last.items[last.items.length - 1] += ' ' + line.trim();
    } else if (last?.type === 'p') last.lines.push(line);
    else out.push({ type: 'p', lines: [line] });
  }
  return out;
}

export interface InlineOptions {
  /** Called with the citation number when a chip is pressed. Without it, [3] stays as plain text. */
  onCite?: (n: number) => void;
  /** Highest citation number that points somewhere; others are dropped as invented. */
  max?: number;
}

// Order matters only for matches starting at the same place: code first, so nothing inside it is parsed.
const INLINE: { kind: 'code' | 'bold' | 'italic' | 'cite'; re: RegExp }[] = [
  { kind: 'code', re: /(?<!`)(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g },
  { kind: 'bold', re: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|(?<![\w])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w])/g },
  { kind: 'italic', re: /\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*|(?<![\w])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w])/g },
  { kind: 'cite', re: /\[(\d+(?:\s*,\s*\d+)*)\]/g },
];

/** Turns one line of model text into inline elements: code, bold, italics and citation chips. */
export function inlineNodes(text: string, opts: InlineOptions = {}, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let pos = 0;
  let k = 0;
  while (pos < text.length) {
    let best: { kind: (typeof INLINE)[number]['kind']; m: RegExpExecArray } | null = null;
    for (const { kind, re } of INLINE) {
      re.lastIndex = pos;
      const m = re.exec(text);
      if (m && (!best || m.index < best.m.index)) best = { kind, m };
    }
    if (!best) break;
    const { kind, m } = best;
    if (m.index > pos) out.push(text.slice(pos, m.index));
    const key = `${keyPrefix}-${k++}`;
    if (kind === 'code') {
      // As in Markdown, one space just inside the backticks is padding, so `` `x` `` can show a backtick.
      const body = m[2].length > 2 && m[2].startsWith(' ') && m[2].endsWith(' ') ? m[2].slice(1, -1) : m[2];
      out.push(<code key={key} className="code-inline">{body}</code>);
    } else if (kind === 'bold') {
      out.push(<strong key={key}>{inlineNodes(m[1] ?? m[2], opts, key)}</strong>);
    } else if (kind === 'italic') {
      out.push(<em key={key}>{inlineNodes(m[1] ?? m[2], opts, key)}</em>);
    } else if (!opts.onCite) {
      out.push(m[0]);
    } else {
      for (const n of m[1].split(',').map((s) => Number(s.trim()))) {
        if (n >= 1 && n <= (opts.max ?? Infinity))
          out.push(
            <button key={`${key}-${n}`} type="button" className="cite" onClick={() => opts.onCite!(n)} aria-label={`Open source ${n}`}>
              {n}
            </button>,
          );
      }
    }
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

/** Citation numbers used in the text, in order of first use. Brackets inside code (`arr[1]`) don't count. */
export function citedNumbers(text: string): number[] {
  const prose = parseBlocks(text)
    .flatMap((b) => (b.type === 'code' ? [] : b.type === 'p' ? b.lines : b.items))
    .join('\n')
    .replace(/(?<!`)(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, ' ');
  const nums = [...prose.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap((x) => x[1].split(',').map((n) => Number(n.trim())));
  return [...new Set(nums)].filter((n) => n >= 1);
}

function lineNodes(lines: string[], opts: InlineOptions, key: string): ReactNode[] {
  return lines.flatMap((l, j) => [...(j ? [<br key={`${key}-br${j}`} />] : []), ...inlineNodes(l, opts, `${key}-${j}`)]);
}

function CopyButton({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="code-copy"
      aria-label={done ? 'Copied' : 'Copy code'}
      onClick={() =>
        navigator.clipboard?.writeText(code).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

/**
 * Model text as elements. Block mode (the default) is for chat and tutor messages. `inline` produces only
 * phrasing content, for text inside buttons, labels and legends (flashcards, quiz options), where block
 * elements are not allowed; there, code blocks become block-styled <code>.
 */
export function Rich({ text, onCite, max, inline = false, className }: { text: string; inline?: boolean; className?: string } & InlineOptions) {
  const opts = { onCite, max };
  const blocks = parseBlocks(text);
  if (inline) {
    return (
      <span className={`rich-inline${className ? ' ' + className : ''}`}>
        {blocks.map((b, i) => {
          const key = `b${i}`;
          if (b.type === 'code')
            return (
              <code key={key} className="code-block" data-lang={b.lang || undefined}>
                {b.code}
              </code>
            );
          const lines = b.type === 'p' ? b.lines : b.items.map((it, j) => `${b.type === 'ol' ? `${(b.start ?? 1) + j}.` : '•'} ${it}`);
          return (
            <span key={key} className="rich-line">
              {lineNodes(lines, opts, key)}
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <div className={`rich${className ? ' ' + className : ''}`}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.type === 'code')
          return (
            <div key={key} className="code-wrap">
              {b.lang && <span className="code-lang">{b.lang}</span>}
              <CopyButton code={b.code} />
              <pre className="code-block" tabIndex={0} aria-label={b.lang ? `${b.lang} code` : 'Code'}>
                <code>{b.code}</code>
              </pre>
            </div>
          );
        if (b.type === 'p') return <p key={key}>{lineNodes(b.lines, opts, key)}</p>;
        const items = b.items.map((it, j) => <li key={j}>{inlineNodes(it, opts, `${key}-${j}`)}</li>);
        return b.type === 'ul' ? (
          <ul key={key}>{items}</ul>
        ) : (
          <ol key={key} start={b.start && b.start !== 1 ? b.start : undefined}>
            {items}
          </ol>
        );
      })}
    </div>
  );
}
