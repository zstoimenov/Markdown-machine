import { useEffect, useState } from 'react';
import { countSymbols, countWords } from '../markdown/counts.ts';
import { canRevert, isDirty, useVault } from '../state/vaultStore.ts';

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

/**
 * Whether a note has reached the disk is the one thing here worth interrupting
 * for, so the region is polite rather than assertive — it waits for a pause in
 * whatever is being read rather than talking over it — and `aria-atomic` so
 * "not saved — no write access" arrives as a sentence rather than a changed word.
 *
 * The elapsed time is deliberately not announced: "saved 4s ago" reworded every
 * five seconds would be a live region that never stops talking.
 */
function SaveState() {
  const saveState = useVault((s) => s.saveState);
  const dirty = useVault(isDirty);
  const canWrite = useVault((s) => s.canWrite);
  const now = useNow(saveState.kind === 'saved');

  let label: React.ReactNode = 'saved';
  let tone = '';
  let announce = 'Saved';

  if (!canWrite) {
    label = 'read-only';
    tone = ' is-warn';
    announce = 'This folder is read-only. Nothing will be saved.';
  } else if (saveState.kind === 'saving') {
    label = 'saving…';
    announce = '';
  } else if (saveState.kind === 'conflict') {
    label = 'changed on disk';
    tone = ' is-warn';
    announce = 'This note changed on disk. Saving is paused until you choose.';
  } else if (saveState.kind === 'error') {
    label = <>not saved — {saveState.message}</>;
    tone = ' is-warn';
    announce = `Not saved. ${saveState.message}`;
  } else if (dirty) {
    label = 'unsaved…';
    tone = ' is-dirty';
    announce = '';
  } else if (saveState.kind === 'saved') {
    label = `saved ${ago(saveState.at, now)}`;
    announce = 'Saved';
  }

  return (
    <>
      <span className={`status-save${tone}`}>{label}</span>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announce}
      </span>
    </>
  );
}

export function StatusBar() {
  const activePath = useVault((s) => s.activePath);
  const source = useVault((s) => s.source);
  const draft = useVault((s) => s.draft);
  const revertable = useVault(canRevert);
  const revert = useVault((s) => s.revert);
  const error = useVault((s) => s.error);
  const notice = useVault((s) => s.notice);

  // No note open — after a delete, most of all, which is exactly when there is
  // something to say. The notice belongs here as much as in the branch below.
  if (!activePath) {
    return (
      <footer className="status">
        {error && (
          <span className="is-warn" role="alert">
            {error}
          </span>
        )}
        {notice && (
          <span className="status-notice" role="status" aria-live="polite">
            {notice}
          </span>
        )}
      </footer>
    );
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
      {error && (
        <span className="is-warn" role="alert">
          {error}
        </span>
      )}
      {notice && (
        <span className="status-notice" role="status" aria-live="polite">
          {notice}
        </span>
      )}
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
