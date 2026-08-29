import { get, set, del } from 'idb-keyval';

const KEY = 'markdown-machine:vault-handle';

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
