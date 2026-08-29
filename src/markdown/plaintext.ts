import MarkdownIt from 'markdown-it';

/**
 * Render markdown as plain text for somewhere that cannot accept rich text —
 * a social post box, a video description, a plain-text email field.
 *
 * Two modes, because "keep the formatting" splits into two different problems:
 *
 * - **Structure** (headings apart from body, bullets, numbering, quotes, link
 *   targets) survives as ordinary characters and works in every language.
 * - **Emphasis** does not. Plain text has no bold, so the only way to fake it is
 *   Unicode's mathematical alphanumerics — and those exist for Latin and Greek
 *   only. Cyrillic, accented Latin and CJK have no bold or italic forms at all,
 *   anywhere in Unicode. `styled` mode applies them where they exist and reports
 *   when it could not, rather than silently doing nothing.
 */

type Token = ReturnType<MarkdownIt['parse']>[number];

export interface PlainTextOptions {
  /** Apply Unicode bold and italic where the script has them. */
  styled: boolean;
}

export interface PlainTextResult {
  text: string;
  /** Characters in the result, which is what a paste-target limit counts. */
  symbols: number;
  /**
   * True when styling was asked for and some emphasised text had no styled
   * form — Cyrillic, say. The caller can say so instead of leaving a person to
   * wonder why half the post came out bold.
   */
  partiallyStyled: boolean;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

/* -------------------------------------------------------------------------- */
/* Unicode emphasis                                                           */
/* -------------------------------------------------------------------------- */

interface Alphabet {
  upper: number;
  lower: number;
  /** Sans-serif italic has no digits, so digits pass through unchanged. */
  digit: number | null;
}

const SANS_BOLD: Alphabet = { upper: 0x1d5d4, lower: 0x1d5ee, digit: 0x1d7ec };
const SANS_ITALIC: Alphabet = { upper: 0x1d608, lower: 0x1d622, digit: null };
const SANS_BOLD_ITALIC: Alphabet = { upper: 0x1d63c, lower: 0x1d656, digit: null };
/** Combining long stroke overlay, which draws a line through the previous glyph. */
const STRIKE = '̶';

interface StyleOutcome {
  text: string;
  /** A letter or digit that has no styled form in this alphabet. */
  missed: boolean;
}

function transliterate(text: string, alphabet: Alphabet): StyleOutcome {
  let out = '';
  let missed = false;

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCodePoint(alphabet.upper + code - 0x41);
    } else if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCodePoint(alphabet.lower + code - 0x61);
    } else if (alphabet.digit !== null && code >= 0x30 && code <= 0x39) {
      out += String.fromCodePoint(alphabet.digit + code - 0x30);
    } else {
      // Letters outside ASCII have no styled form; punctuation and spaces are
      // simply not the sort of character that gets emphasised.
      if (/\p{L}|\p{N}/u.test(char)) missed = true;
      out += char;
    }
  }

  return { text: out, missed };
}

/* -------------------------------------------------------------------------- */
/* Inline rendering                                                           */
/* -------------------------------------------------------------------------- */

type Emphasis = 'strong' | 'em' | 'strike';

interface InlineState {
  styled: boolean;
  missed: boolean;
}

function applyEmphasis(text: string, stack: Emphasis[], state: InlineState): string {
  if (!state.styled || stack.length === 0) return text;

  const bold = stack.includes('strong');
  const italic = stack.includes('em');

  let result = text;
  if (bold || italic) {
    const alphabet = bold && italic ? SANS_BOLD_ITALIC : bold ? SANS_BOLD : SANS_ITALIC;
    const outcome = transliterate(result, alphabet);
    if (outcome.missed) state.missed = true;
    result = outcome.text;
  }
  if (stack.includes('strike')) {
    result = [...result].map((char) => char + STRIKE).join('');
  }
  return result;
}

