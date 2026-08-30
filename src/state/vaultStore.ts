import { create } from 'zustand';
import {
  AlreadyExistsError,
  ConflictError,
  baseName,
  isMarkdownFile,
  parentPath,
  type TreeEntry,
  type VaultAdapter,
} from '../fs/types';
import type { EditorView } from '@codemirror/view';
import { canShareFile, downloadText, shareText } from '../fs/singleFileAdapter';
import { deviceNoteCount, importFile, openDeviceVault } from '../fs/deviceAdapter';
import { diagnose, repair, type RepairIssue } from '../markdown/repair';
import { toMarkdown } from '../markdown/fromPlainText';
import {
  forgetVault,
  isSupported,
  pickVault,
  rememberedVaultName,
  reopenVault,
  restoreVault,
} from '../fs/fsAccessAdapter';

export type VaultStatus =
  /** Deciding, on first paint, which of the states below we are actually in. */
  | 'checking'
  /** Not a Chromium browser — no folder access is possible. */
  | 'unsupported'
  /** Supported, but no folder has ever been opened. */
  | 'empty'
  /** A folder is remembered, but Chrome dropped its permission across reloads. */
  | 'needs-permission'
  | 'ready';

export type ViewMode = 'split' | 'editor' | 'preview';

/**
 * 'vault' is the real thing: a folder, read and written in place. 'device' is
 * what a browser without the File System Access API gets instead: notes kept in
 * that browser, on that device. It is a real vault — writable, holding more than
 * one note, surviving a reload — which the read-only single file it replaced was
 * not. What it is not is a folder on your disk, which is why saving a copy out
 * stays the way notes leave.
 */
export type VaultMode = 'vault' | 'device';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  /** The file changed on disk under us. Autosave stops until this is resolved. */
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

interface VaultState {
  status: VaultStatus;
  adapter: VaultAdapter | null;
  vaultName: string | null;
  mode: VaultMode;
  canWrite: boolean;
  rememberedName: string | null;
  children: Record<string, TreeEntry[]>;
  expanded: Set<string>;
  loadingDirs: Set<string>;

  activePath: string | null;
  /** The file as it is on disk, as of the last read or write. */
  source: string | null;
  /** The buffer being edited. Equal to `source` until something is typed. */
  draft: string | null;
  /** Modification time the buffer is based on, for conflict detection. */
  modifiedAt: number | null;
  /**
   * Contents of each file as it stood before this session first wrote to it,
   * so a person always has one step back from whatever autosave has done.
   */
  originals: Record<string, string>;
  /** Bumped to force the editor to reload its document from the store. */
  revision: number;
  /**
   * The live editor, when one is mounted. Held here so a repair can be applied
   * as an ordinary edit inside CodeMirror — which keeps it on the undo stack —
   * rather than by swapping the document out from under it.
   */
  editorView: EditorView | null;
  /** Problems found in the open file that a repair would address. */
  repairs: RepairIssue[];
  /** Set once someone has waved the repair offer away for this file. */
  repairDismissed: boolean;
  /** Set once a note has been run through the plain-text conversion. */
  converted: boolean;
  /** Only meaningful at phone widths, where the file tree is a drawer. */
  sidebarOpen: boolean;
  loadingFile: boolean;
  saveState: SaveState;
  viewMode: ViewMode;
  error: string | null;

