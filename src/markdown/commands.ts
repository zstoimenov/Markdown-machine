import { EditorSelection, type ChangeSpec, type StateCommand } from '@codemirror/state';

/**
 * Editing commands for markdown source.
 *
 * Key choice is constrained by the browser: Mod-1…Mod-9 switch browser tabs and
 * cannot be intercepted from a page, so the heading control is a cycle on one
 * chord rather than a level per digit as most desktop editors do it.
 */

const HEADING = /^(#{1,6})\s+/;
const BULLET = /^(\s*)([-*+])\s+/;
const URL_LIKE = /^(https?:\/\/|mailto:|\/|\.{0,2}\/)\S*$/i;

/**
 * Wrap or unwrap the selection with a marker. Markers are recognised both
 * outside the selection (the usual case after a previous toggle) and inside it
 * (when someone has selected the marks along with the text).
 */
function toggleWrap(marker: string): StateCommand {
  const width = marker.length;
  return ({ state, dispatch }) => {
    const transaction = state.changeByRange((range) => {
      const before = state.sliceDoc(Math.max(0, range.from - width), range.from);
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + width));

      // `*` must not tear the inner half off a `**` pair and leave broken syntax.
      const wouldSplitBold =
        marker === '*' && state.sliceDoc(Math.max(0, range.from - 2), range.from) === '**';

      if (before === marker && after === marker && !wouldSplitBold) {
        return {
          changes: [
            { from: range.from - width, to: range.from },
            { from: range.to, to: range.to + width },
          ],
          range: EditorSelection.range(range.from - width, range.to - width),
        };
      }

      const text = state.sliceDoc(range.from, range.to);
      if (text.length >= width * 2 && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: [
            { from: range.from, to: range.from + width },
            { from: range.to - width, to: range.to },
          ],
          range: EditorSelection.range(range.from, range.to - width * 2),
        };
      }

      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        // An empty selection leaves the cursor between the two new markers.
        range: EditorSelection.range(range.from + width, range.to + width),
      };
    });

    dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

export const toggleBold = toggleWrap('**');
export const toggleItalic = toggleWrap('*');
export const toggleInlineCode = toggleWrap('`');

/** Link the selection, putting the cursor wherever the missing half belongs. */
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const transaction = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);

    if (text.length > 0 && URL_LIKE.test(text)) {
      // A selected URL becomes the target, and the cursor waits in the label.
      return {
        changes: { from: range.from, to: range.to, insert: `[](${text})` },
        range: EditorSelection.cursor(range.from + 1),
      };
    }

    return {
      changes: { from: range.from, to: range.to, insert: `[${text}]()` },
      range: EditorSelection.cursor(range.from + text.length + 3),
    };
  });

  dispatch(state.update(transaction, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
};

/** Every line touched by the selection, each visited once. */
function selectedLines(state: Parameters<StateCommand>[0]['state']): number[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n += 1) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

/** Cycle the selected lines: body text → `#` → `##` → `###` → body text. */
export const cycleHeading: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  const first = lines[0];
  if (first === undefined) return false;

  // One level for the whole selection, taken from its first line, so a mixed
  // selection converges instead of each line cycling independently.
  const existing = HEADING.exec(state.doc.line(first).text)?.[1]?.length ?? 0;
  const next = existing >= 3 ? 0 : existing + 1;
  const prefix = next === 0 ? '' : `${'#'.repeat(next)} `;

  const changes: ChangeSpec[] = [];
  for (const number of lines) {
    const line = state.doc.line(number);
    const match = HEADING.exec(line.text);
    changes.push({ from: line.from, to: line.from + (match?.[0]?.length ?? 0), insert: prefix });
  }

  dispatch(state.update({ changes, userEvent: 'input.format' }));
  return true;
};

/** Toggle `- ` on the selected lines; removes only if every line already has it. */
export const toggleBulletList: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state);
  if (lines.length === 0) return false;

  const bodies = lines.map((number) => state.doc.line(number));
  const allBulleted = bodies.every((line) => BULLET.test(line.text));

  const changes: ChangeSpec[] = bodies.map((line) => {
    const match = BULLET.exec(line.text);
    if (allBulleted && match) {
      const indent = match[1] ?? '';
      return { from: line.from + indent.length, to: line.from + match[0].length, insert: '' };
    }
    // Blank lines are left alone rather than becoming empty bullets.
    if (line.text.trim() === '') return { from: line.from, to: line.from, insert: '' };
    const indent = /^\s*/.exec(line.text)?.[0] ?? '';
    return { from: line.from + indent.length, to: line.from + indent.length, insert: '- ' };
  });

  dispatch(state.update({ changes, userEvent: 'input.format' }));
  return true;
};

export const FORMATTING_KEYMAP = [
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
  { key: 'Mod-e', run: toggleInlineCode },
  { key: 'Mod-k', run: insertLink },
  { key: 'Mod-Shift-h', run: cycleHeading },
  { key: 'Mod-Shift-l', run: toggleBulletList },
];
