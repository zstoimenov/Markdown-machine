import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { looksLikeMarkdown, toMarkdown } from '../src/markdown/fromPlainText.ts';
import { toPlainText } from '../src/markdown/plaintext.ts';

const out = (source: string) => toMarkdown(source).text;
const ids = (source: string) => toMarkdown(source).changes.map((change) => change.id);

describe('toMarkdown — headings', () => {
  it('reads a shouted line as a heading', () => {
    assert.equal(out('RELEASE NOTES\n\nWe shipped it.\n'), '# RELEASE NOTES\n\nWe shipped it.\n');
  });

  it('opens the note with a level one and keeps the rest at two', () => {
    const result = out('NOTES\n\nBody.\n\nSECOND PART\n\nMore.\n');
    assert.match(result, /^# NOTES\n/);
    assert.match(result, /\n## SECOND PART\n/);
  });

  it('leaves the words alone, capitals and all', () => {
    assert.match(out('API KEYS\n\nBody.\n'), /# API KEYS/);
  });

  it('shouts in Cyrillic too', () => {
    assert.match(out('БЕЛЕЖКИ\n\nТекст тук.\n'), /# БЕЛЕЖКИ/);
  });

  it('does not read a shouted sentence as a heading', () => {
    assert.equal(ids('STOP DOING THAT.\n\nPlease.\n').includes('headings'), false);
  });

  it('takes an underline as the heading it is', () => {
    assert.equal(out('Title\n=====\n\nBody.\n'), '# Title\n\nBody.\n');
    assert.equal(out('Section\n-------\n\nBody.\n'), '## Section\n\nBody.\n');
  });

  it('drops the colon a shouted label ends with', () => {
    assert.match(out('TODO:\n\nSomething.\n'), /^# TODO\n/);
  });
});

describe('toMarkdown — lists', () => {
  it('turns plain bullets into dashes', () => {
    assert.equal(out('• one\n• two\n'), '- one\n- two\n');
  });

  it('recovers nesting from the indentation, whatever its width', () => {
    assert.equal(out('• one\n   ◦ nested\n• two\n'), '- one\n  - nested\n- two\n');
  });

  it('keeps the numbers of a numbered list', () => {
    assert.equal(out('3) third\n4) fourth\n'), '3. third\n4. fourth\n');
  });

  it('reads a bare checkbox as a task item', () => {
    assert.equal(out('[ ] buy milk\n[x] feed cat\n'), '- [ ] buy milk\n- [x] feed cat\n');
  });

  it('reads a ballot glyph the same way', () => {
    assert.equal(out('☐ open\n☑ done\n'), '- [ ] open\n- [x] done\n');
  });

  it('keeps a wrapped item under the item it belongs to', () => {
    assert.equal(out('• one that runs on\n  and keeps going\n• two\n'), '- one that runs on\n  and keeps going\n- two\n');
  });

  it('starts a list that follows a line of prose on its own block', () => {
    assert.equal(out('Shopping:\n• milk\n• eggs\n'), 'Shopping:\n\n- milk\n- eggs\n');
  });
});

describe('toMarkdown — blocks', () => {
  it('fences an indented run as code', () => {
    assert.equal(out('Run it:\n\n    npm test\n    npm run build\n'), 'Run it:\n\n```\nnpm test\nnpm run build\n```\n');
  });

  it('rebuilds pipe-separated rows as a table with a header rule', () => {
    assert.equal(out('Name | Age\nAda | 36\n'), '| Name | Age |\n| --- | --- |\n| Ada | 36 |\n');
  });

  it('leaves a table that already has its rule alone', () => {
    const table = '| a | b |\n| --- | --- |\n| c | d |\n';
    assert.equal(toMarkdown(table).changes.length, 0);
  });

  it('does not read one sentence with a pipe in it as a table', () => {
    assert.equal(ids('Press ctrl | to split the pane and carry on.\n').includes('tables'), false);
  });

  it('turns a drawn divider into a rule', () => {
    assert.equal(out('One.\n\n────────\n\nTwo.\n'), 'One.\n\n---\n\nTwo.\n');
  });
});

describe('toMarkdown — links', () => {
  it('links a label written in front of its URL', () => {
    assert.equal(
      out('See the docs (https://example.com) for more.\n'),
      '[See the docs](https://example.com) for more.\n',
    );
  });

  it('starts the label after the sentence before it', () => {
    assert.equal(
      out('That is done. The handbook (https://example.com) says so.\n'),
      'That is done. [The handbook](https://example.com) says so.\n',
    );
  });

  it('leaves a markdown link exactly as it is', () => {
    assert.equal(toMarkdown('A [label](https://example.com) here.\n').changes.length, 0);
  });

  it('leaves a bare URL alone — there is no label to use', () => {
    assert.equal(ids('Go to https://example.com now.\n').includes('links'), false);
  });
});

describe('toMarkdown — paragraphs', () => {
  it('joins a hard-wrapped paragraph back together', () => {
    const wrapped =
      'This paragraph was wrapped at about seventy columns by\n' +
      'some mail client a long time ago, and it has stayed that\n' +
      'way ever since it was written.\n';
    assert.equal(out(wrapped).split('\n')[0]?.includes('some mail client'), true);
  });

  it('leaves short lines alone, which may be a poem or an address', () => {
    assert.equal(ids('Flat 3\n12 High Street\nPerth\n').includes('reflow'), false);
  });
});

describe('toMarkdown — what it must not touch', () => {
  it('leaves a note that is already markdown completely alone', () => {
    const note = '# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n> quoted\n';
    assert.deepEqual(toMarkdown(note), { text: note, changes: [] });
  });

  it('never edits without naming what it did', () => {
    const note = 'Just a sentence.\n';
    const result = toMarkdown(note);
    assert.equal(result.changes.length, 0);
    assert.equal(result.text, note);
  });

  it('leaves the contents of a fence alone', () => {
    const note = 'Look:\n\n```\nSHOUTING | IN | CODE\n    indented\n```\n';
    assert.equal(toMarkdown(note).changes.length, 0);
  });

  it('leaves frontmatter where it is', () => {
    assert.match(out('---\ntitle: Note\n---\n\nSHOUTED\n\nBody.\n'), /^---\ntitle: Note\n---\n/);
  });
});

describe('toMarkdown — after toPlainText', () => {
  it('puts the structure back that the plain-text export took out', () => {
    const note = '## Section\n\n- one\n  - nested\n\n> quoted\n\n| a | b |\n| --- | --- |\n| c | d |\n';
    const round = toMarkdown(toPlainText(note).text).text;
    assert.match(round, /^# SECTION\n/);
    assert.match(round, /\n- one\n  - nested\n/);
    assert.match(round, /\n> quoted\n/);
    assert.match(round, /\| a \| b \|\n\| --- \| --- \|\n\| c \| d \|/);
  });
});

describe('looksLikeMarkdown', () => {
  it('recognises a note written as markdown', () => {
    assert.equal(looksLikeMarkdown('# Title\n\n**bold** words.\n'), true);
  });

  it('does not take a plain list for markdown', () => {
    assert.equal(looksLikeMarkdown('Shopping\n\n- milk\n- eggs\n'), false);
  });
});
