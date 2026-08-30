/**
 * Smoke test for the read and write paths, driven through dev-fixture.html.
 *
 * Playwright is deliberately not a dependency of this project — installing it
 * pulls a browser download that everyone else would pay for. To run this:
 *
 *   npm install --no-save playwright
 *   npx playwright install chromium
 *   npm run dev            # in another terminal
 *   node scripts/smoke.mjs
 *
 * Set CHROMIUM to point at an existing browser binary to skip the download.
 */
import { chromium } from 'playwright';

const SP = process.env.SHOTS ?? '.';
const BASE = process.env.BASE ?? 'http://localhost:5173';

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await context.newPage();

const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail && !ok ? `  (${detail})` : ''}`);
};

await page.goto(`${BASE}/dev-fixture.html`, { waitUntil: 'networkidle' });

// ---------- M1 regressions ----------
await page.getByRole('button', { name: 'Welcome.md' }).click();
await page.waitForSelector('.prose h1');
check('M1: preview still renders', (await page.locator('.prose table tbody tr').count()) === 2);
check('M1: images still resolve', (await page.locator('.prose img').first().getAttribute('src') || '').startsWith('blob:'));

// ---------- Editor ----------
// The editor is a lazy chunk, so it arrives a beat after the preview does —
// asserting immediately races the Suspense fallback rather than the app.
await page.waitForSelector('.cm-editor');
check('editor mounts alongside the preview', await page.locator('.cm-editor').isVisible());
check('markdown syntax is highlighted', (await page.locator('.cm-content .tok-heading, .cm-content [class*=ͼ]').count()) > 0);

// The first line of this note is frontmatter, so target the heading itself.
const headingLine = page.locator('.cm-line').filter({ hasText: /^# Welcome$/ }).first();
await headingLine.click();
await page.keyboard.press('End');
await page.keyboard.type(' EDITED');
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent?.includes('EDITED'));
check('typing flows through to the live preview', true);
check('dirty state reaches the status bar', (await page.locator('.status-save').innerText()).includes('unsaved'));

// Undo history survives a re-render triggered by the keystroke itself.
await page.keyboard.press('Control+z');
await page.waitForFunction(() => !document.querySelector('.prose h1')?.textContent?.includes('EDITED'));
check('undo history survives the render cycle', true);
await page.screenshot({ path: `${SP}/smoke-split.png` });

// ---------- View modes ----------
await page.getByRole('button', { name: 'Read' }).click();
check('read mode hides the editor', (await page.locator('.cm-editor').count()) === 0);
await page.getByRole('button', { name: 'Write' }).click();
check('write mode hides the preview', (await page.locator('.pane-preview').count()) === 0);
await page.getByRole('button', { name: 'Split' }).click();
check('split mode restores both panes', (await page.locator('.cm-editor').count()) === 1 && (await page.locator('.pane-preview').count()) === 1);

// ---------- Divider ----------
const widthBefore = (await page.locator('.pane-editor').boundingBox()).width;
const divider = await page.locator('.divider').boundingBox();
await page.mouse.move(divider.x + 2, divider.y + 300);
await page.mouse.down();
await page.mouse.move(divider.x - 200, divider.y + 300, { steps: 10 });
await page.mouse.up();
const widthAfter = (await page.locator('.pane-editor').boundingBox()).width;
check('divider resizes the panes', widthAfter < widthBefore - 150, `${widthBefore} -> ${widthAfter}`);
await page.locator('.divider').dblclick();
check('double-click resets the split', Math.abs((await page.locator('.pane-editor').boundingBox()).width - widthBefore) < 2);

// ---------- Scroll sync ----------
await page.getByRole('button', { name: 'Long.md' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'Scroll sync');
await page.waitForTimeout(300);

// Reads whichever block is visually at the top of a pane — black-box, no internals.
const topLineOf = (selector) =>
  page.evaluate((sel) => {
    const pane = document.querySelector(sel);
    const box = pane.getBoundingClientRect();
    const el = document.elementFromPoint(box.left + 40, box.top + 6);
    return el?.closest('.cm-line, [data-line]')?.textContent?.trim().slice(0, 40) ?? '';
  }, selector);

async function previewToEditor(sectionText) {
  await page.evaluate((text) => {
    const pane = document.querySelector('.pane-preview');
    const heading = [...pane.querySelectorAll('h2')].find((h) => h.textContent.trim() === text);
    pane.scrollTop += heading.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  }, sectionText);
  await page.waitForTimeout(250);
  return topLineOf('.pane-editor');
}

for (const section of ['Section 4', 'Section 7']) {
  const editorTop = await previewToEditor(section);
  check(`preview → editor lands on "${section}"`, editorTop.includes(section), `editor top: "${editorTop}"`);
}

// Now the other direction, from a pane the sync is not already parked on.
await page.evaluate(() => { document.querySelector('.pane-editor .cm-scroller').scrollTop = 0; });
await page.waitForTimeout(250);
await page.evaluate(() => {
  const scroller = document.querySelector('.pane-editor .cm-scroller');
  scroller.scrollTop = scroller.scrollHeight * 0.45;
});
await page.waitForTimeout(300);
const eTop = await topLineOf('.pane-editor');
const pTop = await topLineOf('.pane-preview');
const section = (eTop.match(/Section \d/) ?? [])[0];
check('editor → preview keeps the panes on the same block', Boolean(section) && pTop.includes(section), `editor "${eTop}" vs preview "${pTop}"`);
await page.screenshot({ path: `${SP}/smoke-scrollsync.png` });

// ---------- Guard ----------
await page.getByRole('button', { name: 'Welcome.md' }).click();
await page.waitForSelector('.prose h1');
await page.locator('.cm-line').first().click();
await page.keyboard.type('x');
await page.waitForFunction(() => document.querySelector('.status-save')?.textContent?.includes('unsaved'));
page.once('dialog', (d) => d.dismiss());
await page.getByRole('button', { name: 'Long.md' }).click();
await page.waitForTimeout(200);
check('leaving a modified note asks first, and staying works', (await page.locator('.status-path').innerText()) === 'Welcome.md');

// ---------- M3: writing to the vault ----------
const fileText = (path) => page.evaluate((p) => window.mmFixture.read(p), path);
const fileList = () => page.evaluate(() => window.mmFixture.list());
const waitForSaved = () =>
  page.waitForFunction(() => /^saved/.test(document.querySelector('.status-save')?.textContent ?? ''));

// Reset to a clean note; the guard test above left Welcome.md modified.
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Long.md' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'Scroll sync');
await page.getByRole('button', { name: 'Welcome.md' }).click();
await page.waitForSelector('.prose h1');

// Autosave
await page.locator('.cm-line').filter({ hasText: /^# Welcome$/ }).first().click();
await page.keyboard.press('End');
await page.keyboard.type(' Autosaved');
check('typing marks the note unsaved', (await page.locator('.status-save').innerText()).includes('unsaved'));
await waitForSaved();
check('autosave writes the buffer to the vault', (await fileText('Welcome.md')).includes('# Welcome Autosaved'));

// Explicit save
await page.keyboard.type(' Twice');
await page.keyboard.press('Control+s');
await waitForSaved();
check('Ctrl+S saves immediately', (await fileText('Welcome.md')).includes('# Welcome Autosaved Twice'));

// Revert restores the file as it stood when the note was opened, and saves that.
await page.getByRole('button', { name: 'Revert' }).click();
await waitForSaved();
check('revert restores the file as it was opened', (await fileText('Welcome.md')).includes('# Welcome\n'));
check('revert clears its own affordance', (await page.getByRole('button', { name: 'Revert' }).count()) === 0);
check('revert reaches the editor, not just the store', !(await page.locator('.cm-content').innerText()).includes('Autosaved'));

// Conflict: something else writes the file after we read it.
await page.evaluate(() => window.mmFixture.touch('Welcome.md', '# Changed by somebody else\n'));
await page.locator('.cm-line').first().click();
await page.keyboard.type('x');
await page.waitForSelector('.conflict');
check('a file changed underneath us stops autosave', (await fileText('Welcome.md')) === '# Changed by somebody else\n');
await page.screenshot({ path: `${SP}/smoke-conflict.png` });
await page.waitForTimeout(1200);
check('autosave stays stopped while the conflict stands', (await fileText('Welcome.md')) === '# Changed by somebody else\n');

await page.getByRole('button', { name: /Discard mine/ }).click();
await page.waitForFunction(() => document.querySelector('.conflict') === null);
check('reloading from disk takes the other side', (await page.locator('.cm-content').innerText()).includes('Changed by somebody else'));
// The pre-conflict snapshot must not survive the reload, or Revert would undo
// the other program's changes that were just deliberately kept.
check('reloading drops the stale revert snapshot', (await page.getByRole('button', { name: 'Revert' }).count()) === 0);

// And the overwrite branch of the same choice.
await page.evaluate(() => window.mmFixture.touch('Welcome.md', '# Changed again\n'));
await page.locator('.cm-line').first().click();
await page.keyboard.press('End');
await page.keyboard.type(' MINE');
await page.waitForSelector('.conflict');
await page.getByRole('button', { name: /Keep mine/ }).click();
await waitForSaved();
check('overwriting takes our side', (await fileText('Welcome.md')).includes('MINE'));

// Create
page.once('dialog', (d) => d.accept('Fresh note'));
await page.getByRole('button', { name: 'New note' }).click();
await page.waitForFunction(() => document.querySelector('.status-path')?.textContent === 'Fresh note.md');
check('a new note is created with a .md extension added', (await fileList()).includes('Fresh note.md'));
check('the new note opens', await page.getByRole('button', { name: 'Fresh note.md' }).isVisible());

// Create over an existing name is refused rather than clobbering.
page.once('dialog', (d) => d.accept('Welcome.md'));
await page.getByRole('button', { name: 'New note' }).click();
await page.waitForSelector('.status .is-warn');
check('creating over an existing note is refused', (await fileText('Welcome.md')).includes('MINE'));

// Rename
await page.getByRole('button', { name: 'Fresh note.md' }).click();
await page.waitForTimeout(150);
page.once('dialog', (d) => d.accept('Renamed note.md'));
await page.getByRole('button', { name: 'Rename' }).click();
await page.waitForFunction(() => document.querySelector('.status-path')?.textContent === 'Renamed note.md');
const afterRename = await fileList();
check('rename moves the file', afterRename.includes('Renamed note.md') && !afterRename.includes('Fresh note.md'));

// Delete, declined then accepted.
page.once('dialog', (d) => d.dismiss());
await page.getByRole('button', { name: 'Delete' }).click();
await page.waitForTimeout(150);
check('declining the delete confirm keeps the file', (await fileList()).includes('Renamed note.md'));
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'Delete' }).click();
await page.waitForFunction(() => document.querySelector('.status-path') === null);
check('confirming the delete removes the file', !(await fileList()).includes('Renamed note.md'));

await page.screenshot({ path: `${SP}/smoke-write.png` });

// ---------- M4: formatting, reader mode, fallback ----------

// The delete above left nothing open, which is when the shortcut sheet shows.
check('the empty state lists the shortcuts', (await page.locator('.shortcuts kbd').count()) >= 7);

await page.getByRole('button', { name: 'Format.md' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'Format');

const formatLine = () =>
  page.evaluate(
    () => [...document.querySelectorAll('.cm-line')].find((l) => /table/.test(l.textContent))?.textContent,
  );

// Select "table" with real keystrokes rather than by poking at the DOM selection.
await page.locator('.cm-line').filter({ hasText: '## A table' }).first().click();
await page.keyboard.press('End');
for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');

await page.keyboard.press('Control+b');
check('bold wraps the selection', (await formatLine()) === '## A **table**', await formatLine());
await page.keyboard.press('Control+b');
check('bold toggles back off', (await formatLine()) === '## A table', await formatLine());

await page.keyboard.press('Control+i');
check('italic wraps the same selection', (await formatLine()) === '## A *table*', await formatLine());
await page.keyboard.press('Control+i');

// Heading cycles from wherever the line currently sits: 2 -> 3 -> off.
await page.keyboard.press('Home');
await page.keyboard.press('Control+Shift+h');
check('heading cycles past its current level', (await formatLine()) === '### A table', await formatLine());
await page.keyboard.press('Control+Shift+h');
check('heading cycles off at the end', (await formatLine()) === 'A table', await formatLine());

await page.keyboard.press('Control+k');
check('link inserts a skeleton at the cursor', (await formatLine()) === '[]()A table', await formatLine());

await page.keyboard.press('Control+Shift+l');
check('bullet list prefixes the line', (await formatLine())?.startsWith('- '), await formatLine());
await page.keyboard.press('Control+Shift+l');
check('bullet list toggles back off', !(await formatLine())?.startsWith('- '), await formatLine());

// Reader mode gets its own measure.
await page.getByRole('button', { name: 'Read' }).click();
check('reader mode restyles the preview', await page.locator('.pane-preview.is-reader').isVisible());
const readerSize = await page.evaluate(() => getComputedStyle(document.querySelector('.is-reader .prose')).fontSize);
check('reader mode enlarges the type', readerSize === '18px', readerSize);
await page.screenshot({ path: `${SP}/smoke-reader.png` });
await page.getByRole('button', { name: 'Split' }).click();

// ---------- Fallback for browsers without folder access ----------
const fallback = await browser.newPage({ viewport: { width: 1100, height: 800 } });
// Hide the API before any app code runs — what Firefox and Safari look like.
await fallback.addInitScript(() => {
  delete window.showDirectoryPicker;
});
await fallback.goto(`${BASE}/`, { waitUntil: 'networkidle' });
check('unsupported browsers get the explanation', (await fallback.locator('.splash-card h1').innerText()).includes('open folders'));
check('and are still offered a single file', await fallback.locator('.dropzone').isVisible());

await fallback.setInputFiles('input[type=file]', {
  name: 'Dropped.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('# Dropped\n\nRead-only, but readable.\n'),
});
await fallback.waitForSelector('.prose h1');
check('a loose file opens and renders', (await fallback.locator('.prose h1').innerText()) === 'Dropped');
check('the fallback explains itself', (await fallback.locator('.notice').innerText()).includes('read-only'));
check('the fallback offers a download instead of a save', await fallback.getByRole('button', { name: 'Download' }).isVisible());
check('no folder actions are offered', (await fallback.getByRole('button', { name: 'New note' }).count()) === 0);
await fallback.screenshot({ path: `${SP}/smoke-fallback.png` });
await fallback.close();

// ---------- Repairing damaged markdown ----------
await page.getByRole('button', { name: 'Broken.md' }).click();
await page.waitForSelector('.notice-repair');
check('a damaged file is spotted on open', (await page.locator('.notice-repair').innerText()).includes('looks damaged'));
check('and the offer says what it would do', (await page.locator('.notice-repair').innerText()).includes('JSON'));
await page.screenshot({ path: `${SP}/smoke-repair.png` });

await page.getByRole('button', { name: 'Fix markdown' }).first().click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'Broken note');
const repaired = await page.locator('.cm-content').innerText();
check('the JSON envelope is gone', !repaired.includes('msg_01') && !repaired.includes('assistant'));
check('escaped newlines became real ones', repaired.split('\n').length > 5);
check('the embedded fragment kept its prose', repaired.includes('The first finding.'));
check('and lost its JSON', !repaired.includes('"type"'));
check('the preview now renders structure', (await page.locator('.prose h2').innerText()) === 'Findings');
check('list items survived', (await page.locator('.prose li').count()) === 2);
check('the offer clears once taken', (await page.locator('.notice-repair').count()) === 0);

// A repair is one transaction, so one undo takes all of it back.
await page.locator('.cm-content').click();
await page.keyboard.press('Control+z');
check('a single undo reverses the whole repair', (await page.locator('.cm-content').innerText()).includes('msg_01'));
await page.keyboard.press('Control+y');
// Let autosave settle, or switching files hits the unsaved-changes confirm.
await waitForSaved();

// A healthy file is never flagged.
await page.getByRole('button', { name: 'Long.md' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'Scroll sync');
check('a healthy file is left alone', (await page.locator('.notice-repair').count()) === 0);

// ---------- Symbols counter and copy ----------
await page.getByRole('button', { name: 'Format.md' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'Format');

const statusText = async () => (await page.locator('.status').innerText()).replace(/\s+/g, ' ');
check('the status bar counts symbols', /\d+ symbols/.test(await statusText()));

const symbolsNow = async () =>
  Number((await statusText()).match(/([\d,]+) symbols/)[1].replace(/,/g, ''));
const before = await symbolsNow();
await page.locator('.cm-line').first().click();
await page.keyboard.press('End');
await page.keyboard.type('12345');
await page.waitForFunction((n) => {
  const m = document.querySelector('.status')?.textContent?.match(/([\d,]+) symbols/);
  return m && Number(m[1].replace(/,/g, '')) === n + 5;
}, before);
check('the symbol count tracks typing', true);
await waitForSaved();

// Clipboard reads need permission; grant it so the copy can be verified.
await context.grantPermissions(['clipboard-read', 'clipboard-write']);

await page.getByRole('button', { name: 'Copy', exact: true }).click();
await page.waitForSelector('.copy-menu');
check('the copy menu offers exactly two options', (await page.locator('.copy-menu button').count()) === 2);
check('and what each one would cost, before choosing', /Markdown source[\s\S]*\d+ symbols[\s\S]*Text for pasting[\s\S]*\d+ symbols/.test(await page.locator('.copy-menu').innerText()), await page.locator('.copy-menu').innerText());
await page.screenshot({ path: `${SP}/smoke-copy.png` });

await page.getByRole('menuitem', { name: 'Text for pasting' }).click();
await page.waitForSelector('.copy-message');
const pasteClip = await page.evaluate(() => navigator.clipboard.readText());
check('pasteable text drops the heading hashes', pasteClip.startsWith('FORMAT12345'), pasteClip.slice(0, 30));
check('and carries no markdown markers at all', !/\*\*|`|^#/m.test(pasteClip), pasteClip.slice(0, 60));
check('and no Unicode look-alikes', !/[\u{1D400}-\u{1D7FF}]/u.test(pasteClip));
check('the confirmation reports the symbol count', (await page.locator('.copy-message').innerText()).includes('Copied'));

