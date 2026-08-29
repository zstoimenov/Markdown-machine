# Markdown Machine — Build Plan

A browser app for writing and reading markdown files that live in a real folder on your disk.

## 1. Decisions

| Decision | Choice |
|---|---|
| Platform | Browser web app (Vite + React + TypeScript) |
| Storage | A folder on your disk, via the File System Access API |
| Focus | Even split — writing and reading both first-class |
| Scope | Lean v1: open folder → browse → edit with live preview → save |

## 2. The one big constraint

The File System Access API (`showDirectoryPicker`) is what lets a web page read and
write a real folder with no server and no upload step. It ships in Chrome, Edge, Brave,
Opera and Arc on desktop. It does **not** exist in Firefox or Safari, and not on iOS at all.

So v1 targets Chromium desktop browsers as the real product, with a graceful
degradation path everywhere else:

- **Supported browser** — full read/write against your folder.
- **Unsupported browser** — drag-and-drop or file-picker opens a `.md` file read-only;
  editing is allowed but saving is a "download the file" fallback. A clear banner explains why.

If you'd rather have full read/write in every browser, that means adding a local Node
server (option 3 from the earlier question) — a bigger change, and better done as a
later backend swap than a v1 rewrite. Section 4 keeps that door open.

## 3. Architecture

```
src/
  main.tsx                 app entry
  App.tsx                  layout shell: sidebar | editor | preview
  fs/
    types.ts               VaultAdapter interface — the seam
    fsAccessAdapter.ts     File System Access API implementation
    downloadAdapter.ts     read-only + download fallback
    handleStore.ts         persist the directory handle in IndexedDB
  state/
    vaultStore.ts          file tree, active file, dirty flag, save status
  components/
    FileTree.tsx           recursive folder/file list, .md filter
    Editor.tsx             CodeMirror 6 instance
    Preview.tsx            rendered HTML, sanitized
    Toolbar.tsx            open folder, save state, view mode toggle
    StatusBar.tsx          path, word count, saved/unsaved
  markdown/
    render.ts              markdown-it + GFM + highlight + DOMPurify
  hooks/
    useAutosave.ts         debounced write + Ctrl/Cmd+S
    useScrollSync.ts       proportional editor↔preview scroll linking
```

**The seam that matters** is `VaultAdapter`:

```ts
interface VaultAdapter {
  readonly name: string;
  listDir(path: string): Promise<TreeEntry[]>;   // lazy: immediate children only
  readFile(path: string): Promise<string>;
  readBinary(path: string): Promise<Blob>;       // images referenced from a note
}
```

Every component talks to this interface, never to the browser API directly. Swapping in
a local server, a git backend or cloud sync later means writing one new adapter and
changing one line — no UI churn.

Two things changed from the first sketch of this interface, both while building M1:

- `listTree()` became `listDir(path)`. A single whole-tree walk contradicts the
  lazy-loading answer to the large-vault risk below; directories are now read on expand
  and cached.
- `writeFile` / `createFile` / `renameFile` / `deleteFile` are **not declared yet**. They
  arrive in M3 together with the dirty-state tracking, the confirm-before-destructive
  guard and the undo buffer that make writing to real files safe. Declaring them early,
  as unimplemented stubs, would only invite calling them.

## 4. Stack

| Concern | Pick | Why |
|---|---|---|
| Build | Vite + React 18 + TypeScript | Fast dev loop, no config ceremony |
| Editor | CodeMirror 6 (`@codemirror/lang-markdown`) | Real markdown syntax highlighting, small, extensible, good keymap support |
| Render | `markdown-it` + `markdown-it-anchor` | Fast, plugin-rich, CommonMark + GFM tables/strikethrough |
| Sanitize | `DOMPurify` | Local `.md` can contain raw HTML; render it, but never unsanitized |
| Code fences | `highlight.js` (common subset) | Syntax colour in preview without a big bundle |
| Handle persistence | `idb-keyval` | Directory handles are structured-cloneable; IndexedDB survives reload |
| State | Zustand | Small store, no boilerplate, no provider tree |
| Styling | Plain CSS with custom properties | Themeable light/dark without a framework dependency |

Deliberately not used in v1: a component library, a router, a state machine library, an
electron/tauri wrapper.

## 5. What v1 does

**Reading**
- Pick a folder; recursive tree of `.md` / `.markdown` files in a sidebar
- Click a file to open it
- Rendered preview: GFM tables, task lists, fenced code with highlighting, images
  resolved from relative paths in the vault
- Reader mode — hide the editor, full-width typography
- Light and dark theme, following the OS by default

**Writing**
- CodeMirror editor with markdown highlighting, soft wrap, line numbers off
- Split view with live preview, scroll-synced
- Autosave, debounced ~800ms after you stop typing, plus explicit `Ctrl/Cmd+S`
- Dirty indicator and a "saved 3s ago" status
- New file, rename, delete from the sidebar
- Shortcuts: bold `Cmd+B`, italic `Cmd+I`, link `Cmd+K`, heading cycle, list toggle
- Reopen the last folder automatically on load (one click to re-grant permission —
  the browser requires a gesture, this is not something the app can skip)

