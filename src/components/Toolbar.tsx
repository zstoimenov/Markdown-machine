import { useIsNarrow } from '../hooks/useMediaQuery';
import { CopyButton } from './CopyButton';
import { useVault, type ViewMode } from '../state/vaultStore';

const MODES: Array<{ mode: ViewMode; label: string; hint: string }> = [
  { mode: 'editor', label: 'Write', hint: 'Editor only' },
  { mode: 'split', label: 'Split', hint: 'Editor and preview side by side' },
  { mode: 'preview', label: 'Read', hint: 'Preview only' },
];

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
      <span className="vault-name" title={vaultName ?? undefined}>
        {vaultName}
      </span>

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
        <CopyButton />
        {mode === 'single-file' && activePath !== null && (
          <button type="button" className="button button-primary" onClick={downloadActive}>
            Download
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
      </div>
    </header>
  );
}
