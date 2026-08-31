import {
  AlreadyExistsError,
  ConflictError,
  baseName,
  parentPath,
  type FileSnapshot,
  type TreeEntry,
  type VaultAdapter,
} from '../fs/types.ts';

/**
 * A vault held in a Map, with the same contract as a real one.
 *
 * This is what the adapter seam is for. The dev fixture mounts the whole app
 * against it because a native folder picker cannot be scripted, and the store's
 * tests drive it from Node because the half of this app that can destroy
 * something is the half that most deserves testing and is least reachable
 * through a browser.
 *
 * The conflict check is real, not a stub: a fake that always accepted a write
 * would agree with any bug in the code that decides when to attempt one.
 */

export interface MemoryVault {
  adapter: VaultAdapter;
  /** Change a file behind the app's back, the way another program would. */
  touch(path: string, text: string): void;
  read(path: string): string | undefined;
  list(): string[];
  /** Drop write permission, to exercise the read-only path. */
  setWritable(writable: boolean): void;
}

export interface MemoryVaultOptions {
  name?: string;
  /** Path → contents. Parent directories are implied by the paths. */
  files: Record<string, string>;
  /** Directories with nothing in them, which no path would imply. */
  directories?: string[];
  /** Path → bytes, for images a note refers to. */
  binaries?: Record<string, Blob>;
  writable?: boolean;
}

export function createMemoryVault(options: MemoryVaultOptions): MemoryVault {
  const files = new Map<string, { text: string; modifiedAt: number }>();
  for (const [path, text] of Object.entries(options.files)) {
    files.set(path, { text, modifiedAt: Date.now() });
  }

  const extraDirectories = new Set(options.directories ?? []);
  const binaries = new Map(Object.entries(options.binaries ?? {}));
  let writable = options.writable ?? true;

  /** Every directory the current paths imply, plus the empty ones declared. */
  function directories(): Set<string> {
    const found = new Set(extraDirectories);
    for (const path of files.keys()) {
      let parent = parentPath(path);
      while (parent !== '') {
        found.add(parent);
        parent = parentPath(parent);
      }
    }
    return found;
  }

  const adapter: VaultAdapter = {
    name: options.name ?? 'demo-vault',
    get writable() {
      return writable;
    },
    async requestWrite() {
      writable = true;
      return true;
    },

    async listDir(path) {
      const entries: TreeEntry[] = [];
      for (const directory of directories()) {
        if (parentPath(directory) === path && directory !== path) {
          entries.push({ name: baseName(directory), path: directory, kind: 'directory' });
        }
      }
      for (const file of files.keys()) {
        if (parentPath(file) === path) {
          entries.push({ name: baseName(file), path: file, kind: 'file' });
        }
      }
      // A directory nothing refers to does not exist, and listing it is an error
      // rather than an empty folder — the same as a real backend.
      if (entries.length === 0 && path !== '' && !directories().has(path)) {
        throw new Error(`No such directory: "${path}"`);
      }
      return entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    },

    async readFile(path): Promise<FileSnapshot> {
      const file = files.get(path);
      if (!file) throw new Error(`No such file: "${path}"`);
      return { text: file.text, modifiedAt: file.modifiedAt };
    },

    async readBinary(path) {
      const bytes = binaries.get(path);
      if (!bytes) throw new Error(`No such file: "${path}"`);
      return bytes;
    },

    async writeFile(path, contents, expectedModifiedAt) {
      const file = files.get(path);
      if (!file) throw new Error(`No such file: "${path}"`);
      if (expectedModifiedAt !== null && Math.abs(file.modifiedAt - expectedModifiedAt) > 1000) {
        throw new ConflictError(path);
      }
      const modifiedAt = Date.now();
      files.set(path, { text: contents, modifiedAt });
      return modifiedAt;
    },

    async createFile(path) {
      if (files.has(path)) throw new AlreadyExistsError(path);
      files.set(path, { text: '', modifiedAt: Date.now() });
    },

    async renameFile(from, to) {
      if (files.has(to)) throw new AlreadyExistsError(to);
      const file = files.get(from);
      if (!file) throw new Error(`No such file: "${from}"`);
      files.set(to, file);
      files.delete(from);
    },

    async deleteFile(path) {
      files.delete(path);
    },
  };

  return {
    adapter,
    touch(path, text) {
      // Far enough ahead to clear the one-second slack the conflict check allows
      // for filesystems that report whole seconds.
      files.set(path, { text, modifiedAt: Date.now() + 10_000 });
    },
    read(path) {
      return files.get(path)?.text;
    },
    list() {
      return [...files.keys()].sort();
    },
    setWritable(next) {
      writable = next;
    },
  };
}
