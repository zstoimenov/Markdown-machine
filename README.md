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
things stand, and Revert takes a file back to how it was when you opened it. Deleting a
note moves it to `.trash/` in the same folder rather than off the disk — the tree skips
dotted names, so it goes as quietly as a delete did, and it is still there if you want it.

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
| Find in note | `Mod`+`F` |
| Save now | `Mod`+`S` |

`Mod` is `⌘` on a Mac and `Ctrl` elsewhere. The same list shows in the app whenever no note
is open.

`Mod`+`F` finds within the open note, and the browser's own find is not a substitute for it:
the editor only renders the part of a long note that is on screen, so find-in-page cannot see
a word that is scrolled away.

## Live

<https://zstoimenov.github.io/Markdown-machine/>

Deployed from `main` by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every
push, and manually from any branch via the Actions tab.

Hosting the app publicly does not make your notes public. The page reads and writes files
directly in your browser through the File System Access API — nothing is uploaded, and there
is no server to upload to. The folder you pick is remembered per origin, so the hosted app
and a local `npm run dev` keep separate ones.

**Being asked for the folder again may be avoidable, depending on your browser.** Where the
prompt offers **Allow on every visit** — desktop Chrome since 122 — that is the end of it: the
folder is remembered, the app opens straight into it with no prompt and no click, and files
and folders opened afterwards are persistent too. Where it instead says *until you close all
tabs*, the grant lasts only as long as the app stays open, and nothing the page can do changes
that. Either way the handle is kept in IndexedDB and the app asks for persistent storage when
you pick a folder, so the folder itself is not forgotten when the disk gets tight.

## Installing it

The page installs as an app — Chrome's ⊕ in the address bar, or *Add to Home Screen* on a
phone — and then runs in its own window with no browser chrome, off a home screen icon, and
without a network.

The icon is the split view: a tile divided down the middle, paper on the left where the
source is and ink on the right where the rendering is, with one monospace `#` laid across
the seam taking the opposite colour on each side. It is drawn in
[`scripts/icons.mjs`](scripts/icons.mjs) rather than checked in as a picture, so the SVG the
browser uses in a tab, the PNGs a home screen wants and the maskable variant Android crops
all come out of the same four strokes. Re-run it if the mark changes:

```sh
npm install --no-save playwright
node scripts/icons.mjs
```

Offline is not a bonus feature here, it is the point: an app whose whole claim is that your
notes never leave your disk should not need a network to open them.
[`public/sw.js`](public/sw.js) takes the shell and every chunk on the first visit — the
lazily-loaded editor included, since that is the half you would be offline to use — and after
that a build asset carries a content hash and can never go stale, so it is served from the
cache without asking, while everything else goes to the network first, so a deploy is picked
up on the next load rather than the one after. There is no list kept by hand: the build says
what it emitted and the page says where it is. It is registered in a build only, so
`npm run dev` never serves you yesterday's bundle.

## Counting and copying

The status bar shows words and **symbols** — characters including spaces, counted the way a
person and a post limit count them, so an emoji is one symbol rather than two.

**Copy** in the toolbar gives the open note in one of two forms:

- **Markdown source** — the note exactly as written, markers and all. For pasting a repaired
  note back into wherever the document lives.
- **Text for pasting** — plain text with every marker stripped and the structure kept.

The rule the plain form follows is *markup goes, words stay*:

| In the note | In the copied text |
|---|---|
| `# Heading` | `HEADING` |
| `**bold**`, `*italic*`, `` `code` `` | the words, unmarked |
| `- item`, nested | `• item`, `◦ item`, indented |
| `1. item` | `1. item` |
| `> quote` | `> quote` |
| ```` ```code``` ```` | a fence, language tag and all |
| `[label](url)` | `label (url)` |
| a table | columns lined up, with a rule under the header |
| `---` | `────────` |

Headings are the one place words are altered: plain text has no other way to mark one, and
capitals work in every script — including Cyrillic, where Unicode has no bold form at all.
The level distinction is lost, which is the price of not inventing punctuation for it.

