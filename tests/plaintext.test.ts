import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { countSymbols, countWords, toPlainText } from '../src/markdown/plaintext.ts';

const plain = (source: string) => toPlainText(source, { styled: false }).text;
const styled = (source: string) => toPlainText(source, { styled: true }).text;

describe('toPlainText — structure', () => {
  it('separates blocks with a blank line', () => {
    assert.equal(plain('# Title\n\nBody text.\n'), 'Title\n\nBody text.\n');
  });

  it('turns bullets into real bullet characters', () => {
    assert.equal(plain('- one\n- two\n'), '• one\n• two\n');
  });

  it('numbers ordered lists, honouring the start value', () => {
    assert.equal(plain('3. three\n4. four\n'), '3. three\n4. four\n');
  });

  it('indents nested lists under their parent', () => {
    const result = plain('- one\n  - nested\n- two\n');
    assert.equal(result, '• one\n  ◦ nested\n• two\n');
  });

  it('writes the link target out, since nothing here is clickable', () => {
    assert.equal(plain('See [the docs](https://example.com).\n'), 'See the docs (https://example.com).\n');
  });

  it('does not repeat a bare URL as its own target', () => {
    assert.equal(plain('<https://example.com>\n'), 'https://example.com\n');
  });

  it('drops the markup around inline code but keeps the code', () => {
    assert.equal(plain('Run `npm test` now.\n'), 'Run npm test now.\n');
  });

  it('keeps a fenced block as bare code', () => {
    assert.equal(plain('```js\nconst a = 1;\n```\n'), 'const a = 1;\n');
  });

  it('prefixes blockquotes', () => {
    assert.equal(plain('> quoted\n'), '> quoted\n');
  });

  it('gives task lists real checkboxes', () => {
    assert.equal(plain('- [x] done\n- [ ] todo\n'), '• ☑ done\n• ☐ todo\n');
  });

  it('flattens a table into readable rows', () => {
    const result = plain('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    assert.equal(result, 'A | B\n1 | 2\n');
  });

  it('draws a horizontal rule', () => {
    assert.match(plain('a\n\n---\n\nb\n'), /\n────────\n/);
  });

  it('keeps the author line breaks inside a paragraph', () => {
    assert.equal(plain('one\ntwo\n'), 'one\ntwo\n');
  });

  it('names an image rather than dropping it silently', () => {
    assert.equal(plain('![a chart](chart.png)\n'), '[a chart]\n');
  });
});

describe('toPlainText — emphasis', () => {
  it('leaves emphasis markers out entirely in plain mode', () => {
    assert.equal(plain('**bold** and *italic*\n'), 'bold and italic\n');
  });

  it('bolds Latin letters and digits', () => {
    const result = toPlainText('**AZaz09**\n', { styled: true });
    assert.equal(result.text, '\u{1D5D4}\u{1D5ED}\u{1D5EE}\u{1D607}\u{1D7EC}\u{1D7F5}\n');
    assert.equal(result.partiallyStyled, false);
  });

  it('italicises Latin letters', () => {
    assert.equal(toPlainText('*Aa*\n', { styled: true }).text, '\u{1D608}\u{1D622}\n');
  });

  it('reports when a script has no bold form, and leaves it readable', () => {
    const result = toPlainText('**Здравей**\n', { styled: true });
    assert.equal(result.text, 'Здравей\n', 'Cyrillic must survive unchanged, not become mojibake');
    assert.equal(result.partiallyStyled, true);
  });

  it('falls back to capitals for a heading in a script Unicode cannot bold', () => {
    // Capitals are the only hierarchy available to Cyrillic in plain text.
    assert.equal(toPlainText('# Заглавие\n', { styled: true }).text, 'ЗАГЛАВИЕ\n');
  });

  it('bolds a Latin heading rather than shouting it', () => {
    assert.equal(toPlainText('# Hi\n', { styled: true }).text, '\u{1D5DB}\u{1D5F6}\n');
  });

  it('never styles anything in plain mode, whatever the script', () => {
    const result = toPlainText('# Заглавие\n\n**bold**\n', { styled: false });
    assert.equal(result.text, 'Заглавие\n\nbold\n');
    assert.equal(result.partiallyStyled, false);
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

  it('reports the symbol count of the copied result, not of the source', () => {
    const result = toPlainText('# Title\n\n- one\n', { styled: false });
    assert.equal(result.symbols, [...'Title\n\n• one'].length);
  });
});
