import {
  AlreadyExistsError,
  ConflictError,
  baseName,
  isMarkdownFile,
  parentPath,
  type FileSnapshot,
  type TreeEntry,
  type VaultAdapter,
} from './types';
import { forgetVault, recallVault, rememberVault } from './handleStore';
import { keepStorage } from './persist';

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

class FsAccessVault implements VaultAdapter {
  #writable: boolean;

  constructor(
    private readonly root: FileSystemDirectoryHandle,
    writable: boolean,
  ) {
    this.#writable = writable;
  }

  get name(): string {
    return this.root.name;
  }

  get writable(): boolean {
    return this.#writable;
  }

  async requestWrite(): Promise<boolean> {
    if (this.#writable) return true;
    this.#writable = (await this.root.requestPermission({ mode: 'readwrite' })) === 'granted';
    return this.#writable;
  }

  private async dirHandle(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.root;
    if (path === '') return handle;
    for (const segment of path.split('/')) {
      handle = await handle.getDirectoryHandle(segment, { create });
    }
    return handle;
  }

  private async fileHandle(path: string): Promise<FileSystemFileHandle> {
    const name = baseName(path);
    if (!name) throw new Error(`Not a file path: "${path}"`);
    const parent = await this.dirHandle(parentPath(path));
    return parent.getFileHandle(name);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.fileHandle(path);
      return true;
    } catch {
      return false;
    }
  }

  async listDir(path: string): Promise<TreeEntry[]> {
    const dir = await this.dirHandle(path);
    const entries: TreeEntry[] = [];

    for await (const handle of dir.values()) {
      // Skip dotfiles: .git, .obsidian and friends are noise in a notes tree.
      if (handle.name.startsWith('.')) continue;
      if (handle.kind === 'file' && !isMarkdownFile(handle.name)) continue;
      entries.push({
        name: handle.name,
        path: path === '' ? handle.name : `${path}/${handle.name}`,
        kind: handle.kind,
      });
    }

    // Directories first, then files, each alphabetical and case-insensitive.
    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }

  async readFile(path: string): Promise<FileSnapshot> {
    const file = await (await this.fileHandle(path)).getFile();
    return { text: await file.text(), modifiedAt: file.lastModified };
  }

  async readBinary(path: string): Promise<Blob> {
    return (await this.fileHandle(path)).getFile();
  }

  async writeFile(
    path: string,
    contents: string,
    expectedModifiedAt: number | null,
  ): Promise<number> {
    const handle = await this.fileHandle(path);

    if (expectedModifiedAt !== null) {
      const current = await handle.getFile();
      // Some filesystems report whole seconds, so allow a little slack rather
      // than crying conflict at a file nobody touched.
      if (Math.abs(current.lastModified - expectedModifiedAt) > 1000) {
        throw new ConflictError(path);
      }
    }

    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
    } catch (error) {
      // Without this the file is left truncated: createWritable() opened a swap
      // file, and abandoning it un-closed loses the write entirely.
      await writable.abort();
      throw error;
    }
    await writable.close();

    return (await handle.getFile()).lastModified;
  }

  async createFile(path: string): Promise<void> {
    if (await this.exists(path)) throw new AlreadyExistsError(path);
    const parent = await this.dirHandle(parentPath(path));
    const handle = await parent.getFileHandle(baseName(path), { create: true });
    await (await handle.createWritable()).close();
  }

  async renameFile(from: string, to: string): Promise<void> {
    if (from === to) return;
    if (await this.exists(to)) throw new AlreadyExistsError(to);

    const handle = await this.fileHandle(from);

    // Chrome has move(); everything else gets a copy-then-delete. The copy is
    // ordered before the delete so a failure loses nothing.
    if (typeof handle.move === 'function' && parentPath(from) === parentPath(to)) {
      await handle.move(baseName(to));
      return;
    }

    const contents = await (await handle.getFile()).text();
    const parent = await this.dirHandle(parentPath(to));
    const created = await parent.getFileHandle(baseName(to), { create: true });
    const writable = await created.createWritable();
    await writable.write(contents);
    await writable.close();
    await this.deleteFile(from);
  }

  async deleteFile(path: string): Promise<void> {
    const parent = await this.dirHandle(parentPath(path));
    await parent.removeEntry(baseName(path));
  }
}

/**
 * The app asks for write access when the folder is chosen, not at the first
 * keystroke. An editor that waits until you are mid-sentence to interrupt with
 * a permission dialog is worse, not more principled — and autosave firing on a
 * timer has no user gesture to attach a prompt to.
 *
 * Denial is still handled: the app runs read-only and offers to ask again.
 */
export async function pickVault(): Promise<VaultAdapter> {
  const handle = await window.showDirectoryPicker({
    id: 'markdown-machine',
    mode: 'readwrite',
  });
  await rememberVault(handle);
  await keepStorage();
  const writable = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  return new FsAccessVault(handle, writable);
}


/**
 * Silently reopen the last folder if the browser still considers a permission
 * granted. Never prompts — safe to call on load.
 */
export async function restoreVault(): Promise<VaultAdapter | null> {
  const handle = await recallVault();
  if (!handle) return null;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    return new FsAccessVault(handle, true);
  }
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') {
    return new FsAccessVault(handle, false);
  }
  return null;
}

/**
 * Reopen the last folder, prompting. Chrome requires a user gesture, which is
 * why the UI shows a "Reopen <folder>" button rather than failing quietly on load.
 */
export async function reopenVault(): Promise<VaultAdapter | null> {
  const handle = await recallVault();
  if (!handle) return null;
  if ((await handle.requestPermission({ mode: 'readwrite' })) === 'granted') {
    return new FsAccessVault(handle, true);
  }
  // Write was refused, but a read grant from an earlier session may still stand.
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') {
    return new FsAccessVault(handle, false);
  }
  return null;
}

/** Name of the remembered folder, for labelling the reopen button. */
export async function rememberedVaultName(): Promise<string | null> {
  const handle = await recallVault();
  return handle?.name ?? null;
}

export { forgetVault };