Code and tables are the one place markers *stay*, because there the marker is the information
rather than decoration:

````
```js
const greet = (name) => `hello ${name}`;
```

Environment | Branch  | Status
----------- | ------- | ------
production  | main    | live
staging     | develop | live
````

A fence is the one markdown marker that became a plain-text convention in its own right —
people type ``` into boxes that have never rendered markdown — and it is the only way to say
*this is literal* that survives a paste target normalising whitespace, which four spaces of
indent do not. A table keeps its pipes because nothing else in plain text says "table" at
all; what it gains is columns padded to line up and a rule under the header, so a person can
scan it and a reader does not have to guess which row named the columns. Columns wider than
40 characters are left ragged rather than pushing the rest of the row off the screen.

**On length**, since paste boxes have limits: fencing is *cheaper* than indenting from about
three lines of code on — a fence costs a fixed eight characters or so, four spaces of indent
cost four per line. A table costs more: its rule row plus the padding, which came to about 27
characters on a small three-column table. A note with no code and no tables is unchanged to
the character. The copy menu shows what each form would cost before you pick one.

Not used, deliberately: Unicode look-alikes for bold (𝗯𝗼𝗹𝗱). They buy an appearance at the
cost of tokenisation, search, copy and screen readers, and do not exist for Cyrillic or CJK.
This text is read as often by an LLM agent as by a person, and both read ordinary characters
doing the structural work far better than they read counterfeit glyphs.

Stripping markup is deliberately lossy, so the plain form is an export rather than a round
trip. Pasting it back into a note is not a disaster, though: the paste is offered a
conversion, which puts the structure back and cannot put the emphasis back. See the next
section.

## Turning plain text into markdown

The other direction from the plain-text export, and the rule read backwards:
*punctuation comes back, words stay*. Nothing is reworded, nothing is reordered, nothing is
dropped — the only thing added is the markup that plain text had no way to carry.

It is offered three ways:

- **Paste plain text into a note** and a bar appears saying what a conversion would do. The
  paste itself is never touched on the way in; the offer goes as soon as you type anything
  else, and `Ctrl`/`Cmd`+`Z` undoes a conversion in one go.
- **Select a few lines** and the suggestion row offers **→ Markdown** for just that selection.
- **Plain → markdown** in the sidebar does the whole note. It is greyed out for a note that
  is already written as markdown.

What it recovers is what plain text actually encodes:

| In the pasted text | In the note |
|---|---|
| `SHOUTED LINE` | `# SHOUTED LINE`, at level 1 opening the note and 2 after that |
| a line over `=====` or `-----` | `#` or `##` |
| `• item`, `◦ item`, indented | `- item`, nested by indentation |
| `1. item`, `1) item` | `1. item`, keeping the numbers |
| `[ ] milk`, `☑ done` | `- [ ] milk`, `- [x] done` |
| `> quote` | `> quote` |
| four spaces of indent | a fenced code block |
| `a \| b` rows | a table, header rule and all |
| `label (https://…)` | `[label](https://…)` |
| `────────` | `---` |
| a paragraph hard-wrapped at a fixed column | one paragraph |

What plain text does **not** encode is not guessed at. Which words were bold, what level a
heading was, where a sentence was emphasised — inventing those would be writing, and this
only punctuates. Heading case is left exactly as it stands, too: sentence-casing `API KEYS`
back would read better and would also turn API into Api.

Two heuristics are worth knowing about, since both can be wrong:

- **The label of a link** is guessed as everything back to the last sentence end, capped at
  60 characters. `That is done. The handbook (https://example.com) says so.` links *The
  handbook*; a longer run keeps its brackets instead.
- **Hard-wrapped paragraphs are joined** only where the block is evidently wrapped — every
  line but the last inside a narrow band of widths, most of them stopping mid-sentence. A
  poem, an address or a list of names is left alone.

The conversion rewrites the **editor buffer, not the file**, and always says what it would do
before it does it. A note that is already markdown comes out untouched: if there is no change
worth naming, there is no edit at all.

## Suggestions as you type

