import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useVault } from '../state/vaultStore';
import { useScrollSync } from '../hooks/useScrollSync';
import { Editor } from './Editor';
import { Preview } from './Preview';

const MIN_PANE_PERCENT = 20;

export function Workspace({ path, source }: { path: string; source: string }) {
  const draft = useVault((s) => s.draft);
  const setDraft = useVault((s) => s.setDraft);
  const viewMode = useVault((s) => s.viewMode);

  const [view, setView] = useState<EditorView | null>(null);
  const [previewPane, setPreviewPane] = useState<HTMLElement | null>(null);
  const [editorPercent, setEditorPercent] = useState(50);
  const splitRef = useRef<HTMLDivElement>(null);

  const value = draft ?? source;
  // Typing stays responsive on long documents: the preview re-renders at a lower
  // priority and React drops intermediate renders while keystrokes are arriving.
  const rendered = useDeferredValue(value);

  useScrollSync(view, previewPane, rendered, viewMode === 'split');

  /**
   * Pointer capture keeps every move event coming to the divider even while the
   * cursor is over the editor, so the drag needs no window-level listeners and
   * nothing has to disable pointer events across the page. An earlier version did
   * the latter, which changed what was under the cursor mid-gesture and quietly
   * broke double-click-to-reset.
   */
  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-dragging');
  }, []);

  const onDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const split = splitRef.current;
    if (!split || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const box = split.getBoundingClientRect();
    const percent = ((event.clientX - box.left) / box.width) * 100;
    setEditorPercent(Math.min(100 - MIN_PANE_PERCENT, Math.max(MIN_PANE_PERCENT, percent)));
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove('is-dragging');
  }, []);

  const showEditor = viewMode !== 'preview';
  const showPreview = viewMode !== 'editor';
  const split = viewMode === 'split';

  return (
    <div className="split" ref={splitRef}>
      {showEditor && (
        <div className="pane pane-editor" style={split ? { width: `${editorPercent}%` } : undefined}>
          <Editor key={path} initialDoc={source} onChange={setDraft} onViewReady={setView} />
        </div>
      )}

      {split && (
        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => setEditorPercent(50)}
        />
      )}

      {showPreview && (
        <div className="pane pane-preview" ref={setPreviewPane}>
          <Preview source={rendered} path={path} />
        </div>
      )}
    </div>
  );
}

/** Warn before a reload throws away edits that have nowhere to go yet. */
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
