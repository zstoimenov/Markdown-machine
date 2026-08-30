/**
 * The app icon, drawn rather than drawn *in* something.
 *
 * The mark is the split view: a rounded tile divided down the middle, paper on
 * the left where the source is and ink on the right where the rendering is, with
 * one monospace `#` laid across the seam taking the opposite colour on each side.
 * It says what the app is — markdown, and the two views of it — in a shape that
 * still reads at 48px on a home screen, and it belongs to nobody else.
 *
 * Geometry lives here rather than in a checked-in drawing so there is one source
 * for every size: the SVG the browser uses as a favicon, the PNGs a home screen
 * wants, and the maskable variant Android crops to whatever shape it likes.
 *
 * Playwright is deliberately not a dependency of this project — the outputs are
 * committed, so this only runs when the mark itself changes:
 *
 *   npm install --no-save playwright
 *   node scripts/icons.mjs
 *
 * Set CHROMIUM to point at an existing browser binary to skip the download.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const PAPER = '#fdfdfc';
const INK = '#2f6f4f';
const OUT = new URL('../public/', import.meta.url);

/**
 * Four strokes on a 512 grid, centred on (256, 256). The verticals lean the way
 * a typeface's do — a hash drawn with square uprights reads as a window frame.
 * Round caps keep it in the same family as the app's 6px corners.
 */
const STROKES = [
  [222, 132, 180, 380],
  [332, 132, 290, 380],
  [130, 202, 382, 202],
  [130, 310, 382, 310],
];

function hash(scale) {
  const lines = STROKES.map(
    ([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`,
  ).join('');
  // Scaled about the centre, so the seam stays under the middle of the tile
  // whatever size the mark is drawn at.
  return `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)" fill="none" stroke-width="41" stroke-linecap="round">${lines}</g>`;
}

/**
 * `radius` rounds the tile; 0 is full-bleed, for the variants the platform masks
 * itself. `scale` sizes the mark inside it — smaller where a launcher may crop
 * to a circle, larger where the tile is shown as drawn.
 */
function icon({ radius, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Markdown Machine">
  <defs>
    <clipPath id="tile"><rect width="512" height="512" rx="${radius}"/></clipPath>
    <clipPath id="source"><rect width="256" height="512"/></clipPath>
    <clipPath id="rendered"><rect x="256" width="256" height="512"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="${PAPER}"/>
    <rect x="256" width="256" height="512" fill="${INK}"/>
    <g clip-path="url(#source)" stroke="${INK}">${hash(scale)}</g>
    <g clip-path="url(#rendered)" stroke="${PAPER}">${hash(scale)}</g>
  </g>
</svg>
`;
}

// The tile as it is shown when nothing masks it: rounded, mark filling it.
const TILE = icon({ radius: 96, scale: 0.94 });
// Android crops a maskable icon to whatever shape the launcher prefers, so the
// tile goes edge to edge and the mark pulls well inside the safe circle.
const MASKABLE = icon({ radius: 0, scale: 0.8 });
// iOS rounds the corners itself and dislikes transparency, so it gets a square.
const APPLE = icon({ radius: 0, scale: 0.86 });

const PNGS = [
  ['icon-192.png', TILE, 192],
  ['icon-512.png', TILE, 512],
  ['icon-maskable-512.png', MASKABLE, 512],
  ['apple-touch-icon.png', APPLE, 180],
];

await mkdir(OUT, { recursive: true });
await writeFile(new URL('icon.svg', OUT), TILE);

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await browser.newPage();

for (const [name, source, size] of PNGS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:none}svg{display:block;width:100vw;height:100vh}</style>${source}`,
  );
  await page.screenshot({ path: new URL(name, OUT).pathname, omitBackground: true });
  console.log(`${name}  ${size}×${size}`);
}

await browser.close();
console.log('icon.svg');
