/**
 * Repair markdown that has been mangled by an LLM export.
 *
 * The failure mode this targets: a tool writes its transport envelope into the
 * file instead of the content it was carrying. The document arrives as a JSON
 * object, or with JSON fragments embedded in the prose, and with `\n` written
 * as two literal characters rather than a newline — so the whole note collapses
 * into one unbroken paragraph that no markdown renderer can make sense of.
 *
 * Everything here is a pure function over a string, and the app applies the
 * result to the editor buffer rather than to disk, so a repair is always
 * reviewable and always undoable.
 */

export type RepairId =
  | 'json-envelope'
  | 'escaped-newlines'
  | 'json-fragments'
  | 'single-blob'
  | 'spacing';

export interface RepairIssue {
  id: RepairId;
  label: string;
}

export interface RepairResult {
  text: string;
  applied: RepairIssue[];
}

const ISSUES: Record<RepairId, string> = {
  'json-envelope': 'unwrapped the JSON the note was buried in',
  'escaped-newlines': 'turned literal \\n into real line breaks',
  'json-fragments': 'removed JSON fragments left in the text',
  'single-blob': 'split one long blob back into markdown blocks',
  spacing: 'tidied blank lines around headings, lists and fences',
};

/* -------------------------------------------------------------------------- */
/* Masking                                                                    */
/* -------------------------------------------------------------------------- */

// NUL-delimited: it cannot occur in a text file, so masking can never collide
// with something the author actually wrote.
const MASK_OPEN = '\u0000MM';
const MASK_CLOSE = '\u0000';
const MASK_PATTERN = /\u0000MM(\d+)\u0000/g;

/**
 * Code is the one place where JSON fragments and odd spacing are the content
 * rather than the damage, so every structural pass runs with fences and inline
 * spans lifted out of the way.
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
/* JSON envelopes                                                             */
/* -------------------------------------------------------------------------- */

/** Keys that carry the payload in the shapes these exports actually use. */
const TEXT_KEYS = ['markdown', 'content', 'text', 'body', 'value', 'message', 'response'];

/** Keys that mark an object as transport metadata rather than content. */
const ENVELOPE_KEYS = ['type', 'role', 'index', 'id', 'model', 'delta', 'finish_reason'];

function extractText(node: unknown, depth = 0): string {
  if (depth > 12) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    return node
      .map((item) => extractText(item, depth + 1))
      .filter((part) => part.trim() !== '')
      .join('\n\n');
  }
  if (node === null || typeof node !== 'object') return '';

  const record = node as Record<string, unknown>;
  for (const key of TEXT_KEYS) {
    if (key in record) {
      const value = extractText(record[key], depth + 1);
      if (value.trim() !== '') return value;
    }
  }
  // No known carrier: the longest string in there is the best guess at content.
  const candidates = Object.values(record)
    .map((value) => extractText(value, depth + 1))
    .filter((part) => part.trim() !== '')
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? '';
}

function unwrapEnvelope(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const extracted = extractText(parsed);
  return extracted.trim() === '' ? null : extracted;
}

/* -------------------------------------------------------------------------- */
/* Escaped characters                                                         */
/* -------------------------------------------------------------------------- */

const ESCAPES: Record<string, string> = {
  n: '\n',
  r: '',
  t: '\t',
  '"': '"',
  "'": "'",
  '`': '`',
  '/': '/',
  '\\': '\\',
};

/**
 * Only unescape when the file is clearly written that way — many more literal
 * `\n` sequences than real line breaks. A normal note that happens to mention
 * `\n` once must come out untouched.
 */
function looksEscaped(text: string): boolean {
  const real = (text.match(/\n/g) ?? []).length;
  const literal = (text.match(/\\n/g) ?? []).length;
  return literal >= 3 && literal > real;
}