// Structure has to survive the markers being removed.
await page.evaluate(() =>
  window.mmFixture.touch(
    'Format.md',
    '# T\n\n**Bold** intro.\n\n- one\n  - nested\n\n1. first\n\n> quoted\n\n```js\nconst a = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[docs](https://example.com)\n',
  ),
);
await page.getByRole('button', { name: 'Welcome.md' }).click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Format.md' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'T');

await page.getByRole('button', { name: 'Copy', exact: true }).click();
await page.getByRole('menuitem', { name: 'Text for pasting' }).click();
await page.waitForSelector('.copy-message');
const plain = await page.evaluate(() => navigator.clipboard.readText());
check('the heading is uppercased, not hashed', plain.startsWith('T\n'));
check('emphasis markers are gone but the word stays', plain.includes('Bold intro.'));
check('bullets become bullet characters', plain.includes('• one'));
check('nesting reads as nesting', plain.includes('  ◦ nested'));
check('numbering survives', plain.includes('1. first'));
check('quotes keep their prefix', plain.includes('> quoted'));
check('code keeps its fence and its language', plain.includes('```js\nconst a = 1;\n```'), plain);
check('tables line up and rule off their header', plain.includes('A   | B\n--- | ---\n1   | 2'), plain);
check('link targets are written out', plain.includes('docs (https://example.com)'));

