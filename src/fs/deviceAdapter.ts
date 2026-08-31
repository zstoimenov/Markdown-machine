import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';
import {
  AlreadyExistsError,
  ConflictError,
  baseName,
  trashPathFor,
  TRASH_DIR,
  type FileSnapshot,
  type TreeEntry,
  type VaultAdapter,
} from './types.ts';
import { keepStorage } from './persist.ts';

/**
 * Notes kept in this browser, on this device.
 *
 * This is what a browser without the File System Access API can have instead of
 * a folder — which on iOS is every browser, since they are all Safari
 * underneath, and Safari ships only the sandboxed part of the API. The previous
 * answer there was to hold one opened file in memory and offer a download,
 * which meant a reload, or iOS discarding a backgrounded tab, took the note and
 * every edit with it. Whatever else is true of browser storage, it survives that.
 *
 * IndexedDB rather than the Origin Private File System, which would have been
 * the obvious choice: Safari does not implement `createWritable`, so writing to
 * OPFS there needs a dedicated worker holding sync access handles. That is a
 * great deal of machinery for keeping some text between reloads, it is the same
 * site storage underneath with the same eviction rules, and `idb-keyval` is
 * already here for the folder handle.
 *
 * A note per key, in a store of its own, so saving one note does not rewrite
 * the rest of them. The library is flat: directories would be a shape with
 * nothing on the other side of it to match.
 */

/**
 * Opened on first use rather than on import. `createStore` calls
 * `indexedDB.open` there and then, which meant every folder-mode launch opened a
 * second database it would never read — and made the module impossible to import
 * anywhere without IndexedDB, which is where the store's own tests run.
 */
let opened: UseStore | null = null;
function store(): UseStore {
  opened ??= createStore('markdown-machine-notes', 'notes');
  return opened;
}

interface StoredNote {
  text: string;
  modifiedAt: number;
}

/**
 * The library is flat, so a key is a file name — except for trashed notes, which
 * keep the `.trash/` in front to stay out of the listing. There are no
 * directories here to put one in; the prefix is standing in for one.
 */
function keyFor(path: string): string {
  return path.startsWith(`${TRASH_DIR}/`) ? path : baseName(path);
}

class DeviceVault implements VaultAdapter {
  get name(): string {
    return 'On this device';
  }

  /** Always. There is nothing to ask anyone for. */
  get writable(): boolean {
    return true;
  }

  async requestWrite(): Promise<boolean> {
    return true;
  }

  async listDir(path: string): Promise<TreeEntry[]> {
    if (path !== '') return [];
    const names = (await entries<string, StoredNote>(store()))
      .map(([name]) => String(name))
      // Thrown away, not gone. Out of the listing for the same reason the
      // folder backend's `.trash` directory is.
      .filter((name) => !name.startsWith(`${TRASH_DIR}/`));
    return names
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map((name) => ({ name, path: name, kind: 'file' as const }));
  }

  async readFile(path: string): Promise<FileSnapshot> {
    const note = await get<StoredNote>(keyFor(path), store());
    if (!note) throw new Error(`Not here: "${path}"`);
    return { text: note.text, modifiedAt: note.modifiedAt };
  }

  async readBinary(): Promise<Blob> {
    // Images live beside a note in a folder, and there is no folder here.
    throw new Error('Images need a folder, which this browser cannot open.');
  }

  async writeFile(
    path: string,
    contents: string,
    expectedModifiedAt: number | null,
  ): Promise<number> {
    const key = keyFor(path);
    const current = await get<StoredNote>(key, store());
    // Nothing else writes here, so this cannot fire in practice — but the
    // contract is the contract, and a second tab is not impossible.
    if (
      expectedModifiedAt !== null &&
      current !== undefined &&
      current.modifiedAt !== expectedModifiedAt
    ) {
      throw new ConflictError(path);
    }

    const modifiedAt = Date.now();
    await set(key, { text: contents, modifiedAt }, store());
    return modifiedAt;
  }

  async createFile(path: string): Promise<void> {
    const key = keyFor(path);
    if ((await get<StoredNote>(key, store())) !== undefined) throw new AlreadyExistsError(path);
    await set(key, { text: '', modifiedAt: Date.now() }, store());
  }

  async renameFile(from: string, to: string): Promise<void> {
    const source = await get<StoredNote>(keyFor(from), store());
    if (!source) throw new Error(`Not here: "${from}"`);
    if ((await get<StoredNote>(keyFor(to), store())) !== undefined) throw new AlreadyExistsError(to);
    await set(keyFor(to), source, store());
    await del(keyFor(from), store());
  }

  async deleteFile(path: string): Promise<void> {
    await del(keyFor(path), store());
  }

  async trashFile(path: string): Promise<string> {
    const target = trashPathFor(path);
    await this.renameFile(path, target);
    return target;
  }
}

/** How many notes are already here, for deciding whether to open straight into them. */
export async function deviceNoteCount(): Promise<number> {
  try {
    return (await entries(store())).length;
  } catch {
    return 0;
  }
}

export async function openDeviceVault(): Promise<VaultAdapter> {
  // Asked for here as well as when a folder is picked: on this path the notes
  // themselves are the site data, so eviction is not an inconvenience.
  await keepStorage();
  return new DeviceVault();
}

/**
 * Take a file the browser handed over and keep it. The name is made unique
 * rather than overwriting a note already under it — an import is not an
 * instruction to replace anything.
 */
export async function importFile(file: File): Promise<string> {
  const text = await file.text();
  const name = await freeName(file.name || 'Untitled.md');
  await set(name, { text, modifiedAt: file.lastModified || Date.now() }, store());
  return name;
}

async function freeName(name: string): Promise<string> {
  const taken = new Set(
    (await entries<string, StoredNote>(store())).map(([key]) => String(key)),
  );
  if (!taken.has(name)) return name;

  const cut = name.lastIndexOf('.');
  const stem = cut === -1 ? name : name.slice(0, cut);
  const extension = cut === -1 ? '' : name.slice(cut);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} ${n}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}
