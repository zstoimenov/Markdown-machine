import { useIsNarrow } from '../hooks/useMediaQuery';
import { baseName } from '../fs/types';
import { canShareFile } from '../fs/singleFileAdapter';
import { CopyButton } from './CopyButton';
import { NoteMenu } from './NoteMenu';
import { isDirty, useVault, type ViewMode } from '../state/vaultStore';

const MODES: Array<{ mode: ViewMode; label: string; hint: string }> = [
  { mode: 'editor', label: 'Write', hint: 'Editor only' },
  { mode: 'split', label: 'Split', hint: 'Editor and preview side by side' },
  { mode: 'preview', label: 'Read', hint: 'Preview only' },
];

/**
 * The one thing from the status bar that is wanted mid-sentence. The rest of it
 * is out of the way while the keyboard is up, and a note that has not reached
 * the disk yet is not something to find out about later.
 */
function SaveDot() {
  const dirty = useVault(isDirty);
  const saveState = useVault((s) => s.saveState);
  const canWrite = useVault((s) => s.canWrite);

  if (saveState.kind === 'conflict' || saveState.kind === 'error') {
    return <span className="save-dot is-warn" title="Not saved" aria-label="Not saved" />;
  }
  if (!canWrite || !dirty) return null;
  return <span className="save-dot" title="Unsaved" aria-label="Unsaved" />;
}

export function Toolbar() {
  const narrow = useIsNarrow();
  const sidebarOpen = useVault((s) => s.sidebarOpen);
  const setSidebarOpen = useVault((s) => s.setSidebarOpen);
  const vaultName = useVault((s) => s.vaultName);
  const activePath = useVault((s) => s.activePath);
  const viewMode = useVault((s) => s.viewMode);
  const setViewMode = useVault((s) => s.setViewMode);
  const mode = useVault((s) => s.mode);
  const pick = useVault((s) => s.pick);
  const close = useVault((s) => s.close);
  const downloadActive = useVault((s) => s.downloadActive);

  // On a phone the folder's name is trivia and the note's name is where you are.
  const title = narrow && activePath !== null ? baseName(activePath) : vaultName;

  return (
    <header className="toolbar">
      {narrow && (
        <button
          type="button"
          className="icon-button"
          aria-label="Notes"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>
      )}
      <h1 className="brand">Markdown Machine</h1>
      <span className="vault-name" title={title ?? undefined}>
        {title}
      </span>
      {narrow && <SaveDot />}

      {activePath !== null && (
        <div className="segmented" role="group" aria-label="View mode">
          {MODES.filter(({ mode }) => !(narrow && mode === 'split')).map(({ mode, label, hint }) => (
            <button
              key={mode}
              type="button"
              title={hint}
              aria-pressed={viewMode === mode}
              className={`segment${viewMode === mode ? ' is-on' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="toolbar-actions">
        {/* A phone gets one button here; everything behind it is occasional. */}
        {narrow ? (
          <NoteMenu />
        ) : (
          <>
            <CopyButton />
            {mode === 'single-file' && activePath !== null && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => void downloadActive()}
              >
                {canShareFile() ? 'Save a copy…' : 'Download'}
              </button>
            )}
            {mode === 'vault' && (
              <button type="button" className="button" onClick={() => void pick()}>
                Open folder…
              </button>
            )}
            <button type="button" className="button button-quiet" onClick={() => void close()}>
              Close
            </button>
          </>
        )}
      </div>
    </header>
  );
}
