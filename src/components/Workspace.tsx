import { Suspense, lazy, useCallback, useDeferredValue, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useVault } from '../state/vaultStore.ts';
import { useIsNarrow } from '../hooks/useMediaQuery.ts';
import { useScrollSync } from '../hooks/useScrollSync.ts';
/**
 * CodeMirror is the single heaviest thing this app loads, and nothing needs it
 * until a note is actually opened — the folder splash and the reading path
 * never touch it. Splitting it out keeps it off the critical path.
 */
const Editor = lazy(() => import('./Editor.tsx').then((module) => ({ default: module.Editor })));
import type { PasteOffer } from './Editor.tsx';
import { ConvertOffer } from './ConvertOffer.tsx';
import { SuggestionBar } from './SuggestionBar.tsx';
import type { SuggestContext } from '../markdown/suggest.ts';
import { Preview } from './Preview.tsx';

const MIN_PANE_PERCENT = 20;

export function Workspace({ path, source }: { path: string; source: string }) {
  const draft = useVault((s) => s.draft);
  const revision = useVault((s) => s.revision);
  const setDraft = useVault((s) => s.setDraft);
  const stored = useVault((s) => s.viewMode);
  const narrow = useIsNarrow();
  // Resizing a desktop window down must not leave two unreadable columns, so the
  // effective mode is derived rather than written back over the stored choice.
  // A phone lands on the rendered note rather than the source: reading is what
  // most phone visits are for, and on Android the file cannot be saved anyway.
  const viewMode = narrow && stored === 'split' ? 'preview' : stored;

  const [view, setView] = useState<EditorView | null>(null);
  const [context, setContext] = useState<SuggestContext | null>(null);
  const [paste, setPaste] = useState<PasteOffer | null>(null);
  const setEditorView = useVault((s) => s.setEditorView);
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
          {/* The revision changes when the buffer is replaced from outside the
              editor — a revert, or a reload after a conflict — which is the one
              case where the document has to be pushed in rather than typed. */}
          <Suspense fallback={<p className="pane-loading">Loading editor…</p>}>
            <Editor
              key={`${path}#${revision}`}
              initialDoc={draft ?? source}
              onChange={setDraft}
              onContext={setContext}
              onPaste={setPaste}
              onViewReady={(next) => {
                setView(next);
                setEditorView(next);
              }}
            />
          </Suspense>
          {paste && <ConvertOffer view={view} offer={paste} onDone={() => setPaste(null)} />}
          <SuggestionBar view={view} context={context} />
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
        <div
          className={`pane pane-preview${viewMode === 'preview' ? ' is-reader' : ''}`}
          ref={setPreviewPane}
        >
          <Preview source={rendered} path={path} />
        </div>
      )}
    </div>
  );
}
