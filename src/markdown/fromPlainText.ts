/**
 * Turn plain text into markdown.
 *
 * This is the inverse of `plaintext.ts`, and it follows the same rule read
 * backwards: **punctuation comes back, words stay.** Nothing is reworded,
 * nothing is reordered, nothing is dropped — the only thing added is the markup
 * that plain text had no way to carry.
 *
 * What it recovers is what plain text actually encodes: a shouted or underlined
 * line is a heading, an indented run of bullets is a nested list, four spaces
 * mean code, `a | b` rows are a table, a URL in brackets after a phrase is that
 * phrase's link. What plain text does *not* encode — which words were bold, what
 * level a heading was — is not guessed at. Inventing emphasis would be writing,
 * and this only punctuates.
 *
 * Every pass is a pure function over a string, and the app applies the result to
 * the editor buffer rather than to disk, so a conversion is reviewable and
 * undoable — the same contract as `repair.ts`.
 */

export type ConversionId =
  | 'headings'
  | 'lists'
  | 'tasks'
  | 'quotes'
  | 'code'
  | 'tables'
  | 'links'
  | 'rules'
  | 'reflow';

export interface ConversionChange {
  id: ConversionId;
  label: string;
}

export interface ConversionResult {
  text: string;
  changes: ConversionChange[];
}

/** The order changes are listed in, which is roughly the order a reader meets them. */
const ORDER: ConversionId[] = [
  'headings',
  'lists',
  'tasks',
  'quotes',
  'code',
  'tables',
  'links',
  'rules',
  'reflow',
];

const LABELS: Record<ConversionId, string> = {
  headings: 'marked the headings with #',
  lists: 'rebuilt the bullets and numbering as markdown lists',
  tasks: 'turned the checkboxes into task list items',
  quotes: 'marked the quoted lines with >',
  code: 'fenced the indented blocks as code',
  tables: 'rebuilt the pipe-separated rows as a table',
  links: 'linked the URLs written after their labels',
  rules: 'turned the dividers into ---',
  reflow: 'joined hard-wrapped lines back into paragraphs',
};

/* -------------------------------------------------------------------------- */
/* Line shapes                                                                */
/* -------------------------------------------------------------------------- */

/** Every bullet plain text uses, including the ones `plaintext.ts` writes. */
const BULLET = /^([ \t]*)([-*+•◦▪▫‣⁃·])[ \t]+(.*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]+(.*)$/;
const QUOTE = /^[ \t]*>[ \t]?(.*)$/;
const INDENTED = /^ {4,}\S/;
/** A divider: dashes, box-drawing, underscores or stars, three or more. */
const RULE = /^[ \t]*(?:[-–—_=*─━][ \t]*){3,}$/;
const SETEXT = /^[ \t]*(=+|-+)[ \t]*$/;
const CHECKBOX = /^(?:\[([ xX])\]|([☐☑✓✔]))[ \t]+(.*)$/;
/** A checkbox standing in for a bullet, which is how plain text writes a to-do. */
const TASK = /^([ \t]*)(?:\[[ xX]\]|[☐☑✓✔])[ \t]+.*$/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** A separator row means the rows around it are already a markdown table. */
const SEPARATOR_ROW = /^[ \t]*\|?(?:[ \t]*:?-{2,}:?[ \t]*\|)+[ \t]*:?-{2,}:?[ \t]*\|?[ \t]*$/;

// Same convention as repair.ts: NUL cannot occur in a text file, so a mask can
// never collide with something the author actually wrote.
const MASK_OPEN = '\u0000MM';
const MASK_CLOSE = '\u0000';
const MASK_PATTERN = /\u0000MM(\d+)\u0000/g;

const isMasked = (text: string) => text.includes('\u0000');

/* -------------------------------------------------------------------------- */
/* Masking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Code is the one place where indentation, pipes and shouting are content
 * rather than shape, so fences and inline spans are lifted out before any line
 * is classified. A masked fence becomes a line of its own, which survives the
 * blank-line block split intact.
 */
function mask(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const masked = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, (block) => {
    blocks.push(block);
    return `${MASK_OPEN}${blocks.length - 1}${MASK_CLOSE}`;
  });
  return { text: masked, blocks };
}

function unmask(text: string, blocks: string[]): string {
  return text.replace(MASK_PATTERN, (_, index: string) => blocks[Number(index)] ?? '');
}

/* -------------------------------------------------------------------------- */
/* Links                                                                      */
/* -------------------------------------------------------------------------- */

const URL_IN_BRACKETS = /\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
/** Where a label may begin: after a sentence end, or at the start of the line. */
const LABEL_BOUNDARY = /[.!?:;…][ \t]+/g;
const LEADING_MARKER = /^[ \t]*(?:[-*+•◦▪▫‣⁃·]|\d{1,9}[.)]|>)?[ \t]*/;

