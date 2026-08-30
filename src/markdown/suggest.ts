import { toMarkdown } from './fromPlainText.ts';

/**
 * What to offer someone as they type.
 *
 * Markdown's markers come in pairs and in prefixes, and both halves are easy to
 * forget: the closing `**`, the `](` after a label, the `|---|` row that turns
 * three lines of pipes into a table. This works out, from where the cursor
 * actually is, which markers would be legal and useful next — closing what is
 * open first, because an unclosed marker is the one mistake that changes how
 * everything after it renders.
 *
 * It is a pure function of a small context, which is the point: the rules are
 * readable and testable on their own, and the editor only has to know how to
 * apply three shapes of edit.
 */

export interface SuggestContext {
  /** The whole line the cursor is on. */
  line: string;
  /** Where the cursor sits within it, counted in characters. */
  col: number;
  /** The selected text, or `''` when the selection is empty. */
  selection: string;
  /** The line above, or null at the top of the document. */
  previous: string | null;
  /** The cursor is inside code, where markdown markers are not markup. */
  inCode: boolean;
  /** A fence is open above the cursor and nothing has closed it. */
  fenceOpen: boolean;
}

export type SuggestionEdit =
  /** Replace the selection with `text`; the caret lands `caret` in, or at the end. */
  | { kind: 'insert'; text: string; caret?: number }
  /**
   * Put `open` before the selection and `close` after it. With an empty
   * selection the caret waits between the two, which is how a marker is started
   * rather than applied; with a selection it lands `caret` characters back from
   * the end, so a link can leave the cursor inside its brackets.
   */
  | { kind: 'wrap'; open: string; close: string; caret?: number }
  /** Replace whatever block marker the line starts with, keeping its indent. */
  | { kind: 'prefix'; text: string };

export interface Suggestion {
  id: string;
  /** What the chip says. Short enough to read at a glance on a phone. */
  label: string;
  /** What it will do, spelled out for the tooltip. */
  title: string;
  edit: SuggestionEdit;
}

/** More than this and the row stops being a glance and starts being a menu. */
const MAX = 6;

/** Whatever block marker a line opens with: heading, bullet, number or quote. */
export const BLOCK_PREFIX = /^([ \t]*)(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+|>[ \t]+)?/;

