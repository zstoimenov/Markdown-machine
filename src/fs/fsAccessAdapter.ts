import { isMarkdownFile, type TreeEntry, type VaultAdapter } from './types';
import { forgetVault, recallVault, rememberVault } from './handleStore';

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

class FsAccessVault implements VaultAdapter {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  get name(): string {
    return this.root.name;
  }

  private async dirHandle(path: string): Promise<FileSystemDirectoryHandle> {
    let handle = this.root;
    if (path === '') return handle;
    for (const segment of path.split('/')) {
      handle = await handle.getDirectoryHandle(segment);
    }
    return handle;
  }

  private async fileHandle(path: string): Promise<FileSystemFileHandle> {
    const segments = path.split('/');
    const name = segments.pop();
    if (!name) throw new Error(`Not a file path: "${path}"`);
    const parent = await this.dirHandle(segments.join('/'));
    return parent.getFileHandle(name);
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

  async readFile(path: string): Promise<string> {
    const handle = await this.fileHandle(path);
    const file = await handle.getFile();
    return file.text();
  }

  async readBinary(path: string): Promise<Blob> {
    const handle = await this.fileHandle(path);
    return handle.getFile();
  }
}

/**
 * M1 only reads, so it only ever asks for read permission. The upgrade to
 * 'readwrite' happens in M3, at the point the app actually earns it.
 */
const MODE = 'read' as const;

/** Prompt for a folder. Must be called from a user gesture. */
export async function pickVault(): Promise<VaultAdapter> {
  const handle = await window.showDirectoryPicker({ id: 'markdown-machine', mode: MODE });
  await rememberVault(handle);
  return new FsAccessVault(handle);
}

/**
 * Silently reopen the last folder, but only if the browser still considers the
 * permission granted. Never prompts — safe to call on load.
 */
export async function restoreVault(): Promise<VaultAdapter | null> {
  const handle = await recallVault();
  if (!handle) return null;
  if ((await handle.queryPermission({ mode: MODE })) !== 'granted') return null;
  return new FsAccessVault(handle);
}

/**
 * Reopen the last folder, prompting for permission. Chrome requires a user
 * gesture here, which is why the UI shows a "Reopen <folder>" button rather
 * than trying and failing quietly on load.
 */
export async function reopenVault(): Promise<VaultAdapter | null> {
  const handle = await recallVault();
  if (!handle) return null;
  if ((await handle.requestPermission({ mode: MODE })) !== 'granted') return null;
  return new FsAccessVault(handle);
}

/** Name of the remembered folder, for labelling the reopen button. */
export async function rememberedVaultName(): Promise<string | null> {
  const handle = await recallVault();
  return handle?.name ?? null;
}

export { forgetVault };