  init: () => Promise<void>;
  pick: () => Promise<void>;
  reopen: () => Promise<void>;
  close: () => Promise<void>;
  enableWriting: () => Promise<void>;
  openLooseFile: (file: File) => Promise<void>;
  downloadActive: () => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  setDraft: (value: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setEditorView: (view: EditorView | null) => void;
  repairActive: () => void;
  convertActive: () => void;
  dismissRepair: () => void;
  setSidebarOpen: (open: boolean) => void;

  save: (options?: { overwrite?: boolean }) => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  revert: () => void;
  createNote: () => Promise<void>;
  renameActive: () => Promise<void>;
  deleteActive: () => Promise<void>;
}

/** True when the buffer has diverged from what is on disk. */
export function isDirty(state: { source: string | null; draft: string | null }): boolean {
  return state.draft !== null && state.source !== null && state.draft !== state.source;
}

/** True when this session has written to the open file and could still step back. */
export function canRevert(state: {
  activePath: string | null;
  draft: string | null;
  originals: Record<string, string>;
}): boolean {
  if (state.activePath === null) return false;
  const original = state.originals[state.activePath];
  return original !== undefined && original !== state.draft;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A cancelled picker or prompt is a normal thing to do, not an error to report. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export const useVault = create<VaultState>((set, get) => {
  async function adopt(adapter: VaultAdapter, mode: VaultMode = 'vault') {
    const roots = await adapter.listDir('');
    set({
      status: 'ready',
      adapter,
      mode,
      vaultName: adapter.name,
      canWrite: adapter.writable,
      rememberedName: adapter.name,
      children: { '': roots },
      expanded: new Set<string>(),
      loadingDirs: new Set<string>(),
      activePath: null,
      source: null,
      draft: null,
      modifiedAt: null,
      originals: {},
      saveState: { kind: 'idle' },
      error: null,
    });
  }

  /** Re-read one directory after it changes on disk. */
  async function refreshDir(path: string) {
    const { adapter } = get();
    if (!adapter) return;
    try {
      const entries = await adapter.listDir(path);
      set((state) => ({ children: { ...state.children, [path]: entries } }));
    } catch (error) {
      set({ error: `Could not re-read ${path || 'the folder'}: ${describe(error)}` });
    }
  }

  /** Load a file into the buffer, discarding whatever was there. */
  async function load(path: string) {
    const { adapter } = get();
    if (!adapter) return;
    set({ activePath: path, loadingFile: true, source: null, draft: null, error: null });
    try {
      const { text, modifiedAt } = await adapter.readFile(path);
      // Guard against a slow read landing after the user clicked elsewhere.
      if (get().activePath !== path) return;
      set((state) => {
        // A fresh read establishes a new baseline, so the old undo snapshot has
        // to go with it. Keeping it would let Revert quietly reinstate content
        // from before a conflict reload — overwriting the very changes the
        // person just chose to keep.
        const originals = { ...state.originals };
        delete originals[path];
        return {
          source: text,
          draft: text,
          modifiedAt,
          originals,
          loadingFile: false,
          revision: state.revision + 1,
          saveState: { kind: 'idle' },
          repairs: diagnose(text),
          repairDismissed: false,
          converted: false,
        };
      });
    } catch (error) {
      if (get().activePath !== path) return;
      set({
        loadingFile: false,
        source: null,
        draft: null,
        modifiedAt: null,
        error: `Could not open ${path}: ${describe(error)}`,
      });
    }
  }

  return {
    status: 'checking',
    adapter: null,
    vaultName: null,
    mode: 'vault',
    canWrite: false,
    rememberedName: null,
    children: {},
    expanded: new Set<string>(),
    loadingDirs: new Set<string>(),
    activePath: null,
    source: null,
    draft: null,
    modifiedAt: null,
    originals: {},
    revision: 0,
    editorView: null,
    repairs: [],
    repairDismissed: false,
    converted: false,
    sidebarOpen: false,
    loadingFile: false,
    saveState: { kind: 'idle' },
    viewMode: 'split',
    error: null,

    async init() {
      if (!isSupported()) {
        // Notes already kept here are opened straight into; an empty library
        // still explains itself first, since nobody arrives expecting one.
        if ((await deviceNoteCount()) > 0) {
          await adopt(await openDeviceVault(), 'device');
          return;
        }
        set({ status: 'unsupported' });
        return;
      }
      try {
        const adapter = await restoreVault();
        if (adapter) {
          await adopt(adapter);
          return;
        }
        const remembered = await rememberedVaultName();
        set({
          status: remembered ? 'needs-permission' : 'empty',
          rememberedName: remembered,
        });
      } catch (error) {
        set({ status: 'empty', error: describe(error) });
      }
    },

    async pick() {
      try {
        await adopt(await pickVault());
      } catch (error) {
        if (isAbort(error)) return;
        set({ error: describe(error) });
      }
    },

    async reopen() {
      try {
        const adapter = await reopenVault();
        if (!adapter) {
          set({ error: 'Permission to open that folder was declined.' });
          return;
        }
        await adopt(adapter);
      } catch (error) {
        if (isAbort(error)) return;
        set({ error: describe(error) });
      }
    },

    /**
     * Put the vault down. On the device path that means walking away from the
     * notes, not deleting them — they are still there on the next visit, and
     * there is no picker to send anyone back to.
     */
    async close() {
      await forgetVault();
      set({
        status: isSupported() ? 'empty' : 'unsupported',
        adapter: null,
        vaultName: null,
        mode: 'vault',
        canWrite: false,
        rememberedName: null,
        children: {},
        expanded: new Set<string>(),
        loadingDirs: new Set<string>(),
        activePath: null,
        source: null,
        draft: null,
        modifiedAt: null,
        originals: {},
        saveState: { kind: 'idle' },
        error: null,
      });
    },

    async enableWriting() {
      const { adapter } = get();
      if (!adapter) return;
      try {
        const granted = await adapter.requestWrite();
        set({
          canWrite: granted,
          error: granted ? null : 'Write access was declined, so notes stay read-only.',
        });
      } catch (error) {
        set({ error: describe(error) });
      }
    },

    /**
     * A file the browser handed over is kept rather than merely read. Holding it
     * in memory was the old behaviour and the old bug: a reload, or iOS
     * discarding a backgrounded tab, took the note and every edit with it.
     */
    async openLooseFile(file) {
      const { adapter: current, mode } = get();
      const name = await importFile(file);
      if (current === null || mode !== 'device') {
        await adopt(await openDeviceVault(), 'device');
      } else {
        await refreshDir('');
      }
      await load(name);
    },

    /**
     * Get the note out of a browser that cannot write it back. The share sheet
     * where there is one — on iOS that is the only route to the folder the note
     * came from — and a download everywhere else.
     */
    async downloadActive() {
      const { activePath, draft, source } = get();
      const contents = draft ?? source;
      if (activePath === null || contents === null) return;
      if (canShareFile() && (await shareText(activePath, contents))) return;
      downloadText(activePath, contents);
    },

    async toggleDir(path) {
      const { adapter, expanded, children, loadingDirs } = get();
      if (!adapter) return;

      const next = new Set(expanded);
      if (next.has(path)) {
        next.delete(path);
        set({ expanded: next });
        return;
      }
      next.add(path);
      set({ expanded: next });

      // Directories are read once and cached; expanding is cheap after that.
      if (children[path] || loadingDirs.has(path)) return;

      const loading = new Set(loadingDirs).add(path);
      set({ loadingDirs: loading });
      try {
        const entries = await adapter.listDir(path);
        set((state) => ({ children: { ...state.children, [path]: entries } }));
      } catch (error) {
        set({ error: `Could not read ${path || 'the folder'}: ${describe(error)}` });
      } finally {
        set((state) => {
          const done = new Set(state.loadingDirs);
          done.delete(path);
          return { loadingDirs: done };
        });
      }
    },

    async openFile(path) {
      const state = get();
      // Choosing anything in the drawer dismisses it, including the note already
      // open — otherwise that tap does nothing and the drawer stays in the way.
      set({ sidebarOpen: false });
      if (!state.adapter || state.activePath === path) return;

      // Autosave normally means there is nothing pending, but a failed or
      // conflicted save leaves real edits with nowhere to go. Ask before dropping them.
      if (isDirty(state)) {
        const stay = !window.confirm(
          `"${state.activePath}" has unsaved changes that could not be written to disk.\n\n` +
            'Leaving this note discards them. Leave anyway?',
        );
        if (stay) return;
      }
      await load(path);
    },

    setDraft(value) {
      set((state) => ({
        draft: value,
        // A fresh edit clears a stale "saved" or "error" note, but never a
        // conflict: that one is only resolved by choosing what to do about it.
        saveState: state.saveState.kind === 'conflict' ? state.saveState : { kind: 'idle' },
      }));
    },

    setViewMode(mode) {
      set({ viewMode: mode });
    },

    setEditorView(view) {
      set({ editorView: view });
    },

    /**
     * Rewrite the buffer, never the file. Autosave carries it to disk a moment
     * later, by which point Ctrl+Z and Revert both still undo it — a repair is a
     * suggestion to review, not something done to someone's notes behind their back.
     */
    repairActive() {
      const { draft, source, editorView } = get();
      const current = draft ?? source;
      if (current === null) return;

      const { text } = repair(current);
      if (text === current) {
        set({ repairs: [], repairDismissed: true });
        return;
      }

      if (editorView) {
        // One transaction, so a single Ctrl+Z takes the whole repair back.
        editorView.dispatch({
          changes: { from: 0, to: editorView.state.doc.length, insert: text },
          userEvent: 'input.repair',
        });
      } else {
        // No editor mounted (reading mode): push it through the store instead.
        set((state) => ({ draft: text, revision: state.revision + 1 }));
      }
      set({ repairs: [], repairDismissed: true });
    },

    /**
     * The other direction from `plaintext.ts`: read the buffer as plain text and
     * put the markdown back into it. Like a repair it rewrites the buffer rather
     * than the file, so it is read before it is kept and one Ctrl+Z takes it back.
     */
    convertActive() {
      const { draft, source, editorView } = get();
      const current = draft ?? source;
      if (current === null) return;

      const { text } = toMarkdown(current);
      if (text === current) {
        set({ converted: true });
        return;
      }

      if (editorView) {
        // One transaction, so a single Ctrl+Z takes the whole conversion back.
        editorView.dispatch({
          changes: { from: 0, to: editorView.state.doc.length, insert: text },
          userEvent: 'input.convert',
        });
      } else {
        // No editor mounted (reading mode): push it through the store instead.
        set((state) => ({ draft: text, revision: state.revision + 1 }));
      }
      set({ converted: true });
    },

    dismissRepair() {
      set({ repairDismissed: true });
    },

    setSidebarOpen(open) {
      set({ sidebarOpen: open });
    },

    async save(options) {
      const state = get();
      const { adapter, activePath, draft, source } = state;
      if (!adapter || activePath === null || draft === null || source === null) return;
      if (draft === source) return;

      if (!state.canWrite) {
        set({ saveState: { kind: 'error', message: 'No write access to this folder.' } });
        return;
      }
      if (state.saveState.kind === 'conflict' && !options?.overwrite) return;

      // Snapshot what is being written: the buffer can move on mid-write, and the
      // result must describe the bytes that actually landed, not the latest keystroke.
      const pending = draft;
      set({ saveState: { kind: 'saving' } });

      try {
        const modifiedAt = await adapter.writeFile(
          activePath,
          pending,
          options?.overwrite ? null : state.modifiedAt,
        );
        if (get().activePath !== activePath) return;
        set((current) => ({
          source: pending,
          modifiedAt,
          // One step back from whatever autosave has done since the file was opened.
          originals:
            current.originals[activePath] === undefined
              ? { ...current.originals, [activePath]: source }
              : current.originals,
          saveState: { kind: 'saved', at: Date.now() },
        }));
      } catch (error) {
        if (get().activePath !== activePath) return;
        set({
          saveState:
            error instanceof ConflictError
              ? { kind: 'conflict' }
              : { kind: 'error', message: describe(error) },
        });
      }
    },

    async reloadFromDisk() {
      const { activePath } = get();
      if (activePath !== null) await load(activePath);
    },

    revert() {
      const state = get();
      if (state.activePath === null) return;
      const original = state.originals[state.activePath];
      if (original === undefined) return;
      set((current) => ({ draft: original, revision: current.revision + 1 }));
      void get().save();
    },

    async createNote() {
      const state = get();
      if (!state.adapter || !state.canWrite) return;

      // New notes land beside the note being read, which is nearly always where
      // they belong; the root is the fallback when nothing is open.
      const directory = state.activePath === null ? '' : parentPath(state.activePath);
      set({ error: null });
      const answer = window.prompt('Name for the new note', 'Untitled.md');
      if (answer === null) return;
      const name = isMarkdownFile(answer.trim()) ? answer.trim() : `${answer.trim()}.md`;
      if (name === '.md') return;

      const path = directory === '' ? name : `${directory}/${name}`;
      try {
        await state.adapter.createFile(path);
        await refreshDir(directory);
        await get().openFile(path);
      } catch (error) {
        set({
          error:
            error instanceof AlreadyExistsError
              ? `"${name}" already exists in that folder.`
              : `Could not create ${name}: ${describe(error)}`,
        });
      }
    },

    async renameActive() {
      const state = get();
      const { adapter, activePath } = state;
      if (!adapter || activePath === null || !state.canWrite) return;

      set({ error: null });
      const answer = window.prompt('Rename note', baseName(activePath));
      if (answer === null) return;
      const name = isMarkdownFile(answer.trim()) ? answer.trim() : `${answer.trim()}.md`;
      if (name === '.md' || name === baseName(activePath)) return;

      const directory = parentPath(activePath);
      const target = directory === '' ? name : `${directory}/${name}`;

      // Renaming a file with unsaved edits would rename the old bytes and leave
      // the buffer pointing at a path that no longer exists. Land them first.
      if (isDirty(state)) await get().save();
      if (isDirty(get())) {
        set({ error: 'Save the note before renaming it — its changes are not on disk yet.' });
        return;
      }

      try {
        await adapter.renameFile(activePath, target);
        await refreshDir(directory);
        set({ activePath: target });
      } catch (error) {
        set({
          error:
            error instanceof AlreadyExistsError
              ? `"${name}" already exists in that folder.`
              : `Could not rename ${baseName(activePath)}: ${describe(error)}`,
        });
      }
    },

    async deleteActive() {
      const state = get();
      const { adapter, activePath } = state;
      if (!adapter || activePath === null || !state.canWrite) return;

      set({ error: null });
      const confirmed = window.confirm(
        `Delete "${activePath}"?\n\nThis removes the file from your disk and cannot be undone here.`,
      );
      if (!confirmed) return;

      const directory = parentPath(activePath);
      try {
        await adapter.deleteFile(activePath);
        set((current) => {
          const originals = { ...current.originals };
          delete originals[activePath];
          return {
            activePath: null,
            source: null,
            draft: null,
            modifiedAt: null,
            originals,
            saveState: { kind: 'idle' },
          };
        });
        await refreshDir(directory);
      } catch (error) {
        set({ error: `Could not delete ${baseName(activePath)}: ${describe(error)}` });
      }
    },
  };
});
