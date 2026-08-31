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
import { App } from '../App.tsx';
import { useVault } from '../state/vaultStore.ts';
import { createMemoryVault } from './memoryVault.ts';
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

const FORMAT = `# Format

## A table

Body text for the formatting commands to chew on.
`;

// A note in the state an LLM export leaves behind: JSON envelope, literal
// escape sequences, and a stray transport fragment in the middle.
const BROKEN = JSON.stringify({
  id: 'msg_01',
  role: 'assistant',
  content: [
    {
      type: 'text',
      text:
        '# Broken note\\n\\n## Findings\\n\\n' +
        '{"type":"text","text":"The first finding."}\\n\\n' +
        '- one\\n- two\\n\\nClosing paragraph.\\n',
    },
  ],
});

// A note that is plain text through and through: shouted heading, drawn bullets,
// a divider, a labelled URL and an indented block. Nothing in it is markdown.
const PLAIN = `PROJECT NOTES

• first thing
   ◦ a detail under it
• second thing

────────

See the handbook (https://example.com) before starting.

    npm install
    npm run dev
`;

const DOT_BYTES = Uint8Array.from(atob(DOT_PNG), (c) => c.charCodeAt(0));

const vault = createMemoryVault({
  name: 'demo-vault',
  files: {
    'Broken.md': BROKEN,
    'Welcome.md': WELCOME,
    'Format.md': FORMAT,
    'Plain.md': PLAIN,
    'Long.md': LONG_NOTE,
    'notes/Second.md': SECOND,
  },
  binaries: { 'assets/dot.png': new Blob([DOT_BYTES], { type: 'image/png' }) },
});

// Lets the smoke test play the part of another program editing the same file.
declare global {
  interface Window {
    mmFixture: {
      touch(path: string, text: string): void;
      read(path: string): string | undefined;
      list(): string[];
    };
  }
}
window.mmFixture = {
  touch: vault.touch,
  read: vault.read,
  list: vault.list,
};

useVault.setState({
  status: 'ready',
  adapter: vault.adapter,
  vaultName: 'demo-vault',
  rememberedName: 'demo-vault',
  canWrite: true,
  children: { '': await vault.adapter.listDir('') },
  init: async () => {},
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
