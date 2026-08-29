import { useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';

interface Anchor {
  /** Zero-based source line. */
  line: number;
  /** Distance from the top of the preview's scrollable content. */
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Map a value between two anchor lists by finding the bracketing pair and
 * interpolating linearly between them. Both directions of the sync are the same
 * operation with the two columns swapped.
 */
function interpolate(anchors: Anchor[], value: number, from: 'line' | 'top'): number {
  if (anchors.length === 0) return 0;
  const to = from === 'line' ? 'top' : 'line';

  const first = anchors[0];
  if (!first || value <= first[from]) return first ? first[to] : 0;

  for (let i = 1; i < anchors.length; i += 1) {
    const previous = anchors[i - 1];
    const next = anchors[i];
    if (!previous || !next) break;
    if (value <= next[from]) {
      const span = next[from] - previous[from];
      const ratio = span === 0 ? 0 : (value - previous[from]) / span;
      return previous[to] + ratio * (next[to] - previous[to]);
    }
  }

  const last = anchors[anchors.length - 1];
  return last ? last[to] : 0;
}

/**
 * Keep the editor and the preview looking at the same part of the document.
 *
 * Both panes are described in the same currency — a list of (source line,
 * pixel offset) anchors — so syncing is interpolation between the two lists
 * rather than matching scroll percentages, which drift apart the moment a
 * document contains a block whose rendered height differs from its source height.
 */
export function useScrollSync(
  view: EditorView | null,
  preview: HTMLElement | null,
  /** Changes whenever the rendered HTML does, so anchors get re-measured. */
  renderKey: string,
  enabled: boolean,
) {
  const anchorsRef = useRef<Anchor[]>([]);
  // Which pane the user is currently driving. Without this the two scroll
  // handlers trigger each other and the panes creep or oscillate.
  const driverRef = useRef<'editor' | 'preview' | null>(null);
  const releaseRef = useRef(0);

  useEffect(() => {
    if (!enabled || !view || !preview) return;

    function measure() {
      if (!preview) return;
      const base = preview.getBoundingClientRect().top - preview.scrollTop;
      const found: Anchor[] = [{ line: 0, top: 0 }];
      for (const element of preview.querySelectorAll<HTMLElement>('[data-line]')) {
        const line = Number(element.dataset.line);
        if (!Number.isFinite(line)) continue;
        found.push({ line, top: element.getBoundingClientRect().top - base });
      }
      // Rendered order should already be source order, but a stray anchor would
      // silently break the bracketing search, so make it true rather than assume it.
      found.sort((a, b) => a.line - b.line);
      anchorsRef.current = found;
    }

    function drive(who: 'editor' | 'preview', move: () => void) {
      if (driverRef.current && driverRef.current !== who) return;
      driverRef.current = who;
      move();
      window.clearTimeout(releaseRef.current);
      releaseRef.current = window.setTimeout(() => {
        driverRef.current = null;
      }, 150);
    }

    /** Zero-based source line currently at the top of the editor viewport. */
    function editorTopLine(): number {
      if (!view) return 0;
      const box = view.scrollDOM.getBoundingClientRect();
      const pos = view.posAtCoords({ x: box.left + 8, y: box.top + 1 }, false);
      return view.state.doc.lineAt(clamp(pos, 0, view.state.doc.length)).number - 1;
    }

    function editorScrollTopForLine(line: number): number {
      if (!view) return 0;
      const doc = view.state.doc;
      const number = clamp(Math.round(line) + 1, 1, doc.lines);
      const block = view.lineBlockAt(doc.line(number).from);
      const scroller = view.scrollDOM;
      // block.top is measured from the top of the document, which is not the same
      // origin as scrollTop — the content carries padding, and CodeMirror is free
      // to change how it accounts for it. Going via documentTop (where the document
      // currently sits on screen) converts between the two without assuming either.
      const offset = view.documentTop - scroller.getBoundingClientRect().top;
      return scroller.scrollTop + offset + block.top;
    }

    function onEditorScroll() {
      drive('editor', () => {
        if (!preview) return;
        const target = interpolate(anchorsRef.current, editorTopLine(), 'line');
        preview.scrollTop = clamp(target, 0, preview.scrollHeight - preview.clientHeight);
      });
    }

    function onPreviewScroll() {
      drive('preview', () => {
        if (!view || !preview) return;
        const line = interpolate(anchorsRef.current, preview.scrollTop, 'top');
        const scroller = view.scrollDOM;
        const target = editorScrollTopForLine(line);
        scroller.scrollTop = clamp(target, 0, scroller.scrollHeight - scroller.clientHeight);
      });
    }

    measure();
    const scroller = view.scrollDOM;
    scroller.addEventListener('scroll', onEditorScroll, { passive: true });
    preview.addEventListener('scroll', onPreviewScroll, { passive: true });

    // Images finishing their load, or the window resizing, move every anchor below them.
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    for (const child of preview.children) observer.observe(child);

    return () => {
      window.clearTimeout(releaseRef.current);
      driverRef.current = null;
      scroller.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
      observer.disconnect();
    };
  }, [view, preview, renderKey, enabled]);
}
