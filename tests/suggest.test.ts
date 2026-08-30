import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { suggest, type SuggestContext } from '../src/markdown/suggest.ts';

/** A cursor at the end of `line`, in an ordinary paragraph, with nothing selected. */
function at(line: string, extra: Partial<SuggestContext> = {}): SuggestContext {
  return {
    line,
    col: line.length,
    selection: '',
    previous: null,
    inCode: false,
    fenceOpen: false,
    ...extra,
  };
}

const ids = (context: SuggestContext) => suggest(context).map((suggestion) => suggestion.id);
const find = (context: SuggestContext, id: string) =>
  suggest(context).find((suggestion) => suggestion.id === id);

describe('suggest — closing what is open', () => {
  it('offers the closing half of a bold', () => {
    assert.equal(ids(at('This is **very'))[0], 'close-bold');
    assert.deepEqual(find(at('This is **very'), 'close-bold')?.edit, {
      kind: 'insert',
      text: '**',
    });
  });

  it('does not offer it once the bold is closed', () => {
    assert.equal(ids(at('This is **very** good')).includes('close-bold'), false);
  });

  it('tells italic from the inner half of a bold', () => {
    assert.equal(ids(at('An *aside')).includes('close-italic'), true);
    assert.equal(ids(at('A **strong')).includes('close-italic'), false);
  });

  it('offers only the backtick while a code span is open', () => {
    assert.deepEqual(ids(at('Run `npm')), ['close-code']);
  });

  it('offers the target after an open label', () => {
    assert.deepEqual(find(at('See [the docs'), 'close-label')?.edit, {
      kind: 'insert',
      text: ']()',
      caret: 2,
    });
  });

  it('offers the closing bracket after an open target', () => {
    assert.equal(ids(at('See [docs](https://example.com'))[0], 'close-target');
  });
});

describe('suggest — code', () => {
  it('offers nothing but the closing fence while one is open', () => {
    assert.deepEqual(ids(at('npm test', { fenceOpen: true, inCode: true })), ['close-fence']);
  });

  it('puts the fence on a line of its own when the cursor is not on one', () => {
    assert.deepEqual(find(at('npm test', { fenceOpen: true, inCode: true }), 'close-fence')?.edit, {
      kind: 'insert',
      text: '\n```',
    });
  });

  it('says nothing at all inside closed code', () => {
    assert.deepEqual(suggest(at('const x = **1', { inCode: true })), []);
  });
});

describe('suggest — starting a block', () => {
  it('offers the block markers on an empty line', () => {
    const offered = ids(at(''));
    assert.ok(offered.includes('heading'), offered.join(', '));
    assert.ok(offered.includes('bullet'));
    assert.ok(offered.includes('fence'));
  });

  it('writes both fences at once, cursor between them', () => {
    assert.deepEqual(find(at(''), 'fence')?.edit, {
      kind: 'insert',
      text: '```\n\n```',
      caret: 4,
    });
  });

  it('carries a list on from the line above', () => {
    assert.deepEqual(find(at('', { previous: '- milk' }), 'next-item')?.edit, {
      kind: 'insert',
      text: '- ',
    });
  });

  it('counts the next number rather than repeating the last', () => {
    assert.deepEqual(find(at('', { previous: '3. third' }), 'next-item')?.edit, {
      kind: 'insert',
      text: '4. ',
    });
  });

  it('offers the header rule under a row of cells', () => {
    assert.deepEqual(find(at('', { previous: '| a | b | c |' }), 'header-rule')?.edit, {
      kind: 'insert',
      text: '\n| --- | --- | --- |',
    });
  });
});

describe('suggest — carrying on', () => {
  it('offers the next item and one a level in', () => {
    const offered = ids(at('- milk'));
    assert.ok(offered.includes('next-item'), offered.join(', '));
    assert.ok(offered.includes('sub-item'));
  });

  it('keeps the marker and the indent of the item it follows', () => {
    assert.deepEqual(find(at('  * nested'), 'next-item')?.edit, { kind: 'insert', text: '\n  * ' });
    assert.deepEqual(find(at('  * nested'), 'sub-item')?.edit, { kind: 'insert', text: '\n    * ' });
  });

  it('offers to make an item a checkbox, but not one that is already', () => {
    assert.deepEqual(find(at('- milk'), 'make-task')?.edit, { kind: 'prefix', text: '- [ ] ' });
    assert.equal(ids(at('- [ ] milk')).includes('make-task'), false);
  });

  it('offers the levels either side of a heading', () => {
    assert.deepEqual(find(at('## Section'), 'deeper')?.edit, { kind: 'prefix', text: '### ' });
    assert.deepEqual(find(at('## Section'), 'shallower')?.edit, { kind: 'prefix', text: '# ' });
  });

  it('offers to take a top-level heading back to plain text', () => {
    assert.deepEqual(find(at('# Title'), 'shallower')?.edit, { kind: 'prefix', text: '' });
  });

  it('offers another cell inside a table row', () => {
    assert.deepEqual(find(at('| a | b'), 'cell')?.edit, { kind: 'insert', text: ' | ' });
  });

  it('offers the inline markers and the two block changes on prose', () => {
    const offered = ids(at('An ordinary sentence.'));
    assert.ok(offered.includes('bold'), offered.join(', '));
    assert.ok(offered.includes('link'));
    assert.ok(offered.includes('heading'));
  });
});

describe('suggest — with a selection', () => {
  it('wraps the selection rather than starting a marker', () => {
    assert.deepEqual(find(at('one two', { selection: 'two' }), 'bold')?.edit, {
      kind: 'wrap',
      open: '**',
      close: '**',
    });
  });

  it('leaves the cursor inside the brackets of a link', () => {
    assert.deepEqual(find(at('one', { selection: 'one' }), 'link')?.edit, {
      kind: 'wrap',
      open: '[',
      close: ']()',
      caret: 1,
    });
  });

  it('offers to convert several lines of selected plain text', () => {
    const converted = find(at('', { selection: '• one\n• two' }), 'to-markdown');
    assert.deepEqual(converted?.edit, { kind: 'insert', text: '- one\n- two' });
  });

  it('does not offer to convert a selection that is markdown already', () => {
    assert.equal(ids(at('', { selection: '- one\n- two' })).includes('to-markdown'), false);
  });

  it('does not offer to convert a selection inside one line', () => {
    assert.equal(ids(at('one two', { selection: 'one two' })).includes('to-markdown'), false);
  });
});

describe('suggest — how many', () => {
  it('never offers more than fits in a glance', () => {
    for (const context of [at(''), at('- milk'), at('An ordinary sentence.'), at('| a | b')]) {
      assert.ok(suggest(context).length <= 6, context.line);
    }
  });

  it('gives every suggestion a distinct id, so the row can be keyed', () => {
    for (const context of [at(''), at('- milk'), at('# Title'), at('An **open')]) {
      const offered = ids(context);
      assert.equal(new Set(offered).size, offered.length, offered.join(', '));
    }
  });
});
