/**
 * The store is the half of this app that can destroy something, and until now it
 * was the half with no tests of its own. Every case here corresponds to a way a
 * person's work went quietly missing.
 *
 * It runs in Node against the same in-memory vault the dev fixture mounts, which
 * is what the adapter seam is for. `fake-indexeddb` stands in for the browser's,
 * so the last-note memory is exercised for real rather than stubbed away.
 */
import 'fake-indexeddb/auto';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { canRevert, isDirty, useVault } from '../src/state/vaultStore.ts';
import { createMemoryVault, type MemoryVault } from '../src/dev/memoryVault.ts';
import { rememberNote } from '../src/fs/handleStore.ts';

const NOTE = '# Welcome\n\nA note.\n';
const NESTED = '# Second\n\nInside a folder.\n';

function freshVault(): MemoryVault {
  return createMemoryVault({
    name: 'test-vault',
    files: { 'Welcome.md': NOTE, 'notes/Second.md': NESTED },
  });
}

/** Autosave lives in a React hook, so a test saves the way Ctrl+S does. */
async function saveNow() {
  await useVault.getState().save();
}

beforeEach(async () => {
  await rememberNote('test-vault', null);
  useVault.setState({
    status: 'checking',
    adapter: null,
    vaultName: null,
    canWrite: false,
    children: {},
    expanded: new Set<string>(),
    activePath: null,
    source: null,
    draft: null,
    modifiedAt: null,
    originals: {},
    repairs: [],
    repairDismissed: false,
    converted: false,
    editorView: null,
    saveState: { kind: 'idle' },
    error: null,
  });
});

describe('reopening the last note', () => {
  test('comes back to a note inside a folder, not only one at the root', async () => {
    const vault = freshVault();
    await rememberNote('test-vault', 'notes/Second.md');

    await useVault.getState().open(vault.adapter);

    assert.equal(useVault.getState().activePath, 'notes/Second.md');
    assert.equal(useVault.getState().source, NESTED);
  });

  test('opens the tree down to it, so the sidebar shows where you are', async () => {
    const vault = freshVault();
    await rememberNote('test-vault', 'notes/Second.md');

    await useVault.getState().open(vault.adapter);

    assert.ok(useVault.getState().expanded.has('notes'));
    assert.ok(useVault.getState().children['notes']);
  });

  test('still comes back to a note at the root', async () => {
    const vault = freshVault();
    await rememberNote('test-vault', 'Welcome.md');

    await useVault.getState().open(vault.adapter);

    assert.equal(useVault.getState().activePath, 'Welcome.md');
  });

  test('says nothing about a note that has since been deleted', async () => {
    const vault = freshVault();
    await rememberNote('test-vault', 'notes/Gone.md');

    await useVault.getState().open(vault.adapter);

    assert.equal(useVault.getState().activePath, null);
    assert.equal(useVault.getState().error, null);
  });

  test('does not go looking for a note belonging to a different folder', async () => {
    const vault = freshVault();
    await rememberNote('some-other-vault', 'Welcome.md');

    await useVault.getState().open(vault.adapter);

    assert.equal(useVault.getState().activePath, null);
  });
});

describe('revert', () => {
  test('takes the file back to how it was when it was opened', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    useVault.getState().setDraft('# Edited\n');
    await saveNow();
    assert.equal(vault.read('Welcome.md'), '# Edited\n');

    useVault.getState().revert();
    await saveNow();
    assert.equal(vault.read('Welcome.md'), NOTE);
  });

  test('leaves a conflict standing rather than writing nothing and saying nothing', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    // One save, so there is a revert snapshot to go back to.
    useVault.getState().setDraft('# Mine\n');
    await saveNow();

    // Somebody else writes the file, and the next save is refused.
    vault.touch('Welcome.md', '# Theirs\n');
    useVault.getState().setDraft('# Mine again\n');
    await saveNow();
    assert.equal(useVault.getState().saveState.kind, 'conflict');

    useVault.getState().revert();

    // The buffer reverts; the file does not, because the conflict is unresolved.
    assert.equal(useVault.getState().draft, NOTE);
    assert.equal(vault.read('Welcome.md'), '# Theirs\n');
    assert.equal(
      useVault.getState().saveState.kind,
      'conflict',
      'the bar has to stay up: the buffer and the file still disagree',
    );
  });

  test('and "keep mine" then writes the reverted text', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    useVault.getState().setDraft('# Mine\n');
    await saveNow();
    vault.touch('Welcome.md', '# Theirs\n');
    useVault.getState().setDraft('# Mine again\n');
    await saveNow();

    useVault.getState().revert();
    await useVault.getState().save({ overwrite: true });

    assert.equal(vault.read('Welcome.md'), NOTE);
    assert.equal(useVault.getState().saveState.kind, 'saved');
  });
});