function unescape(text: string): string {
  // `\\` is matched first, so an escaped backslash consumes both characters and
  // a following `n` is left as an ordinary letter rather than becoming a newline.
  return text
    .replace(/\\(u[0-9a-fA-F]{4}|[\\nrt"'`/])/g, (match, code: string) => {
      if (code.startsWith('u')) return String.fromCharCode(parseInt(code.slice(1), 16));
      return ESCAPES[code] ?? match;
    })
    .replace(/\r\n?/g, '\n');
}

/* -------------------------------------------------------------------------- */
/* Embedded fragments                                                         */
/* -------------------------------------------------------------------------- */

/** Find the end of the JSON value starting at `start`, or -1 if unbalanced. */
function matchBrace(text: string, start: number): number {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Replace embedded JSON values with whatever prose they carried, or drop them
 * when they carried none. An object that parses but looks like real content —
 * no envelope keys, no extractable text — is left alone, since a note may
 * legitimately quote a small JSON object outside a code fence.
 */
function stripFragments(text: string): { text: string; changed: boolean } {
  let output = '';
  let index = 0;
  let changed = false;

  while (index < text.length) {
    const next = text.indexOf('{"', index);
    if (next === -1) {
      output += text.slice(index);
      break;
    }

    const end = matchBrace(text, next);
    if (end === -1) {
      output += text.slice(index);
      break;
    }

    const candidate = text.slice(next, end);
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // Not actually JSON — copy the brace through and keep scanning past it.
      output += text.slice(index, next + 1);
      index = next + 1;
      continue;
    }

    const record = (parsed ?? {}) as Record<string, unknown>;
    const isEnvelope = ENVELOPE_KEYS.some((key) => key in record);
    const carried = extractText(parsed);

    if (!isEnvelope && carried.trim() === '') {
      // A plain data object the author meant to include.
      output += text.slice(index, end);
    } else {
      output += text.slice(index, next) + carried;
      changed = true;
    }
    index = end;
  }

  // Streaming leftovers: `data:` and `event:` lines whose payload is now gone.
  const cleaned = output
    .replace(/^[ \t]*data:[ \t]*(\[DONE\])?[ \t]*$/gm, '')
    .replace(/^[ \t]*event:[ \t]*\w+[ \t]*$/gm, '');

  return { text: cleaned, changed: changed || cleaned !== output };
}

/* -------------------------------------------------------------------------- */
/* Reblocking                                                                 */
/* -------------------------------------------------------------------------- */

function longestLine(text: string): number {
  return text.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
}

/** One paragraph where a structured document should be. */
function isBlob(text: string): boolean {
  return longestLine(text) > 400;
}

/**
 * Put markdown block markers back onto their own lines. Only runs on documents
 * that are already one long line, where a bare ` - ` is far more likely to be a
 * flattened list item than a dash in a sentence.
 *
 * Known limit: where a heading's title ends and its body begins is not
 * recoverable once the newline between them is gone — `## Notes Body text here`
 * reads identically either way — so the heading keeps the whole run. Splitting
 * on a guess would be worse than leaving a line for a person to break. This is
 * why a repair goes to the editor buffer for review rather than to disk.
 */
function reblock(text: string): string {
  return (
    text
      // Fences first, so the markers below do not fire inside what becomes code.
      .replace(/[ \t]*(```+|~~~+)[ \t]*/g, '\n$1')
      .replace(/(\S)[ \t]*(#{1,6})[ \t]+/g, '$1\n\n$2 ')
      .replace(/(\S)[ \t]+([-*+])[ \t]+(?=\S)/g, '$1\n$2 ')
      .replace(/(\S)[ \t]+(\d{1,3}\.)[ \t]+(?=\S)/g, '$1\n$2 ')
      .replace(/(\S)[ \t]+(>[ \t]+)/g, '$1\n\n$2')
  );
}

/* -------------------------------------------------------------------------- */
/* Spacing                                                                    */
/* -------------------------------------------------------------------------- */

function normaliseSpacing(text: string): string {
  const lines = text.split('\n');
  const output: string[] = [];

  for (const raw of lines) {
    // Two trailing spaces are a hard line break in markdown; anything else is lint.
    const line = raw.endsWith('  ') ? `${raw.trimEnd()}  ` : raw.trimEnd();
    const isHeading = /^#{1,6}\s/.test(line);
    const previous = output[output.length - 1];

    if (isHeading && previous !== undefined && previous.trim() !== '') output.push('');
    output.push(line);
  }

  return `${output
    .join('\n')
    // A heading needs air under it as well as over it.
    .replace(/^(#{1,6}\s.*)\n(?!\n|$)/gm, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '')}\n`;
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function repair(source: string): RepairResult {
  const applied: RepairIssue[] = [];
  const note = (id: RepairId) => applied.push({ id, label: ISSUES[id] });

  // Frontmatter is data, not prose, and none of these passes should touch it.
  const frontmatter = FRONTMATTER.exec(source)?.[0] ?? '';
  let text = source.slice(frontmatter.length).replace(/\r\n?/g, '\n');

  const unwrapped = unwrapEnvelope(text);
  if (unwrapped !== null) {
    text = unwrapped;
    note('json-envelope');
  }

  if (looksEscaped(text)) {
    text = unescape(text);
    note('escaped-newlines');
  }

  {
    const masked = mask(text);
    const stripped = stripFragments(masked.text);
    if (stripped.changed) note('json-fragments');
    text = unmask(stripped.text, masked.blocks);
  }

  if (isBlob(text)) {
    const masked = mask(text);
    text = unmask(reblock(masked.text), masked.blocks);
    note('single-blob');
  }

  {
    const masked = mask(text);
    const tidied = normaliseSpacing(masked.text);
    if (tidied !== masked.text) note('spacing');
    text = unmask(tidied, masked.blocks);
  }

  const result = frontmatter + text;
  if (result === source) return { text: source, applied: [] };

  return { text: result, applied };
}

/**
 * What `repair` would report, for deciding whether to offer it unprompted.
 * Spacing alone is not worth interrupting someone over — the file renders fine.
 */
export function diagnose(source: string): RepairIssue[] {
  if (source.trim() === '') return [];
  return repair(source).applied.filter((issue) => issue.id !== 'spacing');
}