**Explicitly out of scope for v1** (the iterate list, roughly in the order I'd add them):
full-text search across the vault · command palette · `[[wiki-links]]` and backlinks ·
tags and frontmatter UI · table of contents pane · export to HTML/PDF · paste-image-to-file ·
multiple tabs · Mermaid and math · external-change watching · git integration

## 6. Milestones

| # | Milestone | Ships |
|---|---|---|
| M0 | Scaffold | ✅ Vite + TS + React building and running, CI-free, README updated |
| M1 | Read the vault | ✅ Open folder, persisted handle, file tree, click-to-read rendered preview |
| M2 | Edit | ✅ CodeMirror pane, split layout, scroll sync, live preview on keystroke |
| M3 | Write back | Autosave + `Cmd+S`, dirty state, new/rename/delete, unsaved-changes guard |
| — | *(M2 borrowed the guards)* | The confirm-on-leave and the reload warning landed early — an editor that cannot save must not lose work silently |
| M4 | Feel good | Themes, reader mode, formatting shortcuts, word count, empty/error states, fallback banner |

Each milestone is a working app, not a layer — M1 alone is already a usable markdown reader.

**M0, M1 and M2 are done.** What shipped beyond the milestone line, because it fell out of the
reading path naturally: relative-path images resolved through the adapter and shown as blob
URLs (with a visible notice when one is missing), links between notes navigating inside the
vault, a frontmatter metadata strip, light/dark themes driven off the OS, and a word count.

M2 added the editor: a CodeMirror 6 pane with markdown highlighting and soft wrap, a
resizable split against the live preview, a Write / Split / Read mode toggle, and scroll
sync built on markdown-it source maps as planned — each top-level block carries the source
line it came from, and the two panes interpolate between those anchors. Percentage scrolling
would have drifted apart on exactly the content this app is for; the fixture note is built
from tables and code fences specifically to prove it doesn't.

Since the native folder picker cannot be automated, `dev-fixture.html` mounts the real app
against an in-memory vault, and `scripts/smoke.mjs` drives it in Chromium. The read and edit
paths are covered end-to-end: tree, lazy directory expansion, GFM tables, task lists,
highlighted code, image resolution, internal-link navigation, both themes, live preview,
undo history, view modes, the divider, scroll sync in both directions, and the
unsaved-changes guard.

Two bugs it caught, both real rather than test artifacts:

- Suppressing pointer events page-wide during a divider drag changed what sat under the
  cursor mid-gesture, which broke double-click-to-reset. The divider now takes pointer
  capture instead, and needs no page-wide anything.
- Scrolling the editor to a given line assumed `lineBlockAt().top` shared an origin with
  `scrollTop`. It does not — the content carries padding. It now converts through
  `documentTop` and the viewport, assuming nothing about either.

## 7. Known issues

- **Bundle size.** CodeMirror took the production bundle from 464 kB to 977 kB
  (167 kB → 345 kB gzipped). Fine over localhost, heavy for a hosted build. M4 should
  lazy-load `highlight.js` languages and split the editor out of the initial chunk.
- **Editing is not saved.** M2 edits a buffer, nothing else. Leaving a modified note asks
  first, and reloading warns — but there is still no path to disk until M3, and the status
  bar says so rather than implying otherwise.
- **No syntax highlighting inside editor code fences.** `@codemirror/language-data` would
  add it, at the cost of a lazy chunk per language. Deferred until the bundle work above.

## 8. Risks and how they're handled

- **Permission re-grant on reload.** Browsers drop write permission between sessions.
  Handled with a single "Reopen `<folder>`" button on launch rather than a silent failure.
- **Large vaults.** A 5,000-file tree walked eagerly will stall. The tree lazy-loads
  directories on expand; only file metadata is held in memory, never contents.
- **Data loss.** Autosave writes to the real file. Before the first write to any file in a
  session the app keeps the original contents in memory for one-step undo, and the editor's
  own undo history is never cleared on save. No destructive operation (delete, rename over
  an existing file) happens without a confirm.
- **XSS from note content.** All rendered HTML goes through DOMPurify; no `dangerouslySet`
  path bypasses it.
- **Scroll-sync jank.** Line-to-block mapping via `markdown-it` source maps rather than
  naive percentage scrolling, which drifts badly on long documents.

## 9. Open questions (not blocking — I'll assume the first answer)

1. **Frontmatter** — YAML frontmatter hidden from the preview and shown as a small
   metadata strip? *Assumed: yes, hidden from preview.*
2. **Non-markdown files** — show them greyed out in the tree, or hide them entirely?
   *Assumed: hide.*
3. **Deploy** — is this ever hosted (GitHub Pages), or purely `npm run dev` on your machine?
   *Assumed: static build deployable to Pages, but local-first.*
