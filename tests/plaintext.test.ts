import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { toPlainText } from '../src/markdown/plaintext.ts';
import { countSymbols, countWords } from '../src/markdown/counts.ts';

const out = (source: string) => toPlainText(source).text;

describe('toPlainText — markers go', () => {
  it('strips the hashes from headings', () => {
    assert.equal(out('## Section\n\nBody.\n'), 'SECTION\n\nBody.\n');
  });

  it('strips emphasis markers and keeps the words', () => {
    assert.equal(out('A **bold** and *italic* and ~~struck~~ word.\n'), 'A bold and italic and struck word.\n');
  });

  it('strips backticks from inline code', () => {
    assert.equal(out('Run `npm test` now.\n'), 'Run npm test now.\n');
  });

  it('never emits a markdown marker for a fully marked-up note', () => {
    const result = out('# T\n\n**b** *i* `c` [l](https://e.com)\n\n- x\n');
    assert.ok(!/\*\*|`|^#/m.test(result), result);
  });

  it('uses no Unicode look-alikes for emphasis', () => {
    assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(out('**bold** *italic*\n')));
  });
});

describe('toPlainText — structure stays', () => {
  it('turns bullets into bullet characters', () => {
    assert.equal(out('- one\n- two\n'), '• one\n• two\n');
  });

  it('marks nested levels with a different bullet, indented', () => {
    assert.equal(out('- one\n  - nested\n- two\n'), '• one\n  ◦ nested\n• two\n');
  });

  it('numbers ordered lists from their start value', () => {
    assert.equal(out('3. three\n4. four\n'), '3. three\n4. four\n');
  });

  it('indents a list nested under a numbered item by the marker width', () => {
    // The bullet glyph tracks nesting depth, not the parent's kind, so a list
    // inside a numbered list is second-level and reads as second-level.
    assert.equal(out('1. one\n   - nested\n'), '1. one\n   ◦ nested\n');
  });

  it('writes the link target out, since nothing here is clickable', () => {
    assert.equal(out('See [the docs](https://example.com).\n'), 'See the docs (https://example.com).\n');
  });

  it('does not repeat a bare URL as its own target', () => {
    assert.equal(out('<https://example.com>\n'), 'https://example.com\n');
  });

  it('indents a code block instead of fencing it', () => {
    assert.equal(out('```js\nconst a = 1;\n```\n'), '    const a = 1;\n');
  });

  it('keeps blockquote prefixes, which every mail client already uses', () => {
    assert.equal(out('> quoted\n'), '> quoted\n');
  });

  it('draws a horizontal rule', () => {
    assert.match(out('a\n\n---\n\nb\n'), /\n────────\n/);
  });

  it('flattens a table into readable rows', () => {
    assert.equal(out('| A | B |\n| --- | --- |\n| 1 | 2 |\n'), 'A | B\n1 | 2\n');
  });

  it('keeps an image reachable by name and source', () => {
    assert.equal(out('![a chart](chart.png)\n'), 'a chart (chart.png)\n');
  });

  it('keeps the author line breaks inside a paragraph', () => {
    assert.equal(out('one\ntwo\n'), 'one\ntwo\n');
  });

  it('separates blocks with exactly one blank line', () => {
    assert.equal(out('# A\nB\n\n\n\nC\n'), 'A\n\nB\n\nC\n');
  });

  it('turns frontmatter into plain metadata lines', () => {
    assert.equal(out('---\ntitle: Kept\ntags: a, b\n---\n# Body\n'), 'title: Kept\ntags: a, b\n\nBODY\n');
  });
});

describe('toPlainText — words are not rewritten', () => {
  it('leaves Cyrillic prose exactly as written', () => {
    assert.equal(out('**Удебелен** текст.\n'), 'Удебелен текст.\n');
  });

  it('uppercases a Cyrillic heading, which is the one hierarchy plain text has', () => {
    assert.equal(out('# Заглавие\n'), 'ЗАГЛАВИЕ\n');
  });

  it('is a terminal format, not a round trip', () => {
    // Stripping markup is deliberately lossy, so the output is not markdown and
    // is not meant to be fed back in: `• one` is a paragraph to a parser, and a
    // second pass would flatten the indent that marks nesting. Pinning that here
    // so nobody mistakes the export for something reversible.
    const once = out('- one\n  - two\n');
    assert.equal(once, '• one\n  ◦ two\n');
    assert.equal(out(once), '• one\n◦ two\n');
  });

  it('reports the symbol count of what it produced, not of the source', () => {
    const result = toPlainText('# Title\n\n- one\n');
    assert.equal(result.symbols, [...'TITLE\n\n• one'].length);
  });
});

describe('counting', () => {
  it('counts characters, not UTF-16 code units', () => {
    assert.equal(countSymbols('abc'), 3);
    assert.equal(countSymbols('🎉'), 1, 'an emoji is one symbol to a person and to a post limit');
    assert.equal(countSymbols('Здравей'), 7);
  });

  it('counts words across scripts', () => {
    assert.equal(countWords('one two three'), 3);
    assert.equal(countWords('Здравей свят'), 2);
    assert.equal(countWords(''), 0);
  });
});