Under the editor is a row of the markdown that could sensibly come next. The shortcuts above
cover the markers a touch typist has in their fingers; this is for the rest of it.

It closes things first, because an unclosed marker is the one mistake that changes how
everything after it renders. Type `**very` and the first chip is `**`. Type `[the docs` and
it is `](url)`, cursor landing inside the brackets. Open a fence and the only suggestion is
the fence that closes it.

Otherwise it offers what fits where the cursor is:

| Where the cursor is | What is offered |
|---|---|
| An empty line | heading, list, numbered, quote, code block, table |
| An empty line under a list | the next item, with that list's marker and indent |
| A list item | the next item, one a level in, and a checkbox |
| A heading | one level deeper, one shallower |
| A table row | another cell, and the `\|---\|` rule that makes a header |
| Ordinary prose | the inline markers, and turning the line into a heading or an item |
| A selection of several plain-text lines | **→ Markdown** |
| Inside code | nothing — no markdown applies in there |

The code and table chips write both halves at once, since the closing fence and the header
rule are the parts that get forgotten. Nothing fires on its own: the document only changes
when a chip is pressed, and each press is one transaction, so one undo takes it back.

The row is also how markdown is reachable on a phone, where there is no `Mod` key and `|` is
three taps into the keyboard. `×` hides it for the session.

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

**Phones and tablets:** folder mode is available where the browser has the API — which now
includes some Android Chrome builds, though write access there may last only as long as the
app stays open. **iOS never will:** Safari implements only the sandboxed Origin Private File
System, and every browser on iOS is Safari underneath.

Where there is no folder, notes are kept **in the browser, on the device** instead. Add the
files you want to work on and they stay: writable, more than one, and still there after a
reload — which the read-only single file this replaced was not. Saving a copy out is how a
note goes back to a real folder, and it goes through the platform's share sheet where there is
one: on iOS the sheet's *Save to Files* can put it back where it came from, which is as close
to saving in place as that platform allows. Elsewhere it stays a download.

Browser storage is not a disk, and the app says so rather than implying otherwise. Safari
clears script-writable storage after a week without a visit unless the app is on the home
screen; the app asks for persistent storage, and asks you to keep copies of anything that
matters.

The layout is rebuilt at phone widths rather than squeezed. A phone has room for about
three things in a toolbar and, while you are writing, for one — the words — so:

- **The toolbar keeps what is used every minute:** the drawer, which note this is, and
  whether you are writing or reading. Everything occasional — both copy forms, *Plain →
  markdown*, *Fix markdown*, *Revert*, *Rename*, *Delete*, *Download*, *Open folder* — is
  behind ⋯, which opens a sheet **from the bottom**, because the top-right corner of a phone
  is the one place a thumb holding it cannot reach.
- **The drawer is for choosing a note**, not for acting on one. It holds the tree and *New
  note* and nothing else.
- **A software keyboard does not bury the app.** `100dvh` survives an address bar and
  nothing else, so the app is sized from the visual viewport — or from
  `env(keyboard-inset-height)` where Chromium offers it — and the suggestion row lands on
  top of the keys rather than under them.
- **While the keyboard is up, everything that is not the writing steps back:** the status
  bar and any standing explanation go, leaving the note and one row of suggestions. Whether
  the note has reached the disk is the one thing from the status bar worth knowing
  mid-sentence, so it moves to the toolbar as a dot. Everything returns when the keyboard
  does.
- The split view collapses to a single pane that lands on the rendered note, and touch
  targets and the editor's type size are sized for a thumb.
- **A stray swipe cannot reload the app.** Pull-to-refresh is off, and no pane hands the
  gesture up to the browser when you reach the end of it. A reload in the middle of writing is
  the worst thing this app can do to you — on the folder path it drops the permission too, so
  what looked like a scroll ends at the "Welcome back" screen.
- **A reload that happens anyway costs less.** Whichever note was open is open again. Only the
  path is remembered, not a draft: autosave has already put the text in the file, and
  restoring a stale draft over a file that moved on since is the conflict problem invented
  twice.

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