describe('rename', () => {
  test('carries the revert snapshot to the new name', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    useVault.getState().setDraft('# Edited\n');
    await saveNow();
    assert.ok(canRevert(useVault.getState()), 'a saved edit is revertable to begin with');

    globalThis.window = { prompt: () => 'Renamed.md' } as unknown as Window & typeof globalThis;
    await useVault.getState().renameActive();

    assert.equal(useVault.getState().activePath, 'Renamed.md');
    assert.ok(
      canRevert(useVault.getState()),
      'renaming a note is not a reason to lose the step back',
    );
    assert.equal(useVault.getState().originals['Renamed.md'], NOTE);
    assert.equal(useVault.getState().originals['Welcome.md'], undefined);
  });

  test('and reverting after it writes to the new name', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    useVault.getState().setDraft('# Edited\n');
    await saveNow();

    globalThis.window = { prompt: () => 'Renamed.md' } as unknown as Window & typeof globalThis;
    await useVault.getState().renameActive();

    useVault.getState().revert();
    await saveNow();
    assert.equal(vault.read('Renamed.md'), NOTE);
  });

  test('points the last-note memory at the new name', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    globalThis.window = { prompt: () => 'Renamed.md' } as unknown as Window & typeof globalThis;
    await useVault.getState().renameActive();

    // Reopening the same vault is what a reload does.
    await useVault.getState().open(vault.adapter);
    assert.equal(useVault.getState().activePath, 'Renamed.md');
  });
});

describe('opening a different folder', () => {
  test('does not leave the last folder’s repair offer on screen', async () => {
    const damaged = createMemoryVault({
      name: 'damaged-vault',
      files: { 'Broken.md': '{"type":"text","text":"# Note\\n\\nBody.\\n"}' },
    });
    await useVault.getState().open(damaged.adapter);
    await useVault.getState().openFile('Broken.md');
    assert.ok(useVault.getState().repairs.length > 0, 'the damaged note is flagged to begin with');

    await useVault.getState().open(freshVault().adapter);

    assert.equal(useVault.getState().activePath, null);
    assert.deepEqual(
      useVault.getState().repairs,
      [],
      'nothing is open, so there is nothing to offer to repair',
    );
  });
});

describe('conflict detection', () => {
  test('refuses to overwrite a file that moved on, and stops autosaving', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    vault.touch('Welcome.md', '# Somebody else\n');
    useVault.getState().setDraft('# Mine\n');
    await saveNow();

    assert.equal(useVault.getState().saveState.kind, 'conflict');
    assert.equal(vault.read('Welcome.md'), '# Somebody else\n');

    // A second attempt changes nothing while the conflict stands.
    await saveNow();
    assert.equal(vault.read('Welcome.md'), '# Somebody else\n');
  });

  test('reloading from disk takes the other side and drops the stale snapshot', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    useVault.getState().setDraft('# Mine\n');
    await saveNow();
    vault.touch('Welcome.md', '# Somebody else\n');
    useVault.getState().setDraft('# Mine again\n');
    await saveNow();

    await useVault.getState().reloadFromDisk();

    assert.equal(useVault.getState().source, '# Somebody else\n');
    assert.equal(useVault.getState().saveState.kind, 'idle');
    assert.ok(
      !canRevert(useVault.getState()),
      'reverting now would reinstate text from before the reload was chosen',
    );
  });
});

describe('delete', () => {
  test('moves the note out of the way rather than destroying it', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    globalThis.window = { confirm: () => true } as unknown as Window & typeof globalThis;
    await useVault.getState().deleteActive();

    assert.equal(useVault.getState().activePath, null);
    const trashed = vault.list().filter((path) => path.startsWith('.trash/'));
    assert.equal(trashed.length, 1, 'exactly one note went to the trash');
    assert.equal(vault.read(trashed[0]!), NOTE, 'and it is still the note that was there');
  });

  test('keeps it out of the tree, the way a delete looked', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    globalThis.window = { confirm: () => true } as unknown as Window & typeof globalThis;
    await useVault.getState().deleteActive();

    const roots = useVault.getState().children[''] ?? [];
    assert.ok(!roots.some((entry) => entry.name.startsWith('.')), 'no .trash in the sidebar');
    assert.ok(!roots.some((entry) => entry.path === 'Welcome.md'), 'and the note is gone from it');
  });

  test('says where it went, as news rather than as a warning', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    globalThis.window = { confirm: () => true } as unknown as Window & typeof globalThis;
    await useVault.getState().deleteActive();

    assert.match(useVault.getState().notice ?? '', /Moved "Welcome\.md" to \.trash\//);
    assert.equal(useVault.getState().error, null);
  });

  test('declining the confirm leaves the note alone', async () => {
    const vault = freshVault();
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    globalThis.window = { confirm: () => false } as unknown as Window & typeof globalThis;
    await useVault.getState().deleteActive();

    assert.equal(useVault.getState().activePath, 'Welcome.md');
    assert.equal(vault.read('Welcome.md'), NOTE);
  });
});

describe('read-only folders', () => {
  test('report the refusal rather than dropping the edit silently', async () => {
    const vault = createMemoryVault({
      name: 'test-vault',
      files: { 'Welcome.md': NOTE },
      writable: false,
    });
    await useVault.getState().open(vault.adapter);
    await useVault.getState().openFile('Welcome.md');

    useVault.getState().setDraft('# Edited\n');
    await saveNow();

    assert.equal(useVault.getState().saveState.kind, 'error');
    assert.equal(vault.read('Welcome.md'), NOTE);
    assert.ok(isDirty(useVault.getState()), 'the edit is still there to be rescued');
  });
});
