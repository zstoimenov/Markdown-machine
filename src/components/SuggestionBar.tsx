import { useMemo, useState } from 'react';
import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  BLOCK_PREFIX,
  suggest,
  type SuggestContext,
  type Suggestion,
  type SuggestionEdit,
} from '../markdown/suggest.ts';

/**
 * A row of the markdown that could sensibly come next, under the editor.
 *
 * The shortcuts in `commands.ts` already cover the markers a touch typist has in
 * their fingers. This is for the rest of it: the closing half you have to
 * remember, the table skeleton nobody types from memory, and a phone, where
 * there is no `Mod` key at all and `|` is three taps deep in the keyboard.
 *
 * It suggests rather than completes. Nothing here fires on its own — the
 * document only changes when a chip is pressed.
 */

/**
 * Suggestions are applied to the editor, not to the store, and each is one
 * transaction — so a single `Ctrl`/`Cmd`+`Z` takes one back, whole.
 */
function apply(view: EditorView, edit: SuggestionEdit) {
  const { state } = view;
  const range = state.selection.main;

  if (edit.kind === 'prefix') {
    const line = state.doc.lineAt(range.from);
    const match = BLOCK_PREFIX.exec(line.text);
    const existing = match?.[0] ?? '';
    const insert = `${match?.[1] ?? ''}${edit.text}`;
    // The cursor keeps its place in the words, which have not moved relative to
    // each other — only the marker in front of them has changed width.
    const caret = Math.max(line.from + insert.length, range.from + insert.length - existing.length);
    view.dispatch({
      changes: { from: line.from, to: line.from + existing.length, insert },
      selection: EditorSelection.cursor(caret),
      userEvent: 'input.suggest',
      scrollIntoView: true,
    });
  } else if (edit.kind === 'wrap') {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `${edit.open}${selected}${edit.close}`;
    const caret =
      selected === ''
        ? range.from + edit.open.length
        : range.from + insert.length - (edit.caret ?? 0);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert },
      selection: EditorSelection.cursor(caret),
      userEvent: 'input.suggest',
      scrollIntoView: true,
    });
  } else {
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: edit.text },
      selection: EditorSelection.cursor(range.from + (edit.caret ?? edit.text.length)),
      userEvent: 'input.suggest',
      scrollIntoView: true,
    });
  }

  view.focus();
}

export function SuggestionBar({
  view,
  context,
}: {
  view: EditorView | null;
  context: SuggestContext | null;
}) {
  const [hidden, setHidden] = useState(false);
  const suggestions: Suggestion[] = useMemo(() => (context ? suggest(context) : []), [context]);

  if (!view) return null;

  if (hidden) {
    return (
      <div className="suggest is-collapsed">
        <button type="button" className="link-button" onClick={() => setHidden(false)}>
          Show suggestions
        </button>
      </div>
    );
  }

  return (
    <div className="suggest" role="toolbar" aria-label="Markdown suggestions">
      <div className="suggest-chips">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.id}
            type="button"
            className="chip"
            title={suggestion.title}
            // The editor must not lose its selection to the button, or a wrap
            // would have nothing left to wrap by the time the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(view, suggestion.edit)}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="suggest-hide"
        aria-label="Hide suggestions"
        title="Hide suggestions"
        onClick={() => setHidden(true)}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path
            d="M1.2 1.2 9.8 9.8M9.8 1.2 1.2 9.8"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
