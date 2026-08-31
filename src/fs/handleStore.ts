import { get, set, del } from 'idb-keyval';

const KEY = 'markdown-machine:vault-handle';
const LAST_NOTE = 'markdown-machine:last-note';

/**
 * Everything here is a convenience: which folder was yours, and which note you
 * were reading. Losing it costs a picker click and an empty pane, so none of it
 * is worth failing a launch over — and there are real browsers that refuse.
 * A private window with site data blocked throws from `indexedDB.open` rather
 * than returning nothing, and until this was guarded that rejection surfaced
 * from `pickVault` as an error over a folder that had opened perfectly well.
 */
async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  if (typeof indexedDB === 'undefined') return fallback;
  try {
    return await work();
  } catch {
    return fallback;
  }
}

/**
 * Directory handles are structured-cloneable, so IndexedDB can hold one across
 * reloads. The permission that comes with it does not survive — see
 * fsAccessAdapter.restoreVault / reopenVault.
 */
export async function rememberVault(handle: FileSystemDirectoryHandle): Promise<void> {
  await quietly(() => set(KEY, handle), undefined);
}

export async function recallVault(): Promise<FileSystemDirectoryHandle | null> {
  return quietly(async () => (await get<FileSystemDirectoryHandle>(KEY)) ?? null, null);
}

export async function forgetVault(): Promise<void> {
  await quietly(() => del(KEY), undefined);
}

/**
 * Which note was open, so a reload does not land on an empty pane.
 *
 * Only the path: the text is the file's business and autosave has already put
 * it there. Restoring a *draft* from before a reload would mean deciding what
 * to do when the file has moved on since, which is the conflict problem again
 * and not one worth inventing here.
 *
 * Stored with the vault it belongs to, so reopening a different folder does not
 * go looking for a note from the last one.
 */
export async function rememberNote(vault: string, path: string | null): Promise<void> {
  await quietly(() => (path === null ? del(LAST_NOTE) : set(LAST_NOTE, { vault, path })), undefined);
}

export async function recallNote(vault: string): Promise<string | null> {
  return quietly(async () => {
    const last = await get<{ vault: string; path: string }>(LAST_NOTE);
    return last && last.vault === vault ? last.path : null;
  }, null);
}
