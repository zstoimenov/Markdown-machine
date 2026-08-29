import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { diagnose, repair } from '../src/markdown/repair.ts';

describe('repair', () => {
  it('leaves a healthy document completely alone', () => {
    const source = '# Title\n\nA paragraph.\n\n- one\n- two\n\n```js\nconst a = 1;\n```\n';
    const result = repair(source);
    assert.equal(result.text, source);
    assert.deepEqual(result.applied, []);
    assert.deepEqual(diagnose(source), []);
  });

  it('unwraps a document buried in a JSON envelope', () => {
    const source = JSON.stringify({
      role: 'assistant',
      content: '# Notes\n\nSome prose.\n',
    });
    const result = repair(source);
    assert.match(result.text, /^# Notes\n\nSome prose\.\n$/);
    assert.ok(result.applied.some((issue) => issue.id === 'json-envelope'));
  });

  it('unwraps the content-parts array shape', () => {
    const source = JSON.stringify([
      { type: 'text', text: '# One\n\nFirst part.' },
      { type: 'text', text: '## Two\n\nSecond part.' },
    ]);
    const result = repair(source);
    assert.match(result.text, /# One/);
    assert.match(result.text, /## Two/);
    assert.match(result.text, /Second part\./);
  });

  it('turns literal escape sequences into real line breaks', () => {
    const source = '# Title\\n\\nParagraph one.\\n\\nParagraph two.\\n';
    const result = repair(source);
    assert.equal(result.text, '# Title\n\nParagraph one.\n\nParagraph two.\n');
    assert.ok(result.applied.some((issue) => issue.id === 'escaped-newlines'));
  });

  it('does not unescape a document that merely mentions a newline once', () => {
    const source = '# Escapes\n\nUse `\\n` to break a line.\n\nThat is all.\n';
    assert.deepEqual(diagnose(source), []);
    assert.equal(repair(source).text, source);
  });

  it('keeps an escaped backslash from becoming a line break', () => {
    const source = 'a\\\\nb\\nc\\nd\\ne';
    const result = repair(source);
    assert.match(result.text, /a\\nb/);
  });

  it('strips transport fragments but keeps the prose they carried', () => {
    const source =
      '# Report\n\n{"type":"text","text":"The first finding."}\n\n' +
      '{"index":0,"delta":{"text":"The second finding."}}\n';
    const result = repair(source);
    assert.match(result.text, /The first finding\./);
    assert.match(result.text, /The second finding\./);
    assert.doesNotMatch(result.text, /"type"/);
    assert.ok(result.applied.some((issue) => issue.id === 'json-fragments'));
  });

  it('leaves JSON inside a fenced code block untouched', () => {
    const source = '# API\n\n```json\n{"type":"text","text":"keep me"}\n```\n';
    assert.equal(repair(source).text, source);
    assert.deepEqual(diagnose(source), []);
  });

  it('leaves JSON in an inline code span untouched', () => {
    const source = '# API\n\nSend `{"type":"ping"}` to the server.\n';
    assert.equal(repair(source).text, source);
  });

  it('splits one long blob back into blocks', () => {
    const source =
      `# Title ${'Filler prose to push this line past the blob threshold. '.repeat(8)}` +
      '## Section one - first item - second item ## Section two More text.';
    const result = repair(source);
    const lines = result.text.split('\n');
    assert.ok(lines.some((line) => line === '## Section one'));
    assert.ok(lines.some((line) => line === '- first item'));
    assert.ok(lines.some((line) => line === '- second item'));
    assert.ok(lines.some((line) => line.startsWith('## Section two')));
    assert.ok(result.applied.some((issue) => issue.id === 'single-blob'));
  });

  it('keeps a heading run intact when the title/body boundary is unrecoverable', () => {
    // Once the newline is gone, `## Notes Body text.` reads identically whether
    // the heading was "Notes" or the whole run. Guessing would be worse than
    // leaving one line for a person to break, so the run stays on the heading.
    const source =
      `Prose. ${'Filler to push this past the blob threshold. '.repeat(10)}` +
      '## Notes Body text follows here.';
    const result = repair(source);
    assert.ok(result.text.split('\n').some((line) => line === '## Notes Body text follows here.'));
  });

  it('does not reblock an ordinary paragraph that contains a dash', () => {
    const source = '# Title\n\nA well - known example, nothing to fix here.\n';
    assert.equal(repair(source).text, source);
  });

  it('gives headings room to breathe', () => {
    const source = '# One\nText immediately under.\n## Two\nMore text.\n';
    const result = repair(source);
    assert.equal(result.text, '# One\n\nText immediately under.\n\n## Two\n\nMore text.\n');
  });

  it('preserves frontmatter exactly', () => {
    const source = '---\ntitle: Kept\ntags: a, b\n---\n# Body\\n\\nText.\\n';
    const result = repair(source);
    assert.ok(result.text.startsWith('---\ntitle: Kept\ntags: a, b\n---\n'));
    assert.match(result.text, /# Body\n\nText\./);
  });

  it('handles the full Copilot failure: JSON envelope, escapes and fragments at once', () => {
    const source = JSON.stringify({
      id: 'msg_1',
      model: 'some-model',
      content: [
        { type: 'text', text: '# Weekly notes\\n\\n## Monday\\n\\n- shipped the thing\\n' },
      ],
    });
    const result = repair(source);
    assert.match(result.text, /^# Weekly notes\n/);
    assert.match(result.text, /^## Monday$/m);
    assert.match(result.text, /^- shipped the thing$/m);
    assert.doesNotMatch(result.text, /msg_1|some-model/);
  });

  it('is idempotent — repairing a repaired file changes nothing', () => {
    const source = JSON.stringify({ content: '# T\\n\\nA.\\n\\n- x\\n- y\\n' });
    const once = repair(source).text;
    const twice = repair(once);
    assert.equal(twice.text, once);
    assert.deepEqual(twice.applied, []);
  });

  it('reports nothing for an empty file', () => {
    assert.deepEqual(diagnose(''), []);
    assert.deepEqual(diagnose('   \n'), []);
  });
});
