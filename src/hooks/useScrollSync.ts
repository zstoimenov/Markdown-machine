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
  const frameRef = useRef(0);

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

    /**
     * Apply a scroll, then apply it again once the frame has settled.
     *
     * CodeMirror renders only what is on screen and *estimates* the height of
     * everything else. A jump into unrendered territory is therefore computed
     * from a guess, and landing there is what makes the editor render that
     * region and replace the guess with real measurements — which moves the
     * document under the scroll position it was just given, by a screenful on a
     * long note. The same is true in reverse: a programmatic jump in the editor
     * is read for its top line before that settling has happened, so the preview
     * is sent to the line that *was* at the top.
     *
     * Re-applying on the next frame, once the heights are real, lands on the
     * line rather than near it. It stops as soon as the target stops moving,
     * which is the first pass whenever the guess was already right.
     */
    function settle(apply: (element: HTMLElement) => void, element: HTMLElement) {
      window.cancelAnimationFrame(frameRef.current);
      let last = -1;
      const pass = (remaining: number) => {
        apply(element);
        if (remaining > 0 && element.scrollTop !== last) {
          last = element.scrollTop;
          frameRef.current = window.requestAnimationFrame(() => pass(remaining - 1));
        }
      };
      pass(2);
    }

    /** Zero-based source line currently at the top of the editor viewport. */
    function editorTopLine(): number {
      if (!view) return 0;
      const box = view.scrollDOM.getBoundingClientRect();
      // Probe just inside the text, not just inside the scroller. The content
      // carries its own measure and is centred in the pane, so the scroller's
      // left edge is margin — sampling there asks which line is under a point
      // beside the column rather than in it, and the answer drifts by a block.
      const content = view.contentDOM.getBoundingClientRect();
      const x = clamp(content.left + 8, box.left + 1, box.right - 1);
      /**
       * Down into the first line rather than onto its very first pixel. A line
       * scrolled all but away still covers `top + 1`, so probing there named a
       * block the reader can no longer see and sent the preview to it — and
       * whether it happened at all came down to where a line boundary fell,
       * which moves with the editor's line height.
       */
      const y = box.top + Math.min(view.defaultLineHeight / 2, box.height / 2);
      const pos = view.posAtCoords({ x, y }, false);
      return view.state.doc.lineAt(clamp(pos, 0, view.state.doc.length)).number - 1;
    }

    function editorScrollTopForLine(line: number): number {
      if (!view) return 0;
      const doc = view.state.doc;
      const number = clamp(Math.round(line) + 1, 1, doc.lines);
      const block = view.lineBlockAt(doc.line(number).from);
      /**
       * `block.top` is measured from the top of the first line; scrollTop is
       * measured from the top of the scrollable content, and the difference
       * between the two origins is exactly the content's top padding. Asking
       * CodeMirror for that padding converts between them directly.
       *
       * This used to go via `documentTop` — where the document currently sits on
       * screen — added to the scroller's live `scrollTop`. Those two are not read
       * at the same moment: `scrollTop` is live, while `documentTop` is a cached
       * value CodeMirror refreshes on its measure cycle. Scroll the editor
       * programmatically, as this very sync does, and ask again before that cycle
       * has run, and the pair disagrees by however far the editor was just moved
       * — so the panes landed a screenful out on long documents, and whether they
       * did at all depended on the editor's line height.
       */
      return view.documentPadding.top + block.top;
    }

    function onEditorScroll() {
      drive('editor', () => {
        if (!preview) return;
        settle((element) => {
          element.scrollTop = clamp(
            interpolate(anchorsRef.current, editorTopLine(), 'line'),
            0,
            element.scrollHeight - element.clientHeight,
          );
        }, preview);
      });
    }

    function onPreviewScroll() {
      drive('preview', () => {
        if (!view || !preview) return;
        const line = interpolate(anchorsRef.current, preview.scrollTop, 'top');
        const scroller = view.scrollDOM;

        settle((element) => {
          element.scrollTop = clamp(
            editorScrollTopForLine(line),
            0,
            element.scrollHeight - element.clientHeight,
          );
        }, scroller);
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
      window.cancelAnimationFrame(frameRef.current);
      driverRef.current = null;
      scroller.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
      observer.disconnect();
    };
  }, [view, preview, renderKey, enabled]);
}