const ITEM = /^([ \t]*)(?:([-*+])|(\d{1,9})([.)]))[ \t]+(\[[ xX]\][ \t]+)?/;
const HEADING = /^[ \t]*(#{1,6})[ \t]+/;

/* -------------------------------------------------------------------------- */
/* Closing what is open                                                       */
/* -------------------------------------------------------------------------- */

const count = (text: string, marker: string) => text.split(marker).length - 1;

/**
 * Inline markers left open on the way to the cursor. Only the current line is
 * examined: markdown's inline markers do not span a blank line, and a stray
 * `*` three paragraphs up is not something to nag about here.
 */
function closers(head: string): Suggestion[] {
  const out: Suggestion[] = [];

  // A link is offered first: it is the marker with the most to remember, and
  // the only one whose two halves are different characters.
  const openLabel = count(head, '[') > count(head, ']');
  const openTarget = head.lastIndexOf('](') > head.lastIndexOf(')');

  if (openLabel) {
    out.push({
      id: 'close-label',
      label: '](url)',
      title: 'Close the label and start its target',
      edit: { kind: 'insert', text: ']()', caret: 2 },
    });
  } else if (openTarget) {
    out.push({
      id: 'close-target',
      label: ')',
      title: 'Close the link target',
      edit: { kind: 'insert', text: ')' },
    });
  }

  // Backticks first, since a marker inside code is not a marker at all.
  if (count(head, '`') % 2 === 1) {
    out.push({
      id: 'close-code',
      label: '`',
      title: 'Close the inline code span',
      edit: { kind: 'insert', text: '`' },
    });
    return out;
  }

  if (count(head, '**') % 2 === 1) {
    out.push({
      id: 'close-bold',
      label: '**',
      title: 'Close the bold you opened',
      edit: { kind: 'insert', text: '**' },
    });
  } else if (count(head.split('**').join(''), '*') % 2 === 1) {
    out.push({
      id: 'close-italic',
      label: '*',
      title: 'Close the italic you opened',
      edit: { kind: 'insert', text: '*' },
    });
  }

  if (count(head, '~~') % 2 === 1) {
    out.push({
      id: 'close-strike',
      label: '~~',
      title: 'Close the strikethrough you opened',
      edit: { kind: 'insert', text: '~~' },
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Inline markers                                                             */
/* -------------------------------------------------------------------------- */

function wraps(hasSelection: boolean): Suggestion[] {
  const around = hasSelection ? 'the selection' : 'what you type next';
  return [
    {
      id: 'bold',
      label: '**B**',
      title: `Bold ${around}`,
      edit: { kind: 'wrap', open: '**', close: '**' },
    },
    {
      id: 'italic',
      label: '*i*',
      title: `Italicise ${around}`,
      edit: { kind: 'wrap', open: '*', close: '*' },
    },
    {
      id: 'link',
      label: '[ ]( )',
      title: `Link ${around}`,
      edit: { kind: 'wrap', open: '[', close: ']()', caret: 1 },
    },
    {
      id: 'code',
      label: '`c`',
      title: `Mark ${around} as code`,
      edit: { kind: 'wrap', open: '`', close: '`' },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

const STARTERS: Suggestion[] = [
  {
    id: 'heading',
    label: '## Heading',
    title: 'Start a heading',
    edit: { kind: 'prefix', text: '## ' },
  },
  {
    id: 'bullet',
    label: '- List',
    title: 'Start a bullet list',
    edit: { kind: 'prefix', text: '- ' },
  },
  {
    id: 'numbered',
    label: '1. Numbered',
    title: 'Start a numbered list',
    edit: { kind: 'prefix', text: '1. ' },
  },
  {
    id: 'quote',
    label: '> Quote',
    title: 'Start a quotation',
    edit: { kind: 'prefix', text: '> ' },
  },
  {
    id: 'fence',
    label: '``` Code',
    title: 'Open a code block, with its closing fence already written',
    // Both fences at once: the closing one is the half that gets forgotten.
    edit: { kind: 'insert', text: '```\n\n```', caret: 4 },
  },
  {
    id: 'table',
    label: '| Table',
    title: 'Start a two-column table, header row and all',
    edit: { kind: 'insert', text: '|  |  |\n| --- | --- |\n|  |  |', caret: 2 },
  },
  {
    id: 'task',
    label: '- [ ] Task',
    title: 'Start a task list',
    edit: { kind: 'prefix', text: '- [ ] ' },
  },
  {
    id: 'rule',
    label: '---',
    title: 'Insert a divider',
    edit: { kind: 'insert', text: '---' },
  },
];

/**
 * The next item of the list the given line belongs to. `leading` is the newline
 * that starts it — empty when the cursor already sits on an empty line of its own.
 */
function nextItem(line: string, leading: string, title: string): Suggestion | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const [, indent = '', bullet, number, separator = '.', task] = match;
  const marker = bullet ? `${bullet} ` : `${Number(number) + 1}${separator} `;
  return {
    id: 'next-item',
    label: `${marker.trim()} Next item`,
    title,
    edit: { kind: 'insert', text: `${leading}${indent}${marker}${task ? '[ ] ' : ''}` },
  };
}

/** A row of `---` cells matching the row the cursor is in. */
function headerRule(line: string): Suggestion {
  const columns = Math.max(2, line.split('|').filter((cell) => cell.trim() !== '').length);
  return {
    id: 'header-rule',
    label: '|---|',
    title: 'Add the rule that makes the row above a header',
    edit: {
      kind: 'insert',
      text: `\n| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The rules                                                                  */
/* -------------------------------------------------------------------------- */

/** A selection worth running the plain-text conversion over, and not more. */
const CONVERTIBLE = 20_000;

export function suggest(ctx: SuggestContext): Suggestion[] {
  // Inside a fence there is exactly one useful thing to say, and it is the
  // thing people forget.
  if (ctx.fenceOpen) {
    return [
      {
        id: 'close-fence',
        label: '``` close',
        title: 'Close the code block',
        edit: { kind: 'insert', text: ctx.line.trim() === '' ? '```' : '\n```' },
      },
    ];
  }
  // Code that is already closed is code: no markdown applies inside it.
  if (ctx.inCode) return [];

  const out: Suggestion[] = [];
  const head = ctx.line.slice(0, ctx.col);
  const blank = ctx.line.trim() === '';

  if (ctx.selection !== '') {
    // Several lines of plain text under the cursor is the one moment where the
    // whole conversion is worth offering rather than a single marker.
    if (ctx.selection.includes('\n') && ctx.selection.length <= CONVERTIBLE) {
      const { text, changes } = toMarkdown(ctx.selection);
      if (changes.length > 0) {
        out.push({
          id: 'to-markdown',
          label: '→ Markdown',
          title: `Convert the selected plain text: ${changes.map((c) => c.label).join(', ')}`,
          edit: { kind: 'insert', text: text.replace(/\n$/, '') },
        });
      }
    }
    return [...out, ...wraps(true)].slice(0, MAX);
  }

  out.push(...closers(head));
  // An open code span swallows every marker after it, so closing it is the only
  // suggestion that would do anything.
  if (out.some((suggestion) => suggestion.id === 'close-code')) return out;

  const heading = HEADING.exec(ctx.line);
  const item = ITEM.exec(ctx.line);

  if (blank) {
    // Carrying a list on is likelier than starting a different kind of block.
    // The empty line is already there, so the item goes on it, not below it.
    const carry =
      ctx.previous === null
        ? null
        : nextItem(ctx.previous, '', 'Add another item to the list above');
    if (carry) out.push(carry);
    if (ctx.previous !== null && cellsIn(ctx.previous) >= 2) out.push(headerRule(ctx.previous));
    out.push(...STARTERS);
    return out.slice(0, MAX);
  }

  if (heading) {
    const level = heading[1]?.length ?? 1;
    if (level < 6) {
      out.push({
        id: 'deeper',
        label: `${'#'.repeat(level + 1)}`,
        title: 'Make this heading one level deeper',
        edit: { kind: 'prefix', text: `${'#'.repeat(level + 1)} ` },
      });
    }
    out.push({
      id: 'shallower',
      label: level > 1 ? '#'.repeat(level - 1) : 'Plain',
      title: level > 1 ? 'Make this heading one level shallower' : 'Turn this heading back into text',
      edit: { kind: 'prefix', text: level > 1 ? `${'#'.repeat(level - 1)} ` : '' },
    });
    return [...out, ...wraps(false).slice(0, 2)].slice(0, MAX);
  }

  if (item) {
    const next = nextItem(ctx.line, '\n', 'Start the next item');
    if (next) out.push(next);
    out.push({
      id: 'sub-item',
      label: '⇥ Sub-item',
      title: 'Start an item one level in',
      edit: { kind: 'insert', text: `\n${item[1] ?? ''}  ${item[2] ? `${item[2]} ` : '1. '}` },
    });
    if (!item[5]) {
      out.push({
        id: 'make-task',
        label: '[ ]',
        title: 'Turn this item into a checkbox',
        edit: { kind: 'prefix', text: `${item[2] ?? '-'} [ ] ` },
      });
    }
    return [...out, ...wraps(false).slice(0, 3)].slice(0, MAX);
  }

  if (cellsIn(ctx.line) >= 2) {
    out.push({
      id: 'cell',
      label: '|',
      title: 'Start another cell',
      edit: { kind: 'insert', text: ' | ' },
    });
    out.push(headerRule(ctx.line));
    return [...out, ...wraps(false).slice(0, 2)].slice(0, MAX);
  }

  // Ordinary prose: the inline markers, then the two ways to turn the line into
  // something else.
  out.push(...wraps(false));
  out.push(
    { ...(STARTERS[0] as Suggestion), title: 'Turn this line into a heading' },
    { ...(STARTERS[1] as Suggestion), title: 'Turn this line into a list item' },
  );
  return out.slice(0, MAX);
}

function cellsIn(line: string): number {
  if (!line.includes('|')) return 0;
  return line.split('|').filter((cell) => cell.trim() !== '').length;
}
