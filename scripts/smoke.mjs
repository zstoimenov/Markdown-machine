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
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });

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

console.log(problems.length ? '\nBrowser problems:\n' + problems.join('\n') : '\nNo console or page errors.');
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
await browser.close();
process.exit(failures ? 1 : 0);
