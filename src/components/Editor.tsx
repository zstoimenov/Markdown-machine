import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { FORMATTING_KEYMAP } from '../markdown/commands';
import { looksLikeMarkdown, toMarkdown, type ConversionChange } from '../markdown/fromPlainText';
import type { SuggestContext } from '../markdown/suggest';
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

/** A paste that arrived as plain text and could be read as markdown instead. */
export interface PasteOffer {
  from: number;
  to: number;
  changes: ConversionChange[];
}

/**
 * Whether the cursor is in code, and whether the fence around it is still open.
 * Read from the syntax tree rather than by counting fences up the document: the
 * tree is already built and already knows, and this runs on every keystroke.
 */
function codeAt(state: EditorState, at: number): { inCode: boolean; fenceOpen: boolean } {
  // Derived rather than imported: @lezer/common arrives under @codemirror/language
  // and is not a dependency this app declares for itself.
  type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;
  let node: Node | null = syntaxTree(state).resolveInner(at, -1);
  let inCode = false;

  while (node) {
    if (node.name === 'FencedCode') {
      // An unclosed fence runs to the end of the document, so what marks it as
      // open is the absence of a closing fence on its last line.
      const text = state.sliceDoc(node.from, node.to);
      return { inCode: true, fenceOpen: !/\n[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*$/.test(text) };
    }
    if (node.name === 'CodeBlock' || node.name === 'CodeText' || node.name === 'InlineCode') {
      inCode = true;
    }
    node = node.parent;
  }

  return { inCode, fenceOpen: false };
}

function readContext(state: EditorState): SuggestContext {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  return {
    line: line.text,
    col: range.head - line.from,
    selection: state.sliceDoc(range.from, range.to),
    previous: line.number > 1 ? state.doc.line(line.number - 1).text : null,
    ...codeAt(state, range.head),
  };
}

/** Below this, a paste is a fragment rather than a document to make sense of. */
const WORTH_CONVERTING = 24;

interface EditorProps {
  /** Initial document. Remount (via `key`) to load a different file. */
  initialDoc: string;
  onChange: (value: string) => void;
  onViewReady: (view: EditorView | null) => void;
  /** Where the cursor is and what surrounds it, for the suggestion row. */
  onContext: (context: SuggestContext) => void;
  /** A plain-text paste worth offering to convert, or null once it is stale. */
  onPaste: (offer: PasteOffer | null) => void;
}

export function Editor({ initialDoc, onChange, onViewReady, onContext, onPaste }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Held in refs so that changing them never tears down and rebuilds the editor,
  // which would drop the cursor, the selection and the undo history on every keystroke.
  const onChangeRef = useRef(onChange);
  const onViewReadyRef = useRef(onViewReady);
  const onContextRef = useRef(onContext);
  const onPasteRef = useRef(onPaste);
  onChangeRef.current = onChange;
  onViewReadyRef.current = onViewReady;
  onContextRef.current = onContext;
  onPasteRef.current = onPaste;

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
          /**
           * Pasted text is inserted exactly as it arrived and never rewritten on
           * the way in — a paste that silently changed what was on the clipboard
           * would be the single most alarming thing this app could do. What the
           * paste does is take the insert over so the range it landed in is
           * known, which is what lets the offer act on it afterwards.
           */
          EditorView.domEventHandlers({
            paste(event, target) {
              const clipboard = event.clipboardData?.getData('text/plain') ?? '';
              const text = clipboard.replace(/\r\n?/g, '\n');
              if (text.length < WORTH_CONVERTING) return false;
              // Multiple cursors spread a paste across the document in ways
              // CodeMirror handles and a single range cannot describe.
              if (target.state.selection.ranges.length > 1) return false;
              if (looksLikeMarkdown(text)) return false;
              const { changes } = toMarkdown(text);
              if (changes.length === 0) return false;

              event.preventDefault();
              const from = target.state.selection.main.from;
              target.dispatch(target.state.replaceSelection(text), {
                userEvent: 'input.paste',
                scrollIntoView: true,
              });
              onPasteRef.current({ from, to: from + text.length, changes });
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            // The offer is about one particular paste sitting in one particular
            // range. The next edit anywhere invalidates both, so it goes.
            if (
              update.docChanged &&
              !update.transactions.some((transaction) => transaction.isUserEvent('input.paste'))
            ) {
              onPasteRef.current(null);
            }
            if (update.docChanged || update.selectionSet || update.focusChanged) {
              onContextRef.current(readContext(update.state));
            }
          }),
        ],
      }),
    });

    onViewReadyRef.current(view);
    onContextRef.current(readContext(view.state));
    return () => {
      onViewReadyRef.current(null);
      onPasteRef.current(null);
      view.destroy();
    };
    // initialDoc is intentionally not a dependency: the file identity is carried by
    // the `key` on this component, so a new file means a new instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="editor" ref={hostRef} />;
}