// Markdown source is the buffer verbatim, markers and all.
await page.getByRole('button', { name: 'Copy', exact: true }).click();
await page.getByRole('menuitem', { name: 'Markdown source' }).click();
await page.waitForSelector('.copy-message');
const rawClip = await page.evaluate(() => navigator.clipboard.readText());
check('markdown source is copied byte for byte', rawClip === (await page.evaluate(() => window.mmFixture.read('Format.md'))), rawClip.slice(0, 30));
check('so it still carries the markers', rawClip.includes('**Bold**') && rawClip.includes('```js'));

// ---------- Plain text to markdown ----------
await page.getByRole('button', { name: 'Plain.md' }).click();
await page.waitForFunction(() => document.querySelector('.status-path')?.textContent === 'Plain.md');
check('a plain-text note is offered the conversion', await page.getByRole('button', { name: 'Plain → markdown' }).isEnabled());

await page.getByRole('button', { name: 'Plain → markdown' }).click();
await page.waitForFunction(() => document.querySelector('.prose h1')?.textContent === 'PROJECT NOTES');
const converted = await page.locator('.cm-content').innerText();
check('the shouted line became a heading', converted.includes('# PROJECT NOTES'));
check('the drawn bullets became a list, nested', converted.includes('- first thing') && converted.includes('  - a detail under it'));
check('the divider became a rule', converted.includes('---'));
check('the labelled URL became a link', converted.includes('[See the handbook](https://example.com)'));
check('the indented block was fenced', converted.includes('```'));
check('the preview agrees', (await page.locator('.prose ul li').count()) >= 2);
await page.screenshot({ path: `${SP}/smoke-converted.png` });

