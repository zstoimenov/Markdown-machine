import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { toMarkdown } from '../markdown/fromPlainText.ts';
import type { PasteOffer } from './Editor.tsx';

/**
 * Offered the moment plain text is pasted into a note, and gone again as soon
 * as anything else is typed.
 *
 * The paste itself is never touched: what arrived is what is in the document,
 * and this only says what a conversion would do to it. Pressing Convert rewrites
 * the pasted range in one transaction, so `Ctrl`/`Cmd`+`Z` takes it back and
 * leaves the paste — the same contract the repair bar makes.
 */
export function ConvertOffer({
  view,
  offer,
  onDone,
}: {
  view: EditorView | null;
  offer: PasteOffer;
  onDone: () => void;
}) {
  function convert() {
    if (!view) return onDone();
    // Re-read the range rather than trusting a copy: the document is the truth,
    // and this is the same text the offer was made about.
    const pasted = view.state.sliceDoc(offer.from, Math.min(offer.to, view.state.doc.length));
    const { text } = toMarkdown(pasted);
    if (text !== pasted) {
      view.dispatch({
        changes: { from: offer.from, to: offer.from + pasted.length, insert: text },
        selection: EditorSelection.cursor(offer.from + text.length),
        userEvent: 'input.convert',
        scrollIntoView: true,
      });
    }
    view.focus();
    onDone();
  }

  return (
    <div className="notice notice-convert" role="status">
      <div className="notice-body">
        <strong>That looks like plain text.</strong>{' '}
        <span>
          Converting it would have{' '}
          {new Intl.ListFormat('en').format(offer.changes.map((change) => change.label))}.
        </span>
      </div>
      <div className="notice-actions">
        <button type="button" className="button" onClick={onDone}>
          Leave it
        </button>
        <button type="button" className="button button-primary" onClick={convert}>
          Convert
        </button>
      </div>
    </div>
  );
}
