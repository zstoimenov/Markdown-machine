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

## Counting and copying

The status bar shows words and **symbols** — characters including spaces, counted the way a
person and a post limit count them, so an emoji is one symbol rather than two.

**Copy** in the toolbar offers three forms of the open note, each labelled with the symbol
count it produces, since the destination usually has a limit:

| | |
|---|---|
| **Markdown source** | The note exactly as written — for anywhere that understands markdown |
| **Plain text** | Structure without markup: `•` bullets, numbered lists, `>` quotes, link targets written out as `label (url)`, tables flattened to readable rows. Works in any language |
| **With bold and italic** | The same, plus Unicode emphasis so text still *looks* formatted in a plain box |

The third one comes with a caveat worth knowing before you rely on it. Plain text has no
bold, so the only way to fake it is Unicode's mathematical alphabets — and **those exist for
Latin and Greek only**. Cyrillic, accented Latin and CJK have no bold or italic forms
anywhere in Unicode, so they come through unchanged, and the confirmation says so rather
than leaving you to wonder why half the post came out plain. Headings are the exception:
where bold is unavailable they fall back to capitals, which every script has.

Unicode-styled text is also invisible to search and read as gibberish by screen readers, so
it is the option you choose, never the default.

## Repairing damaged markdown

LLM tools sometimes write their transport envelope into the file instead of the content it
was carrying. The note arrives as a JSON object, or with JSON fragments sitting in the
prose, and with `\n` written as two literal characters rather than a line break — so the
whole thing collapses into one unbroken paragraph.

Opening such a file offers to fix it, saying first what it would change. **Fix markdown**
in the sidebar does the same on demand for a file that was not flagged. It:

- unwraps a JSON envelope and pulls out the content it was carrying
- turns literal `\n`, `\t` and `\"` back into real characters
- replaces embedded JSON fragments with whatever prose they held, and drops the rest
- splits a single flattened blob back into headings, lists and fences
- tidies blank lines around headings

The repair rewrites the **editor buffer, not the file**, so you read the result before it is
kept — and a single `Ctrl`/`Cmd`+`Z` takes all of it back. JSON inside a code fence or an
inline span is left alone, and a healthy file is never touched.

One thing it cannot do: once the newline between a heading and its body is gone,
`## Notes Body text here` reads the same either way, so the heading keeps the whole run for
you to break by hand. Guessing would be worse.

## Requirements

**Desktop:** a Chromium browser — Chrome, Edge, Brave, Arc or Opera. Folder access uses the
File System Access API, which Firefox and Safari have not shipped.

**Phones and tablets, including Android Chrome:** the File System Access API is desktop-only,
so there is no folder mode on mobile at all. What you get instead is the single-file
fallback: open one `.md` file, read it, edit it, download a copy. It cannot save in place,
because the browser gives no handle to write back through.

The layout adapts to phone widths either way — the file tree becomes a drawer, the split
view collapses to a single pane that lands on the rendered note, and touch targets and the
editor's type size are sized for a thumb.

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
