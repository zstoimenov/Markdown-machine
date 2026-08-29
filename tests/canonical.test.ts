import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { toCanonicalMarkdown } from '../src/markdown/canonical.ts';
import { countSymbols, countWords } from '../src/markdown/counts.ts';

const out = (source: string) => toCanonicalMarkdown(source).text;

describe('toCanonicalMarkdown — structure survives as markdown', () => {
  it('keeps headings as hashes', () => {
    assert.equal(out('# Title\n\nBody.\n'), '# Title\n\nBody.\n');
  });

  it('keeps emphasis as markdown, never as Unicode look-alikes', () => {
    const result = out('**bold** and *italic* and ~~gone~~\n');
    assert.equal(result, '**bold** and *italic* and ~~gone~~\n');
    // Mathematical alphanumerics would shred tokenisation and search.
    assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(result));
  });

  it('leaves Cyrillic exactly as written', () => {
    assert.equal(out('# Заглавие\n\n**Удебелен** текст.\n'), '# Заглавие\n\n**Удебелен** текст.\n');
  });

  it('keeps links in a form that carries the target', () => {
    assert.equal(out('See [docs](https://example.com).\n'), 'See [docs](https://example.com).\n');
  });

  it('leaves a bare URL bare rather than making it [url](url)', () => {
    assert.equal(out('<https://example.com>\n'), 'https://example.com\n');
  });

  it('keeps inline code fenced in backticks', () => {
    assert.equal(out('Run `npm test`.\n'), 'Run `npm test`.\n');
  });

  it('widens the backticks when the code contains some', () => {
    assert.equal(out('A ``a ` b`` c\n'), 'A ``a ` b`` c\n');
  });
});

describe('toCanonicalMarkdown — canonical form', () => {
  it('normalises every bullet character to a dash', () => {
    assert.equal(out('* one\n+ two\n'), '- one\n\n- two\n');
  });

  it('indents nested lists under their parent marker', () => {
    assert.equal(out('- one\n  - nested\n- two\n'), '- one\n  - nested\n- two\n');
  });

  it('indents a list nested under a numbered item by the marker width', () => {
    const result = out('1. one\n   - nested\n');
    assert.equal(result, '1. one\n   - nested\n');
  });

  it('numbers ordered lists from their start value', () => {
    assert.equal(out('3. three\n4. four\n'), '3. three\n4. four\n');
  });

  it('keeps task list markers, which agents read as state', () => {
    assert.equal(out('- [x] done\n- [ ] todo\n'), '- [x] done\n- [ ] todo\n');
  });

  it('gives a table a proper delimiter row, preserving alignment', () => {
    const result = out('| A | B |\n| :-- | --: |\n| 1 | 2 |\n');
    assert.equal(result, '| A | B |\n| :--- | ---: |\n| 1 | 2 |\n');
  });

  it('escapes a pipe inside a cell so the row still parses', () => {
    assert.match(out('| A |\n| --- |\n| a \\| b |\n'), /\| a \\\| b \|/);
  });

  it('promotes an indented code block to a fence', () => {
    assert.equal(out('    const a = 1;\n'), '```\nconst a = 1;\n```\n');
  });

  it('keeps the language tag on a fence', () => {
    assert.equal(out('```js\nconst a = 1;\n```\n'), '```js\nconst a = 1;\n```\n');
  });

  it('widens a fence that would otherwise be closed early', () => {
    const result = out('````\n```\ninner\n```\n````\n');
    assert.ok(result.startsWith('````'), result);
  });

  it('prefixes blockquotes', () => {
    assert.equal(out('> quoted\n'), '> quoted\n');
  });

  it('separates blocks with exactly one blank line', () => {
    assert.equal(out('# A\nB\n\n\n\nC\n'), '# A\n\nB\n\nC\n');
  });

  it('preserves frontmatter', () => {
    const result = out('---\ntitle: Kept\n---\n# Body\n');
    assert.equal(result, '---\ntitle: Kept\n---\n\n# Body\n');
  });

  it('is idempotent — canonical text is already canonical', () => {
    const source = '# T\n\n- one\n  - two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> q\n';
    const once = out(source);
    assert.equal(out(once), once);
  });

  it('keeps an image with its source', () => {
    assert.equal(out('![a chart](chart.png)\n'), '![a chart](chart.png)\n');
  });

  it('reports the symbol count of what it produced', () => {
    const result = toCanonicalMarkdown('# T\n\n- one\n');
    assert.equal(result.symbols, [...'# T\n\n- one'].length);
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
