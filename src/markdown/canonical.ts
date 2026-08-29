import MarkdownIt from 'markdown-it';
// Explicit extension: this module is imported directly by the unit tests, which
// Node resolves under real ESM rules rather than Vite's.
import { splitFrontmatter } from './frontmatter.ts';

/**
 * Re-serialise a note as canonical Markdown, for pasting somewhere that does
 * not render it.
 *
 * The audience is both a person reading raw text and an LLM agent reading it as
 * input, and those two want the same thing, which is worth stating because it
 * rules out the obvious alternative. Substituting Unicode look-alikes for
 * emphasis — 𝗯𝗼𝗹𝗱 for **bold** — makes text that reads as formatted to a human
 * and as line noise to everything else: it shreds tokenisation, defeats search
 * and copy, and is read out as gibberish by a screen reader. Markdown is
 * already the format models are most heavily trained on, and `**bold**` costs a
 * person nothing to read. So the output stays Markdown.
 *
 * What this adds over the raw source is that it is *canonical*: one bullet
 * character, one emphasis marker, tables with a proper delimiter row, indented
 * code promoted to fences, consistent blank lines. Whatever shape the note is
 * in, what comes out parses the same way for the next reader.
 */

type Token = ReturnType<MarkdownIt['parse']>[number];

export interface CanonicalResult {
  text: string;
  /** Characters in the result, which is what a paste target counts. */
  symbols: number;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false });

/* -------------------------------------------------------------------------- */
/* Inline                                                                     */
/* -------------------------------------------------------------------------- */

/** Wrap in enough backticks to survive whatever backticks are inside. */
function inlineCode(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const ticks = '`'.repeat(longest + 1);
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${content}${pad}${ticks}`;
}

function renderInline(token: Token): string {
  let out = '';
  let href: string | null = null;
  let labelStart = 0;

  for (const child of token.children ?? []) {
    switch (child.type) {
      case 'text':
        out += child.content;
        break;
      case 'code_inline':
        out += inlineCode(child.content);
        break;
      // A hard break becomes an ordinary newline: the two trailing spaces that
      // encode one are invisible to every reader and stripped by many targets.
      case 'softbreak':
      case 'hardbreak':
        out += '\n';
        break;
      case 'strong_open':
      case 'strong_close':
        out += '**';
        break;
      case 'em_open':
      case 'em_close':
        out += '*';
        break;
      case 's_open':
      case 's_close':
        out += '~~';
        break;
      case 'link_open':
        href = child.attrGet('href');
        labelStart = out.length;
        out += '[';
        break;
      case 'link_close': {
        const label = out.slice(labelStart + 1);
        if (href && (label === href || `mailto:${label}` === href)) {
          // A bare URL reads better than [url](url) to a person and a model alike.
          out = out.slice(0, labelStart) + label;
        } else {
          out += `](${href ?? ''})`;
        }
        href = null;
        break;
      }
      case 'image':
        out += `![${child.content}](${child.attrGet('src') ?? ''})`;
        break;
      case 'html_inline':
        out += child.content;
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

function fenceFor(content: string): string {
  const longest = (content.match(/^`{3,}/gm) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    2,
  );
  return '`'.repeat(longest + 1);
}

function alignmentOf(token: Token): string {
  const style = token.attrGet('style') ?? '';
  if (style.includes('center')) return ':---:';
  if (style.includes('right')) return '---:';
  if (style.includes('left')) return ':---';
  return '---';
}

export function toCanonicalMarkdown(source: string): CanonicalResult {
  // markdown-it reads a frontmatter fence as two thematic breaks with a
  // paragraph between them, so it has to come off before parsing and go back on
  // untouched afterwards.
  const { entries, body } = splitFrontmatter(source);
  const frontmatter =
    entries.length > 0 ? `---\n${entries.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n` : '';

  const tokens = md.parse(body, {});
  const blocks: string[] = [];
  const indents: string[] = [];
  const lists: Array<{ ordered: boolean; counter: number }> = [];
  const listStarts: number[] = [];
  const quoteStarts: number[] = [];
  let pendingMarker: string | null = null;
  let alignments: string[] = [];
  let row: string[] | null = null;
  let headerRow: string[] | null = null;
  let tableStart = -1;

  function push(text: string) {
    if (text === '') return;
    const indent = indents.join('');
    const marker = pendingMarker;
    pendingMarker = null;

    const lines = text.split('\n');
    if (marker === null) {
      blocks.push(lines.map((line) => (line === '' ? '' : indent + line)).join('\n'));
      return;
    }

    // The item's own indent was pushed on entry; its first line takes the
    // marker in place of that width, and later lines align under the text.
    const parent = indent.slice(0, Math.max(0, indent.length - marker.length));
    const [first = '', ...rest] = lines;
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
        const level = Number(token.tag.slice(1)) || 1;
        push(`${'#'.repeat(level)} ${inline ? renderInline(inline) : ''}`.trimEnd());
        i += 2;
        break;
      }

      case 'paragraph_open': {
        const inline = tokens[i + 1];
        push(inline ? renderInline(inline) : '');
        i += 2;
        break;
      }

      case 'fence': {
        const fence = fenceFor(token.content);
        const info = token.info.trim();
        push(`${fence}${info}\n${token.content.replace(/\n+$/, '')}\n${fence}`);
        break;
      }

      // An indented block is promoted to a fence: the same code, but unambiguous
      // to anything reading the raw text rather than rendering it.
      case 'code_block': {
        const fence = fenceFor(token.content);
        push(`${fence}\n${token.content.replace(/\n+$/, '')}\n${fence}`);
        break;
      }

      case 'html_block':
        push(token.content.trimEnd());
        break;

      case 'hr':
        push('---');
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
        const marker = list?.ordered ? `${list.counter}. ` : '- ';
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
        alignments = [];
        headerRow = null;
        break;

      case 'tr_open':
        row = [];
        break;

      case 'th_open':
      case 'td_open': {
        const inline = tokens[i + 1];
        // A pipe inside a cell would end the cell early for the next reader.
        const cell =
          inline && inline.type === 'inline' ? renderInline(inline).replace(/\|/g, '\\|') : '';
        row?.push(cell);
        if (token.type === 'th_open') alignments.push(alignmentOf(token));
        break;
      }

      case 'tr_close':
        if (row && row.length > 0) {
          if (headerRow === null) headerRow = row;
          else blocks.push(`| ${row.join(' | ')} |`);
        }
        row = null;
        break;

      case 'table_close': {
        const body = blocks.splice(tableStart);
        if (headerRow) {
          const header = `| ${headerRow.join(' | ')} |`;
          const divider = `| ${alignments.join(' | ')} |`;
          blocks.push([header, divider, ...body].join('\n'));
        } else if (body.length > 0) {
          blocks.push(body.join('\n'));
        }
        headerRow = null;
        tableStart = -1;
        break;
      }

      default:
        break;
    }
  }

  const text = `${frontmatter}${blocks.filter((block) => block !== '').join('\n\n')}\n`;
  return { text, symbols: [...text.trimEnd()].length };
}
