import { useEffect } from 'react';
import { isDirty, useVault } from './state/vaultStore';
import { FileTree } from './components/FileTree';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { ConflictBar } from './components/ConflictBar';
import { RepairBar } from './components/RepairBar';
import { EmptyState } from './components/EmptyState';
import { FilePicker } from './components/FilePicker';
import { FallbackNotice } from './components/FallbackNotice';
import { useIsNarrow } from './hooks/useMediaQuery';
import { useAutosave, useUnsavedChangesWarning } from './hooks/useAutosave';
import { useKeyboardInsets } from './hooks/useViewport';

function Splash({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="splash">
      <div className="splash-card">
        <h1>{title}</h1>
        {children}
        {action}
      </div>
    </div>
  );
}

export function App() {
  const status = useVault((s) => s.status);
  const rememberedName = useVault((s) => s.rememberedName);
  const activePath = useVault((s) => s.activePath);
  const source = useVault((s) => s.source);
  const loadingFile = useVault((s) => s.loadingFile);
  const dirty = useVault(isDirty);
  const narrow = useIsNarrow();
  const sidebarOpen = useVault((s) => s.sidebarOpen);
  const setSidebarOpen = useVault((s) => s.setSidebarOpen);
  const mode = useVault((s) => s.mode);
  const canWrite = useVault((s) => s.canWrite);
  const enableWriting = useVault((s) => s.enableWriting);
  const init = useVault((s) => s.init);
  const pick = useVault((s) => s.pick);
  const reopen = useVault((s) => s.reopen);

  useEffect(() => {
    void init();
  }, [init]);

  useUnsavedChangesWarning(dirty);
  useAutosave();
  // Keeps the app inside what the software keyboard leaves of the screen, so
  // the suggestion row lands on top of the keys rather than under them.
  useKeyboardInsets();

  if (status === 'checking') return <div className="splash" />;

  if (status === 'unsupported') {
    return (
      <Splash title="No folders in this browser" action={<FilePicker />}>
        <p>
          Reading and writing the actual files in a folder needs the File System Access API.
          Today that means Chrome, Edge, Brave, Arc or Opera on the desktop — Firefox and
          Safari have not shipped it, and every browser on iOS is Safari underneath.
        </p>
        <p>
          So here, notes are kept <strong>in this browser, on this device</strong>. Add the
          files you want to work on and they stay: writable, more than one, still here after a
          reload. Saving a copy out is how one goes back to a real folder.
        </p>
        <p className="muted">
          Browser storage is not a disk. Safari clears it after a week without a visit unless
          the app is on your home screen, so put it there and keep copies of anything that
          matters.
        </p>
      </Splash>
    );
  }

  if (status === 'empty') {
    return (
      <Splash
        title="Markdown Machine"
        action={
          <button type="button" className="button button-primary" onClick={() => void pick()}>
            Choose a folder…
          </button>
        }
      >
        <p>
          Point it at a folder of markdown files. Nothing is uploaded and nothing is copied —
          it reads the files where they already live.
        </p>
      </Splash>
    );
  }

  if (status === 'needs-permission') {
    return (
      <Splash
        title="Welcome back"
        action={
          <div className="splash-actions">
            <button type="button" className="button button-primary" onClick={() => void reopen()}>
              Reopen {rememberedName}
            </button>
            <button type="button" className="button" onClick={() => void pick()}>
              Choose a different folder…
            </button>
          </div>
        }
      >
        <p>
          One tap and your notes are back. If the prompt offers{' '}
          <strong>Allow on every visit</strong>, take it — that ends the asking for good, and
          the folder opens straight away from then on.
        </p>
        <p className="muted">
          Not every version offers it. Where the prompt says <em>until you close all tabs</em>,
          the permission lasts only while the app stays open, and there is no way around that
          from in here — it is what the browser charges for keeping your notes in a folder on
          your disk rather than inside itself.
        </p>
      </Splash>
    );
  }

  return (
    <div className="app">
      <Toolbar />
      {!canWrite && mode === 'vault' && (
        <div className="notice">
          <span>This folder is open for reading only, so nothing you type will be saved.</span>
          <button type="button" className="button" onClick={() => void enableWriting()}>
            Allow editing
          </button>
        </div>
      )}
      {mode === 'device' && <FallbackNotice />}
      <ConflictBar />
      <RepairBar />
      <div className="workspace">
        {/* When closed at phone widths the drawer is `visibility: hidden`, which
            takes its buttons out of the tab order without a React 18 `inert`. */}
        <aside className={`sidebar${narrow && sidebarOpen ? ' is-open' : ''}`}>
          <FileTree />
        </aside>
        {narrow && sidebarOpen && (
          <button
            type="button"
            className="scrim"
            aria-label="Close notes"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main className="reader">
          {activePath === null && <EmptyState message="Pick a note from the sidebar to open it." />}
          {activePath !== null && loadingFile && <p className="reader-empty">Opening…</p>}
          {activePath !== null && !loadingFile && source !== null && (
            <Workspace key={activePath} path={activePath} source={source} />
          )}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
