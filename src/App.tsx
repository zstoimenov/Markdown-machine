import { useEffect } from 'react';
import { isDirty, useVault } from './state/vaultStore';
import { FileTree } from './components/FileTree';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Workspace, useUnsavedChangesWarning } from './components/Workspace';

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
  const init = useVault((s) => s.init);
  const pick = useVault((s) => s.pick);
  const reopen = useVault((s) => s.reopen);

  useEffect(() => {
    void init();
  }, [init]);

  useUnsavedChangesWarning(dirty);

  if (status === 'checking') return <div className="splash" />;

  if (status === 'unsupported') {
    return (
      <Splash title="This browser can’t open folders">
        <p>
          Markdown Machine reads and writes the actual files in a folder on your disk, which
          needs the File System Access API. Today that means Chrome, Edge, Brave, Arc or
          Opera on the desktop — Firefox and Safari have not shipped it.
        </p>
        <p className="muted">Open this page in a Chromium browser to get started.</p>
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
      <div className="workspace">
        <aside className="sidebar">
          <FileTree />
        </aside>
        <main className="reader">
          {activePath === null && (
            <p className="reader-empty">Pick a note from the sidebar to open it.</p>
          )}
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
