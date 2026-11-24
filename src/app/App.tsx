import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { MessagesSquare, GraduationCap, Layers, FileText, ListChecks, Network, CalendarDays, FolderOpen, MoreHorizontal, Plus, Download, Upload, Trash2, Sun, Moon, Monitor, ShieldCheck, Pencil, Home, BookOpen, LayoutGrid, ChevronDown, X, Timer as TimerIcon } from 'lucide-react';
import { askToPersist, byCubicle, cubicles, db, put, uid, useLive, type Cubicle } from './db';
import { Dialog, LineBadge, Menu } from './ui';
import { Files } from './Files';
import { ChatTool } from './Chat';
import { Cards } from './Cards';
import { QuizTool } from './Quiz';
import { MapTool } from './MapView';
import { Deadlines } from './Deadlines';
import { Briefs } from './Briefs';
import { Viewer } from './Viewer';
import { TimerChip, TimerPanel } from './Timer';
import { PrivacyGate, PrivacyText } from './Privacy';
import { exportCubicle, importBackup, openSample, DeleteCubicle, LastBackup, BackupReminder } from './Backup';
import { SAMPLES } from './samples';
import { embedPending, storageErrorMessage } from './ingest';

export type Tool = 'chat' | 'tutor' | 'cards' | 'quiz' | 'map' | 'briefs' | 'deadlines';
/** The three main tools, always shown as tabs. `short` is the phone label, where space is tight. */
const MAIN: { id: Tool; name: string; short: string; icon: typeof Layers }[] = [
  { id: 'chat', name: 'Cited chat', short: 'Chat', icon: MessagesSquare },
  { id: 'cards', name: 'Flashcards', short: 'Cards', icon: Layers },
  { id: 'quiz', name: 'Quizzes', short: 'Quizzes', icon: ListChecks },
];
/** The other tools, in the "More tools" drawer with the focus timer. */
const MORE: { id: Tool; name: string; about: string; icon: typeof Layers }[] = [
  { id: 'tutor', name: 'Tutor', about: 'Answer questions one at a time, with hints and feedback.', icon: GraduationCap },
  { id: 'map', name: 'Concept map', about: 'See how the main topics connect.', icon: Network },
  { id: 'briefs', name: 'Briefs', about: 'Summaries, study guides and key terms, with page links.', icon: FileText },
  { id: 'deadlines', name: 'Deadlines', about: 'Find due dates and weights in a syllabus, then add them to a calendar.', icon: CalendarDays },
];

interface DeskApi {
  cubicle: Cubicle;
  fileId?: string;
  /** Opens the source viewer on one chunk, with the others from the same answer listed. */
  openSource: (chunkId: string, all?: string[]) => void;
  /** Switches tool, optionally handing it a starting question or topic. */
  go: (tool: Tool, seed?: string) => void;
  seed?: { tool: Tool; text: string; n: number };
}
const Desk = createContext<DeskApi>(null as never);
export const useDesk = () => useContext(Desk);

const SUBJECTS: Record<string, string> = { stem: 'STEM and physics', chemistry: 'Molecular chemistry', humanities: 'Literature and humanities' };

