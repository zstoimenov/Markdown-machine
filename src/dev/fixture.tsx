/**
 * Development harness — not part of the shipped app.
 *
 * Opening a real folder needs a native picker and a user gesture, which makes
 * the read path awkward to exercise repeatedly and impossible to automate. This
 * mounts the real App against an in-memory VaultAdapter instead, which is
 * exactly what the adapter seam is for.
 *
 * Run `npm run dev` and open /dev-fixture.html.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import { useVault } from '../state/vaultStore';
import type { TreeEntry, VaultAdapter } from '../fs/types';
import '../styles.css';

const WELCOME = `---
title: Welcome to the vault
tags: demo, markdown
---

# Welcome

A paragraph with **bold**, *italic*, \`inline code\`, an [external link](https://example.com)
and a [link to another note](notes/Second.md).

## A table

| Feature | State |
| --- | :--- |
| Reading | done |
| Editing | M2 |

## A task list

- [x] Open a folder
- [ ] Write something

## Code

\`\`\`js
// highlight.js should colour this
const greet = (name) => \`hello \${name}\`;
export default greet;
\`\`\`

> A blockquote, for texture.

![a dot](./assets/dot.png)

![missing](./assets/nope.png)
`;


// Deliberately built so rendered height and source height diverge: a table that
// is tall in source and compact on screen, fences that are the reverse, and
// prose in between. Percentage-based scroll sync looks fine on uniform text and
// falls apart here, which is the point.
const LONG = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  if (n % 3 === 0) {
    return [
      `## Section ${n}`,
      '',
      '```js',
      ...Array.from({ length: 12 }, (_, k) => `const value${k} = ${k} * ${n};`),
      '```',
      '',
    ].join('\n');
  }
  if (n % 3 === 1) {
    return [
      `## Section ${n}`,
      '',
      '| Key | Value |',
      '| --- | --- |',
      ...Array.from({ length: 8 }, (_, k) => `| row ${k} | ${k * n} |`),
      '',
    ].join('\n');
  }
  return [
    `## Section ${n}`,
    '',
    Array.from({ length: 5 }, () => 'Prose that wraps across several lines when the pane is narrow.').join(' '),
    '',
  ].join('\n');
}).join('\n');

const LONG_NOTE = `# Scroll sync\n\n${LONG}`;

const SECOND = `# Second note

You got here by clicking a link inside another note.
`;

const DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPElEQVR42u3NMQEAAAgDoJnc6BpjDyR' +
  'gcnfCqkAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFA8LFgAV+AAAGb0y0kAAAAAElFTkSuQmCC';

const tree: Record<string, TreeEntry[]> = {
  '': [
    { name: 'notes', path: 'notes', kind: 'directory' },
    { name: 'Long.md', path: 'Long.md', kind: 'file' },
    { name: 'Welcome.md', path: 'Welcome.md', kind: 'file' },
  ],
  notes: [{ name: 'Second.md', path: 'notes/Second.md', kind: 'file' }],
};

const files: Record<string, string> = {
  'Welcome.md': WELCOME,
  'Long.md': LONG_NOTE,
  'notes/Second.md': SECOND,
};

const fakeVault: VaultAdapter = {
  name: 'demo-vault',
  async listDir(path) {
    return tree[path] ?? [];
  },
  async readFile(path) {
    const contents = files[path];
    if (contents === undefined) throw new Error('not found');
    return contents;
  },
  async readBinary(path) {
    if (path !== 'assets/dot.png') throw new Error('not found');
    const bytes = Uint8Array.from(atob(DOT_PNG), (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: 'image/png' });
  },
};

useVault.setState({
  status: 'ready',
  adapter: fakeVault,
  vaultName: 'demo-vault',
  rememberedName: 'demo-vault',
  children: { '': tree[''] ?? [] },
  init: async () => {},
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
