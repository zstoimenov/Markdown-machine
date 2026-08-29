# Markdown Machine

A browser app for writing and reading markdown files that live in a real folder on your
disk. Nothing is uploaded and nothing is copied — it reads and writes the files where they
already are.

## Status

M0 (scaffold) and M1 (reading) are done: open a folder, browse it, read rendered notes.
Editing arrives in M2. See [docs/PLAN.md](docs/PLAN.md) for the plan and the milestones.

## Requirements

A Chromium-based desktop browser — Chrome, Edge, Brave, Arc or Opera. Folder access uses
the File System Access API, which Firefox and Safari have not shipped. The app says so
plainly rather than failing oddly if you open it elsewhere.

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
