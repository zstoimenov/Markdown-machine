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
  readonly writable: boolean;
  requestWrite(): Promise<boolean>;              // needs a user gesture

  listDir(path: string): Promise<TreeEntry[]>;   // lazy: immediate children only
  readFile(path: string): Promise<FileSnapshot>; // text + modification time
  readBinary(path: string): Promise<Blob>;       // images referenced from a note

  // Raises ConflictError when the file moved on since expectedModifiedAt.
  writeFile(path: string, contents: string, expectedModifiedAt: number | null): Promise<number>;
  createFile(path: string): Promise<void>;       // raises AlreadyExistsError
  renameFile(from: string, to: string): Promise<void>;  // raises AlreadyExistsError
  deleteFile(path: string): Promise<void>;
}
```

Every component talks to this interface, never to the browser API directly. Swapping in
a local server, a git backend or cloud sync later means writing one new adapter and
changing one line — no UI churn.

Three things changed from the first sketch of this interface, each forced by building it:

- `listTree()` became `listDir(path)`. A single whole-tree walk contradicts the
  lazy-loading answer to the large-vault risk below; directories are now read on expand
  and cached.
- `readFile` returns a modification time alongside the text, and `writeFile` takes the one
  the buffer is based on. Autosave makes a stale overwrite a routine hazard rather than a
  theoretical one, and the check belongs in the adapter because every backend has the same
  problem — a server or git backend no less than this one.
- `createFile` and `renameFile` raise `AlreadyExistsError` rather than overwriting. The
  browser API's `{ create: true }` will happily clobber; refusing is the adapter's job, not
  something each caller should have to remember.

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
| M3 | Write back | ✅ Autosave + `Cmd+S`, dirty state, new/rename/delete, unsaved-changes guard |
| M4 | Feel good | ✅ Themes, reader mode, formatting shortcuts, word count, empty/error states, fallback banner |

Each milestone is a working app, not a layer — M1 alone is already a usable markdown reader.

**M0 through M4 are done — the plan is delivered.** What shipped beyond the milestone line, because it fell out of the
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

M4 finished it: formatting shortcuts, a reader mode with its own measure, a shortcut sheet
on the empty state, the single-file fallback promised in section 2, and the bundle work
recorded as a known issue in M2. Details in section 8.

M3 turned it into a real editor: autosave 800ms after typing stops, `Ctrl/Cmd+S` for an
immediate write, and new / rename / delete from the sidebar. Write permission is requested
when the folder is chosen rather than lazily at the first keystroke — see below.

Two bugs the smoke test caught in M2, both real rather than test artifacts:

- Suppressing pointer events page-wide during a divider drag changed what sat under the
  cursor mid-gesture, which broke double-click-to-reset. The divider now takes pointer
  capture instead, and needs no page-wide anything.
- Scrolling the editor to a given line assumed `lineBlockAt().top` shared an origin with
  `scrollTop`. It does not — the content carries padding. It now converts through
  `documentTop` and the viewport, assuming nothing about either.

## 7. Writing to real files

Autosave into somebody's actual documents is the one part of this app that can destroy
something, so M3 is mostly guards:

- **Conflict detection.** Every write carries the modification time the buffer was read at.
  If the file moved on — a second tab, a git checkout, another editor — the write is
  refused, autosave stops, and a banner offers both sides explicitly. Neither
  "keep mine" nor "take theirs" is a default, because either one loses something.
- **One step back.** The first write to a file in a session stashes what was there before
  it, and a Revert button in the status bar restores it. A reload from disk clears that
  snapshot, since keeping it would let Revert quietly reinstate content from before a
  conflict the person had just resolved the other way.
- **Nothing is clobbered.** Create and rename refuse an existing name rather than
  overwriting it; delete confirms and says it cannot be undone from here.
- **Failed writes are visible.** The status bar shows saving / saved / unsaved / read-only /
  changed-on-disk, and leaving a note whose changes never reached disk still asks first.

**Permission changed from the plan.** The earlier note said write access would be requested
lazily, "at the point it earns it". Building it showed that to be wrong on two counts: a
permission dialog interrupting someone mid-sentence is worse than one at the moment they
choose a folder, and autosave firing on a timer has no user gesture to attach a prompt to
at all. It now asks once, when the folder is picked. Refusal is handled rather than fatal —
the app runs read-only, says so, and offers a button to ask again.

## 8. Polish (M4)

**Formatting shortcuts.** Bold, italic, inline code, link, heading cycle, bullet list.
Two of the key choices were forced rather than picked: `Mod-1`…`Mod-6` for heading levels,
which is what most desktop editors use, cannot work here because browsers switch tabs on
those chords and a page cannot intercept them — hence a cycle on `Mod-⇧-H`. And the bullet
toggle moved off `Mod-⇧-8` because a shifted digit is reported inconsistently across
keyboard layouts; `Mod-⇧-L` is unambiguous.

**Bundle.** 977 kB → 406 kB on first load (345 kB → 145 kB gzipped), which is lighter than
M1 was before CodeMirror existed. Two changes: highlight.js dropped from its `common` bundle
to a curated seventeen languages plus aliases, and the editor is now a lazy chunk, since
nothing needs CodeMirror until a note is actually opened. Splitting it revealed its own
trap — importing the shortcut list from `commands.ts` pulled `@codemirror/state` straight
back into the initial chunk, so the list lives in its own module.

**Reader mode.** The preview takes a wider measure and larger type when the editor is
hidden. Fixing this surfaced a bug in the measure that had been there since M1: a
`max-width` in `ch` on `.preview` resolved against the 14px UI font that element inherits,
not the larger serif the prose inside it actually uses, so every column was noticeably
narrower than intended. It is expressed in `rem` now.

**Single-file fallback.** Section 2 promised Firefox and Safari a degradation path, and M4
delivers it: a drop zone and file picker on the unsupported splash open one `.md` file,
which renders and can be edited, with a Download button in place of a save. It is
permanently unwritable — not "no permission yet" but no handle to write through at all —
so autosave never runs and the banner says why.

**Discoverability.** The shortcut sheet shows on the empty state, with the modifier spelled
the way the current keyboard has it printed.

## 9. Beyond the plan

Two things asked for after the original five milestones.

### Repairing LLM-damaged markdown

`src/markdown/repair.ts` is a pure pipeline over a string: unwrap a JSON envelope, unescape
literal `\n`, replace embedded transport fragments with the prose they carried, reblock a
flattened blob, tidy spacing. Every structural pass runs with fenced and inline code masked
out, because code is the one place where a JSON fragment is the content rather than the damage.

Two design choices worth keeping:

- **It rewrites the buffer, never the file**, and does it as one CodeMirror transaction. So
  the result is reviewable, autosave carries it to disk only after that, and one `Ctrl+Z`
  reverses the whole thing. A repair is a suggestion, not something done to someone's notes
  behind their back.
- **Detection is deliberately conservative.** Unescaping only fires when literal `\n`
  outnumbers real newlines, so a note that merely mentions `\n` is untouched; a JSON object
  with no envelope keys and no extractable text is assumed to be content the author meant to
  include; and spacing-only changes never raise the banner, since the file already renders.

Being pure logic that can corrupt notes if it regresses, it is unit-tested properly —
17 cases under `tests/`, run by `npm test` with Node's own test runner and type stripping,
so no test framework was added. It gates the Pages deploy.

Its one real limit is recorded in the code and the README: once the newline between a
heading and its body is gone, the boundary is unrecoverable, so the heading keeps the run.

### Phone layout

The file tree becomes a drawer, the split view collapses to a single pane, touch targets
grow, the editor sits at 16px so focusing it does not zoom, `100dvh` keeps the status bar
on screen as browser chrome moves, and the status bar clears the gesture bar via
`env(safe-area-inset-bottom)`.

**The important finding is that mobile cannot have the folder mode at all.** The File System
Access API is desktop-only — Chrome for Android does not implement it — so a phone always
lands in the single-file fallback built in M4. That makes the fallback the main mobile
experience rather than an edge case, which is why a phone now opens on the *rendered* note
rather than the source: reading is what most phone visits are for, and there is nothing to
save into anyway.

## 10. Known issues

- **No syntax highlighting inside editor code fences.** Still deferred, and now
  deliberately: `@codemirror/language-data` means a lazy chunk per language and six more
  dependencies, which fights the bundle work above, to highlight code that the preview is
  already highlighting one pane over.
- **Changes on disk are noticed on write, not as they happen.** Nothing watches the folder,
  so an externally-edited note that is open here still shows the old text until you save or
  reopen it. The conflict check means it cannot be silently overwritten, which is the part
  that matters; live watching stays on the iterate list.
- **Directories cannot be created, renamed or deleted.** Only files. Folder operations were
  not in any milestone and adding them would widen the destructive surface.
- **The single-file fallback cannot show images.** Relative image paths need the folder the
  file sits in, which is exactly what that browser will not hand over. This bites hardest on
  mobile, where the fallback is the only mode available.
- **The repair cannot recover a heading's title/body boundary** in a fully flattened blob.
  See section 9.
- **Only one file at a time on mobile.** A multi-select file picker would give phones a
  small library rather than a single note; not built, because it was not asked for.

## 11. Risks and how they're handled

- **Permission re-grant on reload.** Browsers drop write permission between sessions.
  Handled with a single "Reopen `<folder>`" button on launch rather than a silent failure.
- **Large vaults.** A 5,000-file tree walked eagerly will stall. The tree lazy-loads
  directories on expand; only file metadata is held in memory, never contents.
- **Data loss.** Handled as described in section 7, plus one more the plan did not
  anticipate: a failed `write()` now aborts the writable stream rather than abandoning it.
  The File System Access API writes through a swap file, and leaving one un-closed loses the
  write while the original is already truncated.
- **XSS from note content.** All rendered HTML goes through DOMPurify; no `dangerouslySet`
  path bypasses it.
- **Scroll-sync jank.** Line-to-block mapping via `markdown-it` source maps rather than
  naive percentage scrolling, which drifts badly on long documents.

## 12. Open questions (not blocking — I'll assume the first answer)

1. **Frontmatter** — YAML frontmatter hidden from the preview and shown as a small
   metadata strip? *Assumed: yes, hidden from preview.*
2. **Non-markdown files** — show them greyed out in the tree, or hide them entirely?
   *Assumed: hide.*
3. ~~**Deploy** — is this ever hosted (GitHub Pages), or purely `npm run dev` on your
   machine?~~ **Answered: both.** Deployed to GitHub Pages from `main`, and still local-first
   — the hosted page uploads nothing, because there is nothing to upload to. The build uses a
   relative base (`./`) rather than hard-coding `/Markdown-machine/`, so the same artifact
   works at a project path, at a root domain, or from any static host.