// One undo takes the whole conversion back, which is what makes it safe to offer.
await page.locator('.cm-content').click();
await page.keyboard.press('Control+z');
await page.waitForFunction(() => !document.querySelector('.cm-content')?.textContent?.includes('# PROJECT NOTES'));
check('one undo takes the whole conversion back', (await page.locator('.cm-content').innerText()).includes('• first thing'));
check('the offer is not made twice', !(await page.getByRole('button', { name: 'Plain → markdown' }).isEnabled()));
// Let autosave settle, or leaving the note raises the unsaved-changes confirm.
await waitForSaved();

// ---------- Suggestions ----------
await page.getByRole('button', { name: 'Format.md' }).click();
await page.waitForFunction(() => document.querySelector('.status-path')?.textContent === 'Format.md');
const chips = () => page.locator('.suggest .chip').allInnerTexts();
const chip = (text) => page.locator('.suggest .chip').filter({ hasText: text }).first();

await page.locator('.cm-line').filter({ hasText: 'Bold' }).first().click();
await page.keyboard.press('End');
await page.keyboard.type(' with **open');
await page.waitForFunction(() => document.querySelector('.suggest .chip')?.textContent === '**');
check('an unclosed bold is the first thing offered', (await chips())[0] === '**');

await page.locator('.suggest .chip').first().click();
check('the chip closes it', (await page.locator('.cm-content').innerText()).includes('**open**'));
check('and hands the cursor back to the editor', await page.evaluate(() => document.activeElement?.closest('.cm-editor') !== null));

