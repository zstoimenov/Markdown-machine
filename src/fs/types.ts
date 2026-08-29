/**
 * The seam.
 *
 * Every component talks to a VaultAdapter, never to a browser API directly.
 * Swapping in a local server, a git backend or cloud sync later means writing
 * one new adapter, not touching the UI.
 *
 * Paths are vault-relative, '/' separated, with no leading slash. The vault
 * root is the empty string.
 */

export type EntryKind = 'file' | 'directory';

export interface TreeEntry {
  name: string;
  /** Vault-relative path, '/' separated. */
  path: string;
  kind: EntryKind;
}

export interface VaultAdapter {
  /** Display name of the opened folder. */
  readonly name: string;
  /** Immediate children of a directory. Lazy — never walks the whole tree. */
  listDir(path: string): Promise<TreeEntry[]>;
  /** UTF-8 text contents of a file. */
  readFile(path: string): Promise<string>;
  /** Raw bytes, for images referenced from a note. */
  readBinary(path: string): Promise<Blob>;
}

/**
 * Write operations land in M3, alongside the dirty-state tracking, the
 * confirm-before-destructive-action guard and the one-step undo buffer that
 * make writing to somebody's real files safe. Declaring them here before
 * any of that exists would invite calling them.
 */

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'];

export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Resolve a link against the directory holding `fromPath`. A leading '/' means
 *  the vault root, not the filesystem root — there is nothing above the vault. */
export function resolvePath(fromPath: string, target: string): string {
  const base = target.startsWith('/') ? [] : fromPath.split('/').slice(0, -1);
  const segments = target.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') base.pop();
    else base.push(segment);
  }
  return base.join('/');
}