function renderInline(token: Token, state: InlineState): string {
  const children = token.children ?? [];
  const stack: Emphasis[] = [];
  let out = '';
  let linkHref: string | null = null;
  let linkStart = 0;

  for (const child of children) {
    switch (child.type) {
      case 'text':
        out += applyEmphasis(child.content, stack, state);
        break;
      // Backticks are markup, not content; the identifier inside is what matters.
      case 'code_inline':
        out += child.content;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += '\n';
        break;
      case 'strong_open':
        stack.push('strong');
        break;
      case 'em_open':
        stack.push('em');
        break;
      case 's_open':
        stack.push('strike');
        break;
      case 'strong_close':
      case 'em_close':
      case 's_close':
        stack.pop();
        break;
      case 'link_open':
        linkHref = child.attrGet('href');
        linkStart = out.length;
        break;
      case 'link_close': {
        // Nothing is clickable where this text is going, so the target has to be
        // written out — unless the label already is the target.
        const label = out.slice(linkStart);
        if (linkHref && linkHref !== label && `mailto:${label}` !== linkHref) {
          out += ` (${linkHref})`;
        }
        linkHref = null;
        break;
      }
      case 'image':
        if (child.content) out += `[${child.content}]`;
        break;
      case 'html_inline':
        break;
      default:
        out += child.content;
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Block rendering                                                            */
/* -------------------------------------------------------------------------- */

const BULLETS = ['• ', '◦ ', '▪ '];
const RULE = '────────';

/** `[ ]` and `[x]` are plain text in this renderer, so give them real boxes. */
function checkboxes(text: string): string {
  return text.replace(/^\[( |x|X)\]\s+/, (_, mark: string) =>
    mark === ' ' ? '☐ ' : '☑ ',
  );
}

function indentLines(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : pad + line))
    .join('\n');
}

export function toPlainText(source: string, options: PlainTextOptions): PlainTextResult {
  const state: InlineState = { styled: options.styled, missed: false };
  const tokens = md.parse(source, {});

  const blocks: string[] = [];
  const lists: Array<{ ordered: boolean; counter: number }> = [];
  const listStarts: number[] = [];
  const quoteStarts: number[] = [];
  let pendingMarker: string | null = null;
  let row: string[] | null = null;
  let tableStart = -1;

  /** Push a block, applying any list marker and the current list indentation. */
  function push(text: string) {
    if (text === '') return;
    const depth = Math.max(0, lists.length - 1);
    const marker = pendingMarker;
    pendingMarker = null;

    if (marker === null) {
      blocks.push(indentLines(text, '  '.repeat(depth)));
      return;
    }

    // The first line carries the bullet; wrapped lines line up under its text.
    const pad = '  '.repeat(depth);
    const [first = '', ...rest] = text.split('\n');
    const continuation = pad + ' '.repeat(marker.length);
    blocks.push(
      [pad + marker + first, ...rest.map((line) => (line === '' ? '' : continuation + line))].join(
        '\n',
      ),
    );
  }

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    switch (token.type) {
      case 'heading_open': {
        const inline = tokens[i + 1];
        const text = inline ? renderInline(inline, state) : '';
        if (options.styled) {
          const outcome = transliterate(text, SANS_BOLD);
          // A script with no bold form still gets hierarchy: capitals work in
          // Cyrillic and Greek, where Unicode's bold alphabet does not exist.
          push(outcome.text === text ? text.toUpperCase() : outcome.text);
        } else {
          push(text);
        }
        i += 2;
        break;
      }

      case 'paragraph_open': {
        const inline = tokens[i + 1];
        push(checkboxes(inline ? renderInline(inline, state) : ''));
        i += 2;
        break;
      }

      case 'fence':
      case 'code_block':
        // Fences do not exist in plain text; the code itself is the content.
        push(token.content.replace(/\n+$/, ''));
        break;

      case 'html_block':
        push(token.content.replace(/<[^>]*>/g, '').trim());
        break;

      case 'hr':
        push(RULE);
        break;

      case 'bullet_list_open':
      case 'ordered_list_open':
        lists.push({
          ordered: token.type === 'ordered_list_open',
          counter: Number(token.attrGet('start') ?? 1),
        });
        listStarts.push(blocks.length);
        break;

      case 'bullet_list_close':
      case 'ordered_list_close': {
        const start = listStarts.pop() ?? blocks.length;
        const items = blocks.splice(start);
        lists.pop();
        // Items sit on consecutive lines; only the list as a whole gets a gap.
        if (items.length > 0) blocks.push(items.join('\n'));
        break;
      }

      case 'list_item_open': {
        const list = lists[lists.length - 1];
        if (list) {
          if (list.ordered) {
            pendingMarker = `${list.counter}. `;
            list.counter += 1;
          } else {
            pendingMarker = BULLETS[Math.min(lists.length - 1, BULLETS.length - 1)] ?? '• ';
          }
        }
        break;
      }

      case 'blockquote_open':
        quoteStarts.push(blocks.length);
        break;

      case 'blockquote_close': {
        const start = quoteStarts.pop() ?? blocks.length;
        const inner = blocks.splice(start);
        const quoted = inner
          .join('\n\n')
          .split('\n')
          .map((line) => (line === '' ? '>' : `> ${line}`))
          .join('\n');
        if (quoted !== '') blocks.push(quoted);
        break;
      }

      case 'table_open':
        tableStart = blocks.length;
        break;

      case 'tr_open':
        row = [];
        break;

      case 'th_open':
      case 'td_open': {
        const inline = tokens[i + 1];
        row?.push(inline && inline.type === 'inline' ? renderInline(inline, state) : '');
        break;
      }

      case 'tr_close':
        if (row && row.length > 0) blocks.push(row.join(' | '));
        row = null;
        break;

      case 'table_close': {
        const rows = blocks.splice(tableStart);
        // A grid cannot survive proportional text, so rows become readable lines.
        if (rows.length > 0) blocks.push(rows.join('\n'));
        tableStart = -1;
        break;
      }

      default:
        break;
    }
  }

  const text = `${blocks.filter((block) => block !== '').join('\n\n')}\n`;
  return {
    text,
    symbols: [...text.trimEnd()].length,
    partiallyStyled: options.styled && state.missed,
  };
}

/** Characters in a document, counted the way a paste target counts them. */
export function countSymbols(source: string): number {
  // Spread rather than `.length`, so an emoji counts as one symbol, not two.
  return [...source].length;
}

export function countWords(source: string): number {
  const matches = source.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}