// An empty line is where the block markers belong.
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await page.waitForFunction(() => [...document.querySelectorAll('.suggest .chip')].some((c) => c.textContent === '| Table'));
check('an empty line offers the blocks', (await chips()).includes('## Heading'));
await page.screenshot({ path: `${SP}/smoke-suggest.png` });

const tablesBefore = await page.locator('.prose table').count();
await chip('| Table').click();
check('the table chip writes a whole skeleton', (await page.locator('.cm-content').innerText()).includes('| --- | --- |'));
await page.waitForFunction((n) => document.querySelectorAll('.prose table').length > n, tablesBefore);
check('and the preview renders it', true);

// Inside a fence there is nothing markdown can do, so nothing is offered.
await page.keyboard.press('Control+z');
await page.waitForFunction(() => [...document.querySelectorAll('.suggest .chip')].some((c) => c.textContent === '``` Code'));
await chip('``` Code').click();
await page.keyboard.type('const a = 1;');
await page.waitForFunction(() => document.querySelectorAll('.suggest .chip').length === 0);
check('typing inside a closed fence offers nothing', (await chips()).length === 0);

// The row can be got out of the way.
await page.getByRole('button', { name: 'Hide suggestions' }).click();
check('the suggestion row can be hidden', (await page.locator('.suggest .chip').count()) === 0);
await page.getByRole('button', { name: 'Show suggestions' }).click();
check('and brought back', await page.locator('.suggest').isVisible());