/**
 * `label (https://example.com)` is how `plaintext.ts` writes a link where
 * nothing is clickable, and how people write one by hand too. Turning it back
 * needs a guess at where the label starts, so the guess is bounded: back to the
 * last sentence end or the start of the line, and only when what that yields is
 * short enough to plausibly be link text. Anything else keeps its brackets.
 */
function linkify(text: string): string {
  let out = '';
  let cursor = 0;

  for (const match of text.matchAll(URL_IN_BRACKETS)) {
    const at = match.index ?? 0;
    if (at < cursor) continue;

    const before = text.slice(cursor, at);
    const head = before.replace(/[ \t]+$/, '');
    // No space in front of the bracket means this is not `label (url)`. It may
    // be the target half of a markdown link, which must be left exactly as is.
    if (head === before || head === '') continue;

    let start = head.lastIndexOf('\n') + 1;
    for (const boundary of head.slice(start).matchAll(LABEL_BOUNDARY)) {
      start += (boundary.index ?? 0) + boundary[0].length;
    }

    const run = head.slice(start);
    const marker = LEADING_MARKER.exec(run)?.[0] ?? '';
    const label = run.slice(marker.length);

    if (label === '' || label.length > 60 || /[()[\]]|\u0000/.test(label)) continue;

    out += `${head.slice(0, start)}${marker}[${label}](${match[1]})`;
    cursor = at + match[0].length;
  }

  return cursor === 0 ? text : out + text.slice(cursor);
}


/* -------------------------------------------------------------------------- */
/* Classification                                                             */
/* -------------------------------------------------------------------------- */

type Kind = 'item' | 'quote' | 'row' | 'code' | 'rule' | 'prose';

/** What a converted run produced, and what it would like that called. */
interface Converted {
  blocks: string[];
  /** Indexes within `blocks` of headings this pass created, not ones it found. */
  headings: number[];
  /** Names for what it did, applied only if the text actually changed. */
  ids: ConversionId[];
}

function indentWidth(indent: string): number {
  return [...indent].reduce((total, char) => total + (char === '\t' ? 4 : 1), 0);
}

/** The cells of a pipe-separated row, or null when the line is not one. */
function cells(line: string): string[] | null {
  if (!line.includes('|') || isMasked(line)) return null;
  const parts = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  if (parts.length < 2 || parts.every((cell) => cell === '')) return null;
  return parts;
}

function kindOf(line: string): Kind {
  if (isMasked(line)) return 'prose';
  // A divider wins over a bullet: `- - -` is a thematic break in markdown too.
  if (RULE.test(line)) return 'rule';
  if (BULLET.test(line) || ORDERED.test(line) || TASK.test(line)) return 'item';
  if (QUOTE.test(line)) return 'quote';
  if (INDENTED.test(line)) return 'code';
  if (cells(line) !== null) return 'row';
  return 'prose';
}

interface Run {
  kind: Kind;
  lines: string[];
}

function toRuns(lines: string[]): Run[] {
  const runs: Run[] = [];

  for (const line of lines) {
    const last = runs[runs.length - 1];
    let kind = kindOf(line);
    // A line merely more indented than the item above it is that item's
    // continuation, not a block of its own — including one indented far enough
    // that it would otherwise read as code.
    if (last?.kind === 'item' && kind !== 'item' && /^[ \t]/.test(line)) kind = 'item';
    // Each divider stands alone; everything else runs on.
    if (last && last.kind === kind && kind !== 'rule') last.lines.push(line);
    else runs.push({ kind, lines: [line] });
  }

  return runs;
}

/* -------------------------------------------------------------------------- */
/* Headings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A line in capitals with nothing lowercase in it. This is the one heading
 * plain text carries unambiguously, and it is the one `plaintext.ts` writes —
 * capitals work in every script, including Cyrillic, where Unicode has no bold
 * form at all.
 *
 * The case is left exactly as it stands. Sentence-casing it back would read
 * better, and would also turn API into Api; words stay.
 */
function isShout(line: string): boolean {
  const text = line.trim().replace(/:$/, '');
  if (text.length < 3 || text.length > 80 || isMasked(text)) return false;
  if (!/\p{Lu}/u.test(text) || /\p{Ll}/u.test(text)) return false;
  return !/[.!?,;]$/.test(text);
}

