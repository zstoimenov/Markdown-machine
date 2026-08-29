import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { FORMATTING_KEYMAP } from '../markdown/commands';
import { tags } from '@lezer/highlight';

/**
 * Colours come from the same CSS custom properties as the rest of the app, so the
 * editor follows the OS light/dark switch for free — no second theme to keep in
 * sync, and no reconfiguration when the system preference changes.
 */
const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: '13.5px',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': { padding: '24px 20px 60vh', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 2px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--bg-panel)' },
});

const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--syn-title)', fontWeight: '600' },
  { tag: tags.strong, color: 'var(--text)', fontWeight: '600' },
  { tag: tags.emphasis, color: 'var(--text)', fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--accent)' },
  { tag: tags.url, color: 'var(--text-faint)' },
  { tag: tags.monospace, color: 'var(--syn-string)' },
  { tag: tags.quote, color: 'var(--text-muted)', fontStyle: 'italic' },
  { tag: tags.list, color: 'var(--syn-keyword)' },
  // The syntax characters themselves — #, *, -, ``` — recede behind the prose.
  { tag: tags.processingInstruction, color: 'var(--text-faint)' },
  { tag: tags.contentSeparator, color: 'var(--text-faint)' },
]);

interface EditorProps {
  /** Initial document. Remount (via `key`) to load a different file. */
  initialDoc: string;
  onChange: (value: string) => void;
  onViewReady: (view: EditorView | null) => void;
}

export function Editor({ initialDoc, onChange, onViewReady }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in refs so that changing them never tears down and rebuilds the editor,
  // which would drop the cursor, the selection and the undo history on every keystroke.
  const onChangeRef = useRef(onChange);
  const onViewReadyRef = useRef(onViewReady);
  onChangeRef.current = onChange;
  onViewReadyRef.current = onViewReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          // Formatting comes first so its bindings win over any default sharing a chord.
          keymap.of([...FORMATTING_KEYMAP, ...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          syntaxHighlighting(highlightStyle),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });

    onViewReadyRef.current(view);
    return () => {
      onViewReadyRef.current(null);
      view.destroy();
    };
    // initialDoc is intentionally not a dependency: the file identity is carried by
    // the `key` on this component, so a new file means a new instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="editor" ref={hostRef} />;
}
