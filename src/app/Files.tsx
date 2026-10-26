import { useRef, useState } from 'react';
import { FileText, Presentation, FileType2, NotebookPen, Upload, Trash2, AlertCircle, Loader2, X } from 'lucide-react';
import { deleteFile, type Cubicle, type StoredFile } from './db';
import { addFile, addNote } from './ingest';
import { Dialog } from './ui';

const ICONS = { pdf: FileText, pptx: Presentation, docx: FileType2, note: NotebookPen };
const UNIT = { pdf: 'pages', pptx: 'slides', docx: 'sections', note: 'sections' };

function meta(f: StoredFile) {
  if (f.status === 'reading') return `Reading${f.progress ? ` ${Math.round(f.progress * 100)}%` : ''}`;
  if (f.status === 'error') return 'Could not read';
  const n = `${f.sections ?? 0} ${f.sections === 1 ? UNIT[f.kind].slice(0, -1) : UNIT[f.kind]}`;
  const search = f.vectors === 'done' ? 'smart search ready' : f.vectors === 'off' ? 'keyword search' : 'search ready';
  return `${n} · ${search}`;
}

export function Files({ cubicle, files, onDone }: { cubicle: Cubicle; files: StoredFile[]; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [noting, setNoting] = useState(false);
  const [confirm, setConfirm] = useState<StoredFile | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) void addFile(cubicle.id, f);
  };
  const sorted = [...files].sort((a, b) => b.addedAt - a.addedAt);

  return (
    <div
      style={{ display: 'contents' }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
    >
      <div className="side-head">
        <h2>Files</h2>
        <button className="btn ghost sm tool-only-phone" onClick={onDone}>
          <X aria-hidden="true" /> Done
        </button>
      </div>
      <div className={`drop${over ? ' over' : ''}`}>
        <button className="btn primary" onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" /> Add files
        </button>
        <button className="btn sm" onClick={() => setNoting(true)}>
          <NotebookPen aria-hidden="true" /> Write or paste notes
        </button>
        <p>Or drop files here. PDF, PowerPoint (.pptx), Word (.docx) or text.</p>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept=".pdf,.pptx,.docx,.ppt,.doc,.txt,.md,application/pdf"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <ul className="files" aria-label="Files in this cubicle">
        {sorted.map((f) => {
          const Icon = f.status === 'error' ? AlertCircle : f.status === 'reading' ? Loader2 : ICONS[f.kind];
          return (
            <li key={f.id} className="file">
              <Icon aria-hidden="true" className={f.status === 'reading' ? 'spin' : undefined} />
              <span className="file-name">{f.name}</span>
              <button className="btn ghost icon sm" aria-label={`Remove ${f.name}`} onClick={() => setConfirm(f)}>
                <Trash2 aria-hidden="true" />
              </button>
              <span className="file-meta" aria-live="polite">
                {meta(f)}
              </span>
              {f.status === 'reading' && (
                <span className="bar" role="progressbar" aria-label={`Reading ${f.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((f.progress ?? 0) * 100)}>
                  <i style={{ width: `${Math.max(4, (f.progress ?? 0) * 100)}%` }} />
                </span>
              )}
              {f.error && (
                <span className="file-error" role="alert">
                  {f.error}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <NoteDialog open={noting} onClose={() => setNoting(false)} onSave={(t, x) => addNote(cubicle.id, t, x)} />
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} label="Remove file">
        <div className="dialog">
          <h2>Remove {confirm?.name}?</h2>
          <p>Its passages leave this cubicle. Flashcards, quizzes and chats made from it stay, but their links to it stop working.</p>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>
              Keep it
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                if (confirm) await deleteFile(confirm);
                setConfirm(null);
              }}
            >
              Remove
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function NoteDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (title: string, text: string) => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <Dialog open={open} onClose={onClose} label="Write or paste notes">
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onSave(title.trim() || 'Notes', text);
          setTitle('');
          setText('');
          onClose();
        }}
      >
        <h2>Notes</h2>
        <label className="field">
          <span>Title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Week 3 lecture notes" maxLength={80} />
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea className="input" rows={10} value={text} onChange={(e) => setText(e.target.value)} required aria-describedby="note-hint" />
        </label>
        <p className="hint" id="note-hint">
          Lines starting with # become headings, and each heading is cited as its own section.
        </p>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Add notes</button>
        </div>
      </form>
    </Dialog>
  );
}