/** `Title` over `=====` or `-----`: markdown's own setext form, spelled out. */
function liftSetext(lines: string[], note: (id: ConversionId) => void): string[] {
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const under = SETEXT.exec(lines[index + 1] ?? '');
    if (under && line.trim() !== '' && !isMasked(line) && kindOf(line) === 'prose') {
      out.push(`${under[1]?.startsWith('=') ? '#' : '##'} ${line.trim()}`);
      note('headings');
      index += 1;
      continue;
    }
    out.push(line);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Paragraphs                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Text pasted from a mail client, a PDF or a terminal arrives wrapped at a
 * fixed column. Markdown renders that as one paragraph either way, but it is
 * miserable to edit. Joining is only safe where the block is *evidently*
 * wrapped — every line but the last inside a narrow band of widths, and most of
 * them stopping mid-sentence — so a poem, an address or a list of names is left
 * exactly as it was.
 */
function isHardWrapped(lines: string[]): boolean {
  if (lines.length < 3) return false;
  const body = lines.slice(0, -1);
  if (body.some((line) => line.length < 30 || line.length > 100)) return false;
  const unfinished = body.filter((line) => !/[.!?:;"'”’»)\]]$/.test(line)).length;
  return unfinished * 2 >= body.length;
}

function reflow(lines: string[]): string {
  return lines.reduce((joined, line) => {
    const next = line.trim();
    if (joined === '') return next;
    // A word broken across the break keeps its hyphen: dropping it would mend
    // the PDF case and maim `well-known` in the same stroke.
    return joined.endsWith('-') ? joined + next : `${joined} ${next}`;
  }, '');
}

function convertProse(lines: string[]): Converted {
  const blocks: string[] = [];
  const headings: number[] = [];
  const ids = new Set<ConversionId>();
  let buffer: string[] = [];

  const link = (text: string) => {
    const linked = linkify(text);
    if (linked !== text) ids.add('links');
    return linked;
  };

  const flush = () => {
    if (buffer.length === 0) return;
    if (isHardWrapped(buffer)) {
      blocks.push(link(reflow(buffer)));
      ids.add('reflow');
    } else {
      blocks.push(buffer.map(link).join('\n'));
    }
    buffer = [];
  };

  for (const line of lines) {
    if (!isShout(line)) {
      buffer.push(line);
      continue;
    }
    flush();
    headings.push(blocks.length);
    // Level two for now. The first heading in the document is promoted to one
    // during assembly, once it is clear it opens the note rather than sitting
    // inside it.
    blocks.push(`## ${line.trim().replace(/:$/, '')}`);
    ids.add('headings');
  }

  flush();
  return { blocks, headings, ids: [...ids] };
}

/* -------------------------------------------------------------------------- */
/* Lists, quotes, code and tables                                             */
/* -------------------------------------------------------------------------- */

/** `[ ]`, `[x]` or a ballot glyph at the head of an item's text. */
function checkbox(text: string): { done: boolean; rest: string } | null {
  const match = CHECKBOX.exec(text);
  if (!match) return null;
  return {
    done: match[1]?.toLowerCase() === 'x' || /[☑✓✔]/.test(match[2] ?? ''),
    rest: match[3] ?? '',
  };
}

function convertList(lines: string[]): Converted {
  // Indentation is the only record of nesting that plain text keeps, and the
  // widths it uses depend on how wide the bullets were. Ranking the widths that
  // actually occur recovers the levels whatever the original spacing was.
  const widths = new Set<number>();
  for (const line of lines) {
    const match = BULLET.exec(line) ?? ORDERED.exec(line) ?? TASK.exec(line);
    if (match) widths.add(indentWidth(match[1] ?? ''));
  }
  const levels = [...widths].sort((a, b) => a - b);

  const ids = new Set<ConversionId>(['lists']);
  const out: string[] = [];
  let depth = 0;

  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const task = (bullet ?? ordered) ? null : TASK.exec(line);
    const match = bullet ?? ordered ?? task;

    if (!match) {
      // A continuation line, aligned under the text of the item above it.
      out.push(`${'  '.repeat(depth + 1)}${line.trim()}`);
      continue;
    }

    depth = Math.max(0, levels.indexOf(indentWidth(match[1] ?? '')));
    const indent = '  '.repeat(depth);
    // A bare `[ ] milk` and a bulleted `- [ ] milk` are the same item written
    // two ways, so both are read from the text that follows the indent.
    const raw = task ? line.trim() : (match[3] ?? '');
    const content = linkify(raw);
    if (content !== raw) ids.add('links');

    // A numbered item keeps its number: `1. [ ] thing` is still an ordered list.
    const box = ordered ? null : checkbox(content);
    if (box) {
      out.push(`${indent}- [${box.done ? 'x' : ' '}] ${box.rest}`);
      ids.add('tasks');
      continue;
    }

    out.push(`${indent}${ordered ? `${ordered[2]}. ` : '- '}${content}`);
  }

  return { blocks: [out.join('\n')], headings: [], ids: [...ids] };
}

function convertQuote(lines: string[]): Converted {
  const ids = new Set<ConversionId>(['quotes']);
  const blocks = lines.map((line) => {
    const body = QUOTE.exec(line)?.[1] ?? line.trim();
    const linked = linkify(body);
    if (linked !== body) ids.add('links');
    return linked === '' ? '>' : `> ${linked}`;
  });
  return { blocks: [blocks.join('\n')], headings: [], ids: [...ids] };
}

function convertCode(lines: string[]): Converted {
  const indent = Math.min(...lines.map((line) => /^ */.exec(line)?.[0].length ?? 0));
  return {
    blocks: [['```', ...lines.map((line) => line.slice(indent)), '```'].join('\n')],
    headings: [],
    ids: ['code'],
  };
}

function convertTable(lines: string[]): Converted {
  const plain = (): Converted => ({ blocks: [lines.join('\n')], headings: [], ids: [] });

  // Two rows is the least that can be told from a sentence with a pipe in it,
  // and a separator row means this is a markdown table already.
  if (lines.length < 2) return plain();
  if (lines.some((line) => SEPARATOR_ROW.test(line))) return plain();

  const rows = lines.map((line) => cells(line) ?? [line]);
  const width = Math.max(...rows.map((row) => row.length));
  const render = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => linkify(row[index] ?? '')).join(' | ')} |`;

  const [header, ...rest] = rows;
  return {
    blocks: [
      [
        render(header ?? []),
        `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
        ...rest.map(render),
      ].join('\n'),
    ],
    headings: [],
    ids: ['tables'],
  };
}

