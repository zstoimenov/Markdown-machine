import { useEffect } from 'react';
import { isDirty, useVault } from './state/vaultStore';
import { FileTree } from './components/FileTree';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Workspace } from './components/Workspace';
import { ConflictBar } from './components/ConflictBar';
import { EmptyState } from './components/EmptyState';
import { FilePicker } from './components/FilePicker';
import { useAutosave, useUnsavedChangesWarning } from './hooks/useAutosave';

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

  if (status === 'checking') return <div className="splash" />;

  if (status === 'unsupported') {
    return (
      <Splash title="This browser can’t open folders" action={<FilePicker />}>
        <p>
          Markdown Machine reads and writes the actual files in a folder on your disk, which
          needs the File System Access API. Today that means Chrome, Edge, Brave, Arc or
          Opera on the desktop — Firefox and Safari have not shipped it.
        </p>
        <p className="muted">
          You can still open one file at a time here. It opens read-only, because this browser
          gives no way to write back to the original — edit it and download a copy.
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
          Chrome asks again for folder access each time the page loads. One click and your
          notes are back.
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
      {mode === 'single-file' && (
        <div className="notice">
          <span>
            One file, opened read-only — this browser cannot write back to the original.
            Your edits live here until you download a copy.
          </span>
        </div>
      )}
      <ConflictBar />
      <div className="workspace">
        <aside className="sidebar">
          <FileTree />
        </aside>
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
