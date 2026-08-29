# Markdown Machine

A browser app for writing and reading markdown files that live in a real folder on your
disk. Nothing is uploaded and nothing is copied — it reads and writes the files where they
already are.

## Status

M0–M4 are done — the whole plan has shipped. Open a folder, browse it, and edit notes in a
split view with a scroll-synced live preview. Changes are written back to the real files:
autosave shortly after you stop typing, or `Ctrl`/`Cmd`+`S` to save now. New, rename and
delete live in the sidebar.

If a note changes on disk while you have it open, the save is refused rather than
overwriting it, and you are asked which side to keep. The status bar always says where
things stand, and Revert takes a file back to how it was when you opened it.

See [docs/PLAN.md](docs/PLAN.md) for the design, the milestones, and what was deliberately
left out.

## Shortcuts

| | |
|---|---|
| Bold | `Mod`+`B` |
| Italic | `Mod`+`I` |
| Inline code | `Mod`+`E` |
| Link | `Mod`+`K` |
| Cycle heading level | `Mod`+`⇧`+`H` |
| Bullet list | `Mod`+`⇧`+`L` |
| Save now | `Mod`+`S` |

`Mod` is `⌘` on a Mac and `Ctrl` elsewhere. The same list shows in the app whenever no note
is open.

## Live

<https://zstoimenov.github.io/Markdown-machine/>

Deployed from `main` by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every
push, and manually from any branch via the Actions tab.

Hosting the app publicly does not make your notes public. The page reads and writes files
directly in your browser through the File System Access API — nothing is uploaded, and there
is no server to upload to. The folder you pick is remembered per origin, so the hosted app
and a local `npm run dev` keep separate ones.

## Requirements

A Chromium-based desktop browser — Chrome, Edge, Brave, Arc or Opera. Folder access uses
the File System Access API, which Firefox and Safari have not shipped.

Those browsers get a fallback rather than a dead end: drop in a single `.md` file, read and
edit it, and download a copy. It cannot save in place, because the browser gives no handle
to write back through — which is the whole reason the folder version is the real one.

## Running it

```sh
npm install
npm run dev
```

Then open the printed URL and choose a folder of markdown files.

`npm run build` typechecks and produces a static bundle in `dist/`.

## Development

The native folder picker can't be scripted, so `/dev-fixture.html` (dev server only) mounts
the real app against an in-memory vault — useful for working on the tree, the renderer or
the styling without clicking through a picker each reload.

`scripts/smoke.mjs` drives that fixture in a real browser and checks the read and edit paths
end to end. Playwright is not a dependency, since installing it pulls a browser download, so
run it on demand:

```sh
npm install --no-save playwright && npx playwright install chromium
npm run dev                     # in another terminal
node scripts/smoke.mjs
```