// ---------- Converting a paste ----------
await waitForSaved();
await page.getByRole('button', { name: 'Long.md' }).click();
await page.waitForFunction(() => document.querySelector('.status-path')?.textContent === 'Long.md');
await page.locator('.cm-line').first().click();
await page.keyboard.press('Home');
await page.evaluate(() => navigator.clipboard.writeText('SHOPPING LIST\n\n\u2022 milk\n\u2022 eggs\n\u2022 a third thing\n'));
await page.keyboard.press('Control+v');
await page.waitForSelector('.notice-convert');
check('a plain-text paste offers to convert', (await page.locator('.notice-convert').innerText()).includes('looks like plain text'));
check('and says what it would do', (await page.locator('.notice-convert').innerText()).includes('headings'));
check('while leaving the paste exactly as it arrived', (await page.locator('.cm-content').innerText()).includes('\u2022 milk'));
await page.screenshot({ path: `${SP}/smoke-paste.png` });

await page.getByRole('button', { name: 'Convert', exact: true }).click();
const pasted = await page.locator('.cm-content').innerText();
check('converting rewrites just the pasted range', pasted.includes('# SHOPPING LIST') && pasted.includes('- milk'), pasted.slice(0, 60));
check('and leaves the rest of the note alone', pasted.includes('Scroll sync'));
check('the offer goes once it is taken', (await page.locator('.notice-convert').count()) === 0);

