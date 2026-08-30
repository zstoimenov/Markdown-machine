import { get, set, del } from 'idb-keyval';

const KEY = 'markdown-machine:vault-handle';
const LAST_NOTE = 'markdown-machine:last-note';

/**
 * Directory handles are structured-cloneable, so IndexedDB can hold one across
 * reloads. The permission that comes with it does not survive — see
 * fsAccessAdapter.restoreVault / reopenVault.
 */
export async function rememberVault(handle: FileSystemDirectoryHandle): Promise<void> {
  await set(KEY, handle);
}

export async function recallVault(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await get<FileSystemDirectoryHandle>(KEY);
  return handle ?? null;
}

export async function forgetVault(): Promise<void> {
  await del(KEY);
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
  if (path === null) await del(LAST_NOTE);
  else await set(LAST_NOTE, { vault, path });
}

export async function recallNote(vault: string): Promise<string | null> {
  const last = await get<{ vault: string; path: string }>(LAST_NOTE);
  return last && last.vault === vault ? last.path : null;
}