function convertRun(run: Run): Converted {
  switch (run.kind) {
    case 'item':
      return convertList(run.lines);
    case 'quote':
      return convertQuote(run.lines);
    case 'code':
      return convertCode(run.lines);
    case 'row':
      return convertTable(run.lines);
    case 'rule':
      return { blocks: ['---'], headings: [], ids: ['rules'] };
    default:
      return convertProse(run.lines);
  }
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

export function toMarkdown(source: string): ConversionResult {
  const found = new Set<ConversionId>();
  const note = (id: ConversionId) => found.add(id);

  // Frontmatter is data, not prose, and none of these passes should touch it.
  const frontmatter = FRONTMATTER.exec(source)?.[0] ?? '';
  const masked = mask(
    source
      .slice(frontmatter.length)
      .replace(/\r\n?/g, '\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, ''),
  );

  const lines = liftSetext(
    // Two trailing spaces are a hard line break in markdown; anything else is lint.
    masked.text
      .split('\n')
      .map((line) => (line.endsWith('  ') ? `${line.trimEnd()}  ` : line.trimEnd())),
    note,
  );

  const out: string[] = [];
  const headings: number[] = [];

  for (const block of lines.join('\n').split(/\n{2,}/)) {
    if (block.trim() === '') continue;
    for (const run of toRuns(block.split('\n'))) {
      const converted = convertRun(run);
      // Naming a change the text does not actually contain would offer someone a
      // conversion that does nothing, so each name has to be earned.
      if (converted.blocks.join('\n\n') !== run.lines.join('\n')) {
        for (const id of converted.ids) note(id);
      }
      for (const offset of converted.headings) headings.push(out.length + offset);
      out.push(...converted.blocks);
    }
  }

  // A shouted heading opening the note is its title, not one of its sections.
  const first = out[0];
  if (headings[0] === 0 && first !== undefined) out[0] = `#${first.slice(2)}`;

  const changes = [...found]
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
    .map((id) => ({ id, label: LABELS[id] }));

  // Nothing worth naming means no edit at all: the offer to convert is made on
  // the strength of this list, so an unnamed rewrite must never slip through.
  if (changes.length === 0) return { text: source, changes: [] };

  const text = `${frontmatter}${unmask(out.join('\n\n'), masked.blocks)}\n`;
  return text === source ? { text: source, changes: [] } : { text, changes };
}

/* -------------------------------------------------------------------------- */
/* Is this markdown already?                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Markers plain text does not produce by accident. Bullets and numbering are
 * deliberately absent: `- one` is how anyone writes a list in a plain mail, so
 * it says nothing about whether markdown was meant.
 */
const MARKDOWN_SIGNALS = [
  /^#{1,6}[ \t]+\S/m,
  /^[ \t]*(```|~~~)/m,
  /\[[^\]\n]+\]\([^)\s]*\)/,
  /\*\*[^*\n]+\*\*/,
  /`[^`\n]+`/,
  /^[ \t]*>[ \t]+\S/m,
  /^[ \t]*\|.*\|[ \t]*$/m,
];

/** Two independent markers: enough to say this was written as markdown already. */
export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_SIGNALS.filter((signal) => signal.test(text)).length >= 2;
}
