import { useEffect, useRef } from 'react';
import { isDirty, useVault } from '../state/vaultStore';

/** Quiet enough not to write on every keystroke, short enough to feel automatic. */
const IDLE_MS = 800;

/**
 * Write the buffer back to disk shortly after typing stops, and on Ctrl/Cmd+S.
 *
 * Autosave deliberately backs off in the two states where writing again would be
 * wrong rather than merely redundant: a conflict, which needs a person to decide,
 * and a missing write grant, which needs one to be asked for.
 */
export function useAutosave() {
  const dirty = useVault(isDirty);
  const draft = useVault((s) => s.draft);
  const canWrite = useVault((s) => s.canWrite);
  const saveState = useVault((s) => s.saveState);
  const save = useVault((s) => s.save);

  const blocked = !canWrite || saveState.kind === 'conflict';

  useEffect(() => {
    if (!dirty || blocked) return;
    const timer = window.setTimeout(() => void save(), IDLE_MS);
    // Each keystroke replaces the pending write rather than queueing another.
    return () => window.clearTimeout(timer);
  }, [dirty, draft, blocked, save]);

  // Ctrl/Cmd+S saves now. Bound on the window so it works wherever focus sits,
  // and always preventDefault-ed: the browser's own "save page" dialog appearing
  // in a text editor would be a genuinely alarming thing to see.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Warn before a reload throws away edits that never reached disk. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Chrome requires returnValue to be set; the string itself is never shown.
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