await page.keyboard.press('Control+z');
check('one undo takes the conversion back to the paste', (await page.locator('.cm-content').innerText()).includes('\u2022 milk'));

// A paste that is markdown already is not second-guessed.
await page.evaluate(() => navigator.clipboard.writeText('## A heading\n\nWith **bold** in it and a `span`.\n'));
await page.keyboard.press('Control+v');
await page.waitForTimeout(200);
check('a markdown paste is left alone', (await page.locator('.notice-convert').count()) === 0);
check('and still lands in the document', (await page.locator('.cm-content').innerText()).includes('## A heading'));

// ---------- Phone layout (OnePlus 12) ----------
const phone = await browser.newPage({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 3.5,
  isMobile: true,
  hasTouch: true,
});
await phone.addInitScript(() => {
  // Chrome for Android has no File System Access API, so this is what the app
  // actually meets on the device — the folder path is not available there.
  delete window.showDirectoryPicker;
});
await phone.goto(`${BASE}/`, { waitUntil: 'networkidle' });
check('the phone gets the single-file path', await phone.locator('.dropzone').isVisible());
check('no horizontal overflow on the splash', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await phone.setInputFiles('input[type=file]', {
  name: 'Phone.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('# On the phone\n\nBody text.\n\n- one\n- two\n'),
});
await phone.waitForSelector('.prose h1');
check('a phone lands on the rendered note, not the source', (await phone.locator('.prose h1').innerText()) === 'On the phone');
check('no horizontal overflow with a note open', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('split view is not offered on a phone', (await phone.getByRole('button', { name: 'Split' }).count()) === 0);
check('the tree is a drawer, hidden until asked for', await phone.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).visibility) === 'hidden');

await phone.getByRole('button', { name: 'Notes' }).tap();
await phone.waitForFunction(() => getComputedStyle(document.querySelector('.sidebar')).visibility === 'visible');
check('the drawer opens on tap', true);
await phone.screenshot({ path: `${SP}/smoke-phone-drawer.png` });

await phone.locator('.tree-row', { hasText: 'Phone.md' }).tap();
await phone.waitForFunction(() => getComputedStyle(document.querySelector('.sidebar')).visibility === 'hidden');
check('choosing a note closes the drawer', true);

const targets = await phone.evaluate(() =>
  [...document.querySelectorAll('.toolbar button, .segment, .icon-button')]
    .map((el) => el.getBoundingClientRect().height)
    .filter((h) => h > 0),
);
check('toolbar targets are thumb-sized', Math.min(...targets) >= 30, `min ${Math.min(...targets)}px`);

