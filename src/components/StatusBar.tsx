import { useEffect, useState } from 'react';
import { countSymbols, countWords } from '../markdown/plaintext';
import { canRevert, isDirty, useVault } from '../state/vaultStore';

function ago(from: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** Re-render on a slow tick so "saved 4s ago" does not sit there getting wrong. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function SaveState() {
  const saveState = useVault((s) => s.saveState);
  const dirty = useVault(isDirty);
  const canWrite = useVault((s) => s.canWrite);
  const now = useNow(saveState.kind === 'saved');

  if (!canWrite) return <span className="status-save is-warn">read-only</span>;
  if (saveState.kind === 'saving') return <span className="status-save">saving…</span>;
  if (saveState.kind === 'conflict') {
    return <span className="status-save is-warn">changed on disk</span>;
  }
  if (saveState.kind === 'error') {
    return <span className="status-save is-warn">not saved — {saveState.message}</span>;
  }
  if (dirty) return <span className="status-save is-dirty">unsaved…</span>;
  if (saveState.kind === 'saved') {
    return <span className="status-save">saved {ago(saveState.at, now)}</span>;
  }
  return <span className="status-save">saved</span>;
}

export function StatusBar() {
  const activePath = useVault((s) => s.activePath);
  const source = useVault((s) => s.source);
  const draft = useVault((s) => s.draft);
  const revertable = useVault(canRevert);
  const revert = useVault((s) => s.revert);
  const error = useVault((s) => s.error);

  if (!activePath) {
    return <footer className="status">{error && <span className="is-warn">{error}</span>}</footer>;
  }

  const value = draft ?? source;
  const words = value ? countWords(value) : 0;
  const symbols = value ? countSymbols(value) : 0;

  return (
    <footer className="status">
      <span className="status-path">{activePath}</span>
      {value !== null && (
        <>
          <span>
            {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          </span>
          <span title="Characters in the source, counting spaces">
            {symbols.toLocaleString()} {symbols === 1 ? 'symbol' : 'symbols'}
          </span>
        </>
      )}
      {error && <span className="is-warn">{error}</span>}
      {revertable && (
        <button
          type="button"
          className="link-button"
          title="Restore this note to how it was when you opened it"
          onClick={revert}
        >
          Revert
        </button>
      )}
      <SaveState />
    </footer>
  );
}