function readLocal(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLocal(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export function App() {
  const list = useLive(cubicles, ['cubicles'], []);
  const [current, setCurrent] = useState<string | null>(() => readLocal('vubicle.current'));
  const [creating, setCreating] = useState(false);
  // When the browser blocks storage the database never opens; say so instead of showing a blank page.
  const [storageProblem, setStorageProblem] = useState('');
  useEffect(() => {
    db().catch((e) => setStorageProblem(storageErrorMessage(e)));
  }, []);
  const subject = useMemo(() => new URLSearchParams(location.search).get('subject') || '', []);

  // Arriving from a subject portal opens the create dialog with that subject filled in.
  useEffect(() => {
    if (subject && SUBJECTS[subject]) setCreating(true);
  }, [subject]);

  // /app/?sample=physics opens that sample straight away (links from the landing page).
  useEffect(() => {
    const sample = SAMPLES.find((s) => s.id === new URLSearchParams(location.search).get('sample'));
    if (!sample) return;
    openSample(sample)
      .then((id) => {
        writeLocal('vubicle.current', id);
        location.replace(location.pathname);
      })
      .catch(() => history.replaceState(null, '', location.pathname));
  }, []);

  const cubicle = list?.find((c) => c.id === current) ?? list?.[0];
  useEffect(() => {
    if (cubicle) {
      writeLocal('vubicle.current', cubicle.id);
      void embedPending(cubicle.id);
    }
  }, [cubicle?.id]);

  const create = async (name: string) => {
    const c: Cubicle = { id: uid(), name: name.trim() || 'My course', subject: SUBJECTS[subject] ? subject : undefined, createdAt: Date.now() };
    try {
      await put('cubicles', c);
    } catch (e) {
      setCreating(false);
      setStorageProblem(storageErrorMessage(e));
      return;
    }
    setCurrent(c.id);
    setCreating(false);
    if (subject) history.replaceState(null, '', location.pathname);
  };

  if (storageProblem) return <StorageProblem message={storageProblem} />;
  if (!list) return null;
  return (
    <PrivacyGate>
      {cubicle ? (
        <Workspace key={cubicle.id} cubicle={cubicle} all={list} onSwitch={setCurrent} onNew={() => setCreating(true)} />
      ) : (
        <FirstRun onCreate={() => setCreating(true)} />
      )}
      <CreateDialog open={creating} initial={SUBJECTS[subject] || ''} onClose={() => setCreating(false)} onCreate={create} />
    </PrivacyGate>
  );
}

function StorageProblem({ message }: { message: string }) {
  return (
    <div className="shell">
      <header className="top">
        <a className="mark" href="/" aria-label="Vubicle home" translate="no">
          <img className="logo-light" src="/vubicle-logo.svg" alt="Vubicle" width={367} height={100} />
          <img className="logo-dark" src="/vubicle-logo-dark.svg" alt="Vubicle" width={367} height={100} />
          <img className="logo-icon" src="/favicon.svg" alt="Vubicle" width={28} height={28} />
        </a>
      </header>
      <main className="empty">
        <h1>Vubicle can’t save here</h1>
        <p className="notice bad" role="alert">
          {message}
        </p>
        <p>Vubicle keeps your files and study work in this browser, so it needs the browser’s site storage to work.</p>
      </main>
    </div>
  );
}

function FirstRun({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="shell">
      <header className="top">
        <a className="mark" href="/">
          <img className="logo-light" src="/vubicle-logo.svg" alt="Vubicle" width={367} height={100} />
          <img className="logo-dark" src="/vubicle-logo-dark.svg" alt="Vubicle" width={367} height={100} />
          <img className="logo-icon" src="/favicon.svg" alt="Vubicle" width={28} height={28} />
        </a>
      </header>
      <main className="empty">
        <picture>
          <source type="image/avif" srcSet="/art/hero-1280.avif" />
          <img className="art" src="/art/hero-1280.webp" alt="" width={1280} height={714} />
        </picture>
        <h1>Make your first cubicle</h1>
        <p>A cubicle holds one course. Add its slides, readings and notes, and every study tool works from them.</p>
        <ol className="steps">
          <li>Name it after the course, like “PHYS 1080”.</li>
          <li>Add a PDF, PowerPoint or Word file, or paste notes.</li>
          <li>Ask questions, make flashcards, or take a quiz.</li>
        </ol>
        <button className="btn primary" onClick={onCreate}>
          <Plus aria-hidden="true" /> Create a cubicle
        </button>
        <ImportButton />
        <SampleButtons />
      </main>
    </div>
  );
}

/** Opens a ready-made sample cubicle, so someone can try every tool without uploading anything. */
function SampleButtons() {
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  return (
    <section aria-labelledby="samples-title" style={{ display: 'grid', gap: 10, marginTop: 20 }}>
      <h2 id="samples-title">Try a sample</h2>
      <p>A short reading with flashcards, a quiz, a concept map and cited answers already made. Opening one sends nothing to an AI.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {SAMPLES.map((s) => (
          <button
            key={s.id}
            className="btn"
            disabled={Boolean(opening)}
            onClick={async () => {
              setOpening(s.id);
              setError('');
              try {
                writeLocal('vubicle.current', await openSample(s));
                location.reload();
              } catch (e) {
                setError((e as Error).message);
                setOpening('');
              }
            }}
          >
            {opening === s.id ? 'Opening…' : s.label}
          </button>
        ))}
      </div>
      <p className="hint">
        Samples are excerpts of Wikipedia articles (CC BY-SA 4.0) and Edgar Allan Poe’s “The Tell-Tale Heart” (public domain). Each one has an “About this sample” note with its source and license.
      </p>
      {error && (
        <p className="notice bad" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ImportButton({ inMenu, onDone }: { inMenu?: boolean; onDone?: () => void }) {
  const [msg, setMsg] = useState('');
  return (
    <>
      <label className={inMenu ? undefined : 'btn ghost'}>
        <Upload aria-hidden="true" size={inMenu ? 17 : 18} /> Import a backup
        <input
          type="file"
          accept=".vubicle,.zip"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void askToPersist();
            try {
              const c = await importBackup(f);
              writeLocal('vubicle.current', c.id);
              location.reload();
            } catch (err) {
              setMsg((err as Error).message);
            }
            onDone?.();
          }}
        />
      </label>
      {msg && (
        <p className="notice bad" role="alert">
          {msg}
        </p>
      )}
    </>
  );
}

function CreateDialog({ open, initial, onClose, onCreate }: { open: boolean; initial: string; onClose: () => void; onCreate: (n: string) => void }) {
  const [name, setName] = useState(initial);
  useEffect(() => {
    setName(initial);
  }, [initial, open]);
  return (
    <Dialog open={open} onClose={onClose} label="Create a cubicle">
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name);
        }}
      >
        <h2>New cubicle</h2>
        <label className="field">
          <span>Course name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="PHYS 1080: Physics for life sciences" maxLength={80} />
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Create</button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({ cubicle, open, onClose }: { cubicle: Cubicle; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(cubicle.name);
  return (
    <Dialog open={open} onClose={onClose} label="Rename cubicle">
      <form
        className="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim()) await put('cubicles', { ...cubicle, name: name.trim() });
          onClose();
        }}
      >
        <h2>Rename cubicle</h2>
        <label className="field">
          <span>Course name</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}

function setTheme(t: 'light' | 'dark' | 'system') {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  writeLocal('vubicle.theme', t);
}

function Workspace({ cubicle, all, onSwitch, onNew }: { cubicle: Cubicle; all: Cubicle[]; onSwitch: (id: string) => void; onNew: () => void }) {
  const [tool, setTool] = useState<Tool>(() => (readLocal('vubicle.tool') as Tool) || 'chat');
  const [fileId, setFileId] = useState<string>();
  const [view, setView] = useState<{ id: string; all: string[] } | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [seed, setSeed] = useState<DeskApi['seed']>();
  const [dialog, setDialog] = useState<'delete' | 'rename' | 'privacy' | null>(null);
  const [drawer, setDrawer] = useState(false);
  const secondary = MORE.find((t) => t.id === tool);
  const files = useLive(() => byCubicle('files', cubicle.id), ['files'], [cubicle.id]);
  const ready = files?.filter((f) => f.status === 'ready') ?? [];
  const dueCount = useLive(async () => (await byCubicle('cards', cubicle.id)).filter((c) => c.due <= Date.now()).length, ['cards'], [cubicle.id]);

  useEffect(() => {
    writeLocal('vubicle.tool', tool);
  }, [tool]);
  useEffect(() => {
    if (fileId && files && !ready.some((f) => f.id === fileId)) setFileId(undefined);
  }, [files]);
  // A new cubicle has nothing to study yet, so on a phone start on the files.
  useEffect(() => {
    if (files && !files.length && matchMedia('(max-width: 900px)').matches) setFilesOpen(true);
  }, [files?.length === 0]);

  const api: DeskApi = {
    cubicle,
    fileId,
    seed,
    openSource: (id, list) => setView({ id, all: list ?? [id] }),
    go: (t, text) => {
      setTool(t);
      setFilesOpen(false);
      if (text) setSeed({ tool: t, text, n: Date.now() });
    },
  };

  const hasFiles = ready.length > 0;
  return (
    <Desk.Provider value={api}>
      <div className="shell">
        <header className="top">
          <a className="mark" href="/" aria-label="Vubicle home" translate="no">
            <img className="logo-light" src="/vubicle-logo.svg" alt="Vubicle" width={367} height={100} />
            <img className="logo-dark" src="/vubicle-logo-dark.svg" alt="Vubicle" width={367} height={100} />
            <img className="logo-icon" src="/favicon.svg" alt="Vubicle" width={28} height={28} />
          </a>
          <label className="sr-only" htmlFor="cubicle-switch">
            Cubicle
          </label>
          <select
            id="cubicle-switch"
            className="input switcher"
            value={cubicle.id}
            onChange={(e) => (e.target.value === '__new' ? onNew() : onSwitch(e.target.value))}
          >
            {all.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">+ New cubicle</option>
          </select>
          <div className="spacer" />
          <LineBadge />
          <TimerChip onOpen={() => setDrawer(true)} />
          <Menu label="Cubicle and app settings" button={<MoreHorizontal aria-hidden="true" />}>
            {(close) => (
              <>
                <button role="menuitem" onClick={() => (close(), onNew())}>
                  <Plus aria-hidden="true" /> New cubicle
                </button>
                <button role="menuitem" onClick={() => (close(), setDialog('rename'))}>
                  <Pencil aria-hidden="true" /> Rename this cubicle
                </button>
                <button role="menuitem" onClick={() => (close(), exportCubicle(cubicle).catch((e) => window.alert(e.message || 'The backup could not be made. Nothing was saved.')))}>
                  <Download aria-hidden="true" /> Export a backup
                </button>
                <LastBackup cubicleId={cubicle.id} />
                <ImportButton inMenu onDone={close} />
                <hr />
                <p className="menu-label" id="menu-samples">
                  Try a sample
                </p>
                {SAMPLES.map((s) => (
                  <button
                    key={s.id}
                    role="menuitem"
                    aria-describedby="menu-samples"
                    onClick={() => {
                      close();
                      // Opens the existing copy if this browser has one; otherwise imports it. No AI request.
                      openSample(s)
                        .then(onSwitch)
                        .catch((e) => window.alert((e as Error).message));
                    }}
                  >
                    <BookOpen aria-hidden="true" /> {s.label}
                  </button>
                ))}
                <hr />
                <button role="menuitem" onClick={() => (close(), setTheme('light'))}>
                  <Sun aria-hidden="true" /> Light theme
                </button>
                <button role="menuitem" onClick={() => (close(), setTheme('dark'))}>
                  <Moon aria-hidden="true" /> Dark theme
                </button>
                <button role="menuitem" onClick={() => (close(), setTheme('system'))}>
                  <Monitor aria-hidden="true" /> Match my device
                </button>
                <hr />
                <button role="menuitem" onClick={() => (close(), setDialog('privacy'))}>
                  <ShieldCheck aria-hidden="true" /> Privacy
                </button>
                <a role="menuitem" href="/">
                  <Home aria-hidden="true" /> Vubicle home
                </a>
                <hr />
                <button role="menuitem" className="danger" onClick={() => (close(), setDialog('delete'))}>
                  <Trash2 aria-hidden="true" /> Delete this cubicle
                </button>
              </>
            )}
          </Menu>
        </header>

        <div className={`body${view ? ' viewing' : ''}${filesOpen ? ' files-open' : ''}`}>
          <aside className="side" aria-label="Course files">
            <Files cubicle={cubicle} files={files ?? []} onDone={() => setFilesOpen(false)} />
          </aside>

          <main className="main">
            <BackupReminder cubicle={cubicle} fileNames={files?.map((f) => f.name) ?? []} />
            <div className="tools">
              <div className="tablist" role="tablist" aria-label="Study tools">
                <button role="tab" className="tab tool-only-phone" aria-selected={filesOpen} onClick={() => setFilesOpen(true)}>
                  <FolderOpen aria-hidden="true" /> Files
                </button>
                {MAIN.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-controls="tool-panel"
                    className="tab"
                    aria-selected={!filesOpen && tool === t.id}
                    onClick={() => api.go(t.id)}
                  >
                    <t.icon aria-hidden="true" /> <span className="wide-only">{t.name}</span>
                    <span className="narrow-only">{t.short}</span>
                    {t.id === 'cards' && !!dueCount && (
                      <span className="count num" aria-label={`${dueCount} due`}>
                        {dueCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {/* The other tools. While one is open, this button names it and looks selected. */}
              <button
                id="tab-more"
                className="tab more-tools"
                aria-haspopup="dialog"
                aria-expanded={drawer}
                aria-label={secondary && !filesOpen ? `More tools: ${secondary.name}` : 'More tools'}
                data-active={Boolean(secondary && !filesOpen)}
                onClick={() => setDrawer(true)}
              >
                {secondary && !filesOpen ? <secondary.icon aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
                {secondary && !filesOpen ? (
                  <span>{secondary.name}</span>
                ) : (
                  <>
                    <span className="wide-only">More tools</span>
                    <span className="narrow-only">More</span>
                  </>
                )}
                <ChevronDown aria-hidden="true" className="chev" />
              </button>
              {hasFiles && (
                <>
                  <label className="sr-only" htmlFor="scope">
                    Study from
                  </label>
                  <select id="scope" className="input scope" value={fileId ?? ''} onChange={(e) => setFileId(e.target.value || undefined)}>
                    <option value="">All files</option>
                    {ready.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
            <div className="panel" id="tool-panel" role="tabpanel" aria-labelledby={secondary ? 'tab-more' : `tab-${tool}`}>
              {!hasFiles ? (
                <NoFiles reading={files?.some((f) => f.status === 'reading')} onOpenFiles={() => setFilesOpen(true)} />
              ) : tool === 'chat' || tool === 'tutor' ? (
                <ChatTool key={tool + (fileId ?? '')} mode={tool} />
              ) : tool === 'cards' ? (
                <Cards />
              ) : tool === 'quiz' ? (
                <QuizTool />
              ) : tool === 'map' ? (
                <MapTool />
              ) : tool === 'briefs' ? (
                <Briefs />
              ) : (
                <Deadlines />
              )}
            </div>
          </main>

          {view && <Viewer chunkId={view.id} all={view.all} onPick={(id) => setView({ ...view, id })} onClose={() => setView(null)} />}
        </div>
      </div>
      <ToolsDrawer
        open={drawer}
        current={filesOpen ? undefined : tool}
        onClose={() => setDrawer(false)}
        onPick={(t) => {
          setDrawer(false);
          api.go(t);
        }}
      />
      <DeleteCubicle cubicle={cubicle} open={dialog === 'delete'} onClose={() => setDialog(null)} />
      <RenameDialog cubicle={cubicle} open={dialog === 'rename'} onClose={() => setDialog(null)} />
      <Dialog open={dialog === 'privacy'} onClose={() => setDialog(null)} label="Privacy">
        <div className="dialog">
          <h2>How your notes are used</h2>
          <PrivacyText />
          <div className="actions">
            <button className="btn primary" onClick={() => setDialog(null)}>
              Close
            </button>
          </div>
        </div>
      </Dialog>
    </Desk.Provider>
  );
}

/** A panel from the side with the secondary tools and the focus timer. A native dialog, so Escape closes it. */
function ToolsDrawer({ open, current, onClose, onPick }: { open: boolean; current?: Tool; onClose: () => void; onPick: (t: Tool) => void }) {
  return (
    <Dialog open={open} onClose={onClose} label="More tools" className="drawer">
      <div className="drawer-body">
        <div className="drawer-head">
          <h2>More tools</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <ul className="drawer-tools">
          {MORE.map((t) => (
            <li key={t.id}>
              <button aria-current={current === t.id ? 'page' : undefined} onClick={() => onPick(t.id)}>
                <t.icon aria-hidden="true" />
                <span>
                  <strong>{t.name}</strong>
                  <span className="small muted">{t.about}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <section className="drawer-timer" aria-labelledby="timer-title">
          <h3 id="timer-title">
            <TimerIcon aria-hidden="true" /> Focus timer
          </h3>
          <TimerPanel />
        </section>
      </div>
    </Dialog>
  );
}

function NoFiles({ reading, onOpenFiles }: { reading?: boolean; onOpenFiles: () => void }) {
  return (
    <div className="empty">
      <h1>{reading ? 'Reading your file' : 'Add your course material'}</h1>
      <p>
        {reading
          ? 'The study tools open as soon as the first file is read. Large PDFs take a few seconds.'
          : 'Drop slides, readings, a syllabus or your own notes into Files. They are read here in your browser.'}
      </p>
      <button className="btn primary tool-only-phone" onClick={onOpenFiles}>
        <FolderOpen aria-hidden="true" /> Open files
      </button>
    </div>
  );
}
