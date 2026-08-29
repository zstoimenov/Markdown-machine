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

const SECOND = `# Second note

You got here by clicking a link inside another note.
`;

const DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAPElEQVR42u3NMQEAAAgDoJnc6BpjDyR' +
  'gcnfCqkAgEAgEAoFAIBAIBAKBQCAQCAQCgUAgEAgEAoFA8LFgAV+AAAGb0y0kAAAAAElFTkSuQmCC';

const tree: Record<string, TreeEntry[]> = {
  '': [
    { name: 'notes', path: 'notes', kind: 'directory' },
    { name: 'Welcome.md', path: 'Welcome.md', kind: 'file' },
  ],
  notes: [{ name: 'Second.md', path: 'notes/Second.md', kind: 'file' }],
};

const files: Record<string, string> = { 'Welcome.md': WELCOME, 'notes/Second.md': SECOND };

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