await phone.getByRole('button', { name: 'Write' }).tap();
await phone.waitForSelector('.cm-scroller');
const editorFont = await phone.evaluate(() => getComputedStyle(document.querySelector('.cm-scroller')).fontSize);
check('the editor does not trigger zoom-on-focus', parseFloat(editorFont) >= 16, editorFont);
check('no horizontal overflow while editing', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

// Everything occasional is behind one button, and it comes up from the bottom
// where a thumb can reach it.
check('the toolbar keeps only what is used constantly', (await phone.locator('.toolbar .button').count()) === 0);
check('and names the note rather than the folder', (await phone.locator('.vault-name').innerText()) === 'Phone.md');

await phone.getByRole('button', { name: 'More' }).tap();
await phone.waitForSelector('.sheet');
const sheetBox = await phone.locator('.sheet').boundingBox();
check('the note menu opens from the bottom', sheetBox.y + sheetBox.height >= 900, JSON.stringify(sheetBox));
check('and does not push the page sideways', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check('it carries the copy forms', (await phone.locator('.sheet').innerText()).includes('Copy markdown source'));
check('and the note repairs', (await phone.locator('.sheet').innerText()).includes('Fix markdown'));
const rows = await phone.evaluate(() =>
  [...document.querySelectorAll('.sheet-group button')].map((el) => el.getBoundingClientRect().height),
);
check('every row is a thumb target', Math.min(...rows) >= 40, `min ${Math.min(...rows)}px`);
await phone.screenshot({ path: `${SP}/smoke-phone-menu.png` });

await phone.getByRole('menuitem', { name: /Copy text for pasting/ }).tap();
await phone.waitForSelector('.sheet-message');
check('copying from the sheet reports back', (await phone.locator('.sheet-message').innerText()).includes('Copied'));
// Tapped above the sheet, which is the part of the scrim a person can see.
await phone.getByRole('button', { name: 'Close menu' }).tap({ position: { x: 200, y: 60 } });
await phone.waitForFunction(() => document.querySelector('.sheet') === null);
check('the sheet closes on the scrim', true);

// Saving out. Where the platform has a share sheet — which on iOS is the only
// route back to the folder the note came from — the button goes through it
// rather than dropping a copy in Downloads.
await phone.evaluate(() => {
  window.__shared = [];
  const define = (name, value) =>
    Object.defineProperty(navigator, name, { configurable: true, value });
  define('canShare', (data) => Array.isArray(data?.files) && data.files.length > 0);
  define('share', async (data) => {
    window.__shared.push(data.files.map((file) => `${file.name}:${file.type}`));
  });
});
await phone.getByRole('button', { name: 'More' }).tap();
await phone.waitForSelector('.sheet');
check('the save is offered as the share sheet where there is one', (await phone.locator('.sheet').innerText()).includes('Save a copy'));
await phone.getByRole('menuitem', { name: /Save a copy/ }).tap();
await phone.waitForFunction(() => window.__shared.length > 0, null, { timeout: 5000 });
const shared = await phone.evaluate(() => window.__shared[0]);
check('and hands over the note under its own name', shared[0].startsWith('Phone.md:'), JSON.stringify(shared));
check('no download was started as well', (await phone.evaluate(() => window.__shared.length)) === 1);

// A software keyboard cannot be raised in a headless browser, so what is checked
// is the half that is ours: with one up, the status bar steps back and the
// suggestion row is the last thing above it.
await phone.locator('.cm-content').tap();
await phone.waitForSelector('.suggest .chip');
const beforeKeyboard = (await phone.locator('.suggest').boundingBox()).y;
await phone.evaluate(() => document.body.classList.add('is-keyboard'));
check('the status bar steps back for the keyboard', (await phone.locator('.status').count()) === 0 || !(await phone.locator('.status').isVisible()));
const afterKeyboard = (await phone.locator('.suggest').boundingBox()).y;
check('which leaves the suggestion row at the bottom', afterKeyboard > beforeKeyboard, `${beforeKeyboard} -> ${afterKeyboard}`);
await phone.screenshot({ path: `${SP}/smoke-phone-keyboard.png` });
await phone.evaluate(() => document.body.classList.remove('is-keyboard'));

// The app is sized from the visual viewport rather than from the window, which
// is what puts that row above the keys rather than under them.
await phone.evaluate(() => {
  document.documentElement.style.setProperty('--app-height', '500px');
});
const squeezed = await phone.locator('.suggest').boundingBox();
check('the shell follows the viewport it is given', squeezed.y + squeezed.height <= 502, JSON.stringify(squeezed));
await phone.evaluate(() => document.documentElement.style.removeProperty('--app-height'));

await phone.screenshot({ path: `${SP}/smoke-phone.png` });
await phone.close();

console.log(problems.length ? '\nBrowser problems:\n' + problems.join('\n') : '\nNo console or page errors.');
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
await browser.close();
process.exit(failures ? 1 : 0);
