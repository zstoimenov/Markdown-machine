import { create } from 'zustand';
import type { TreeEntry, VaultAdapter } from '../fs/types';
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

interface VaultState {
  status: VaultStatus;
  adapter: VaultAdapter | null;
  vaultName: string | null;
  /** Name of the remembered folder, for labelling the reopen button. */
  rememberedName: string | null;
  /** Children by directory path. Populated lazily as directories are expanded. */
  children: Record<string, TreeEntry[]>;
  expanded: Set<string>;
  loadingDirs: Set<string>;
  activePath: string | null;
  source: string | null;
  loadingFile: boolean;
  error: string | null;

  init: () => Promise<void>;
  pick: () => Promise<void>;
  reopen: () => Promise<void>;
  close: () => Promise<void>;
  toggleDir: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** A cancelled folder picker is a normal thing to do, not an error to report. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export const useVault = create<VaultState>((set, get) => {
  async function adopt(adapter: VaultAdapter) {
    const roots = await adapter.listDir('');
    set({
      status: 'ready',
      adapter,
      vaultName: adapter.name,
      rememberedName: adapter.name,
      children: { '': roots },
      expanded: new Set<string>(),
      loadingDirs: new Set<string>(),
      activePath: null,
      source: null,
      error: null,
    });
  }

  return {
    status: 'checking',
    adapter: null,
    vaultName: null,
    rememberedName: null,
    children: {},
    expanded: new Set<string>(),
    loadingDirs: new Set<string>(),
    activePath: null,
    source: null,
    loadingFile: false,
    error: null,

    async init() {
      if (!isSupported()) {
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
          set({ error: 'Permission to read that folder was declined.' });
          return;
        }
        await adopt(adapter);
      } catch (error) {
        if (isAbort(error)) return;
        set({ error: describe(error) });
      }
    },

    async close() {
      await forgetVault();
      set({
        status: 'empty',
        adapter: null,
        vaultName: null,
        rememberedName: null,
        children: {},
        expanded: new Set<string>(),
        loadingDirs: new Set<string>(),
        activePath: null,
        source: null,
        error: null,
      });
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
      const { adapter } = get();
      if (!adapter) return;
      set({ activePath: path, loadingFile: true, error: null });
      try {
        const source = await adapter.readFile(path);
        // Guard against a slow read landing after the user clicked elsewhere.
        if (get().activePath !== path) return;
        set({ source, loadingFile: false });
      } catch (error) {
        if (get().activePath !== path) return;
        set({
          loadingFile: false,
          source: null,
          error: `Could not open ${path}: ${describe(error)}`,
        });
      }
    },
  };
});
