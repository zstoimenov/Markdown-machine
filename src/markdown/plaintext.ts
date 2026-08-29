import MarkdownIt from 'markdown-it';
// Explicit extension: this module is imported directly by the unit tests, which
// Node resolves under real ESM rules rather than Vite's.
import { splitFrontmatter } from './frontmatter.ts';

/**
 * Render a note as plain text — no markdown markers at all — while keeping the
 * shape of the document.
 *
 * The rule the whole thing follows: **markup goes, words stay.** Every `#`,
 * `**`, backtick and `[](…)` is stripped, and nothing the author wrote is
 * reworded. Two deliberate exceptions: heading case, explained where it happens,
 * and the same typographic substitutions the preview already makes — curly
 * quotes and proper dashes — so what is copied matches what was on screen.
 *
 * Structure survives as ordinary characters, which is what a plain box and an
 * LLM agent can both read: bullets, numbering, indentation, blank lines between
 * blocks, and link targets written out because nothing here is clickable.
 *
 * Not used, deliberately: Unicode look-alikes for bold (𝗯𝗼𝗹𝗱). They buy an
 * appearance at the cost of tokenisation, search, copy and screen readers, and
 * do not exist for Cyrillic or CJK at all.
 */

type Token = ReturnType<MarkdownIt['parse']>[number];

export interface PlainTextResult {
  text: string;
  /** Characters in the result, which is what a paste target counts. */
  symbols: number;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

const BULLETS = ['• ', '◦ ', '▪ '];
const RULE = '────────';
/** Long-standing plain-text convention for "this block is code, not prose". */
const CODE_INDENT = '    ';

/* -------------------------------------------------------------------------- */
/* Inline                                                                     */
/* -------------------------------------------------------------------------- */

function renderInline(token: Token): string {
  let out = '';
  let href: string | null = null;
  let labelStart = 0;

  for (const child of token.children ?? []) {
    switch (child.type) {
      case 'text':
      // Emphasis markers are markup; the words they wrapped are the content.
      case 'code_inline':
        out += child.content;
        break;
      case 'softbreak':
      case 'hardbreak':
        out += '\n';
        break;
      case 'strong_open':
      case 'strong_close':
      case 'em_open':
      case 'em_close':
      case 's_open':
      case 's_close':
        break;
      case 'link_open':
        href = child.attrGet('href');
        labelStart = out.length;
        break;
      case 'link_close': {
        // Nothing is clickable where this is going, so the target is written out
        // — unless the label already is the target.
        const label = out.slice(labelStart);
        if (href && href !== label && `mailto:${label}` !== href) out += ` (${href})`;
        href = null;
        break;
      }
      case 'image': {
        const src = child.attrGet('src') ?? '';
        out += child.content ? `${child.content} (${src})` : src;
        break;
      }
      case 'html_inline':
        break;
      default:
        out += child.content;
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

function indentLines(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : pad + line))
    .join('\n');
}

export function toPlainText(source: string): PlainTextResult {
  // markdown-it reads a frontmatter fence as two thematic breaks with a
  // paragraph between, so it comes off first and returns as plain key/value
  // lines — the metadata without the punctuation.
  const { entries, body } = splitFrontmatter(source);
  const tokens = md.parse(body, {});

  const blocks: string[] = [];
  const indents: string[] = [];
  const lists: Array<{ ordered: boolean; counter: number }> = [];
  const listStarts: number[] = [];
  const quoteStarts: number[] = [];
  let pendingMarker: string | null = null;
  let row: string[] | null = null;
  let tableStart = -1;

  function push(text: string) {
    if (text === '') return;
    const indent = indents.join('');
    const marker = pendingMarker;
    pendingMarker = null;

    if (marker === null) {
      blocks.push(indentLines(text, indent));
      return;
    }

    // The item's own indent went on at entry; its first line takes the bullet in
    // place of that width, and any later lines align under the text.
    const parent = indent.slice(0, Math.max(0, indent.length - marker.length));
    const [first = '', ...rest] = text.split('\n');
    blocks.push(
      [parent + marker + first, ...rest.map((line) => (line === '' ? '' : indent + line))].join(
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
        const text = inline ? renderInline(inline) : '';
        // The one place words are altered. Plain text has no other way to mark a
        // heading, and capitals work in every script — including Cyrillic, where
        // Unicode has no bold form at all. The level distinction is lost, which
        // is the price of not inventing punctuation for it.
        push(text.toUpperCase());
        i += 2;
        break;
      }

      case 'paragraph_open': {
        const inline = tokens[i + 1];
        push(inline ? renderInline(inline) : '');
        i += 2;
        break;
      }

      case 'fence':
      case 'code_block':
        push(indentLines(token.content.replace(/\n+$/, ''), CODE_INDENT));
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
        // Items are consecutive lines; only the list as a whole takes a gap.
        if (items.length > 0) blocks.push(items.join('\n'));
        break;
      }

      case 'list_item_open': {
        const list = lists[lists.length - 1];
        const marker = list?.ordered
          ? `${list.counter}. `
          : (BULLETS[Math.min(lists.length - 1, BULLETS.length - 1)] ?? '• ');
        if (list?.ordered) list.counter += 1;
        pendingMarker = marker;
        indents.push(' '.repeat(marker.length));
        break;
      }

      case 'list_item_close':
        indents.pop();
        break;

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
        row?.push(inline && inline.type === 'inline' ? renderInline(inline) : '');
        break;
      }

      case 'tr_close':
        if (row && row.length > 0) blocks.push(row.join(' | '));
        row = null;
        break;

      case 'table_close': {
        const rows = blocks.splice(tableStart);
        // A grid cannot survive proportional text; readable rows can.
        if (rows.length > 0) blocks.push(rows.join('\n'));
        tableStart = -1;
        break;
      }

      default:
        break;
    }
  }

  const meta = entries.length > 0 ? [entries.map(([k, v]) => `${k}: ${v}`).join('\n')] : [];
  const text = `${[...meta, ...blocks.filter((block) => block !== '')].join('\n\n')}\n`;
  return { text, symbols: [...text.trimEnd()].length };
}
