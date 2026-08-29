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

export interface FileSnapshot {
  text: string;
  /** Modification time as the backend saw it, for conflict detection on write. */
  modifiedAt: number;
}

/**
 * Raised when a file changed underneath us between the read and the write.
 * Autosave makes this a real hazard rather than a theoretical one: an editor
 * left open in a second tab, or a git checkout, would otherwise be silently
 * overwritten by whatever this buffer happened to hold.
 */
export class ConflictError extends Error {
  constructor(readonly path: string) {
    super(`"${path}" changed on disk since it was opened.`);
    this.name = 'ConflictError';
  }
}

/** Raised when a create or rename would land on a file that already exists. */
export class AlreadyExistsError extends Error {
  constructor(readonly path: string) {
    super(`"${path}" already exists.`);
    this.name = 'AlreadyExistsError';
  }
}

export interface VaultAdapter {
  /** Display name of the opened folder. */
  readonly name: string;
  /** Whether the backend currently holds write permission. */
  readonly writable: boolean;
  /** Ask to upgrade to write access. Must be called from a user gesture. */
  requestWrite(): Promise<boolean>;

  /** Immediate children of a directory. Lazy — never walks the whole tree. */
  listDir(path: string): Promise<TreeEntry[]>;
  /** UTF-8 contents of a file, with the modification time that came with them. */
  readFile(path: string): Promise<FileSnapshot>;
  /** Raw bytes, for images referenced from a note. */
  readBinary(path: string): Promise<Blob>;

  /**
   * Overwrite a file, returning its new modification time.
   *
   * `expectedModifiedAt` is the value from the read this write is based on; the
   * adapter raises ConflictError if the file has moved on since. Pass null only
   * to overwrite deliberately, once a person has been asked.
   */
  writeFile(path: string, contents: string, expectedModifiedAt: number | null): Promise<number>;
  /** Create an empty file. Raises AlreadyExistsError rather than clobbering. */
  createFile(path: string): Promise<void>;
  /** Rename within the vault. Raises AlreadyExistsError rather than clobbering. */
  renameFile(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
}

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'];

export function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** The directory part of a vault path, or '' for a file at the root. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** The final segment of a vault path. */
export function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
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
