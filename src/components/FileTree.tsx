import { useCallback, useRef } from 'react';
import { useVault } from '../state/vaultStore.ts';
import { useIsNarrow } from '../hooks/useMediaQuery.ts';
import { looksLikeMarkdown } from '../markdown/fromPlainText.ts';
import { FilePicker } from './FilePicker.tsx';
import type { TreeEntry } from '../fs/types.ts';

/**
 * The tree is a tree, not a list of links.
 *
 * It reads as one — `role="tree"` and `treeitem`, with folders carrying their
 * expanded state — and it moves like one: arrows walk it, and only the current
 * row is in the tab order. That last part is what a vault of any size needs.
 * With every note a tab stop, reaching the editor from the toolbar in a folder
 * of two hundred notes meant two hundred presses.
 */

function Row({ entry, depth }: { entry: TreeEntry; depth: number }) {
  const expanded = useVault((s) => s.expanded.has(entry.path));
  const loading = useVault((s) => s.loadingDirs.has(entry.path));
  const active = useVault((s) => s.activePath === entry.path);
  const children = useVault((s) => s.children[entry.path]);
  const toggleDir = useVault((s) => s.toggleDir);
  const openFile = useVault((s) => s.openFile);

  const isDir = entry.kind === 'directory';

  return (
    <>
      <div
        role="treeitem"
        aria-expanded={isDir ? expanded : undefined}
        aria-selected={active}
        // One row is reachable by Tab; the arrows reach the rest. The current
        // note is that row, so tabbing into the tree lands where you left off.
        tabIndex={active ? 0 : -1}
        className={`tree-row${active ? ' is-active' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        data-path={entry.path}
        data-kind={entry.kind}
        onClick={() => (isDir ? toggleDir(entry.path) : openFile(entry.path))}
      >
        <span className="tree-icon" aria-hidden="true">
          {isDir ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="tree-name">{entry.name}</span>
        {loading && <span className="tree-hint">…</span>}
      </div>

      {isDir && expanded && children && (
        <div role="group">
          <Level entries={children} depth={depth + 1} emptyLabel="empty" />
        </div>
      )}
    </>
  );
}

function Level({
  entries,
  depth,
  emptyLabel,
}: {
  entries: TreeEntry[];
  depth: number;
  emptyLabel: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="tree-empty" style={{ paddingLeft: `${depth * 12 + 20}px` }}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <>
      {entries.map((entry) => (
        <Row key={entry.path} entry={entry} depth={depth} />
      ))}
    </>
  );
}

export function FileTree() {
  const roots = useVault((s) => s.children['']);
  const activePath = useVault((s) => s.activePath);
  const canWrite = useVault((s) => s.canWrite);
  const createNote = useVault((s) => s.createNote);
  const renameActive = useVault((s) => s.renameActive);
  const deleteActive = useVault((s) => s.deleteActive);
  const repairActive = useVault((s) => s.repairActive);
  const toggleDir = useVault((s) => s.toggleDir);
  const openFile = useVault((s) => s.openFile);
  // The file as opened, not the draft: this decides whether a button is offered,
  // and a judgement that flickered on every keystroke would be worse than useless.
  const source = useVault((s) => s.source);
  const converted = useVault((s) => s.converted);
  const convertActive = useVault((s) => s.convertActive);
  // On a phone the drawer is for choosing a note. What you then do to that note
  // lives in the toolbar's menu, where a thumb can reach it and the targets are
  // a finger wide rather than a link in a row of links.
  const narrow = useIsNarrow();
  const mode = useVault((s) => s.mode);
  const treeRef = useRef<HTMLDivElement>(null);

  /**
   * Arrow-key movement over whatever rows are currently rendered. Reading the
   * DOM rather than rebuilding the visible order in JavaScript: expansion state
   * already decides what is on screen, and asking the page is both shorter and
   * incapable of disagreeing with it.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const rows = Array.from(
        treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
      );
      const at = rows.indexOf(event.target as HTMLElement);
      if (at === -1) return;

      const row = rows[at];
      const path = row?.dataset.path;
      const isDir = row?.dataset.kind === 'directory';
      const isExpanded = row?.getAttribute('aria-expanded') === 'true';

      const move = (to: number) => {
        event.preventDefault();
        rows[Math.min(rows.length - 1, Math.max(0, to))]?.focus();
      };

      switch (event.key) {
        case 'ArrowDown':
          return move(at + 1);
        case 'ArrowUp':
          return move(at - 1);
        case 'Home':
          return move(0);
        case 'End':
          return move(rows.length - 1);
        case 'ArrowRight':
          // Open a closed folder; step into an open one. Nothing on a file.
          if (isDir && path !== undefined && !isExpanded) {
            event.preventDefault();
            void toggleDir(path);
          } else if (isDir) {
            move(at + 1);
          }
          return;
        case 'ArrowLeft':
          if (isDir && path !== undefined && isExpanded) {
            event.preventDefault();
            void toggleDir(path);
          }
          return;
        case 'Enter':
        case ' ':
          if (path === undefined) return;
          event.preventDefault();
          void (isDir ? toggleDir(path) : openFile(path));
          return;
        default:
      }
    },
    [toggleDir, openFile],
  );

  if (!roots) return null;

  const plain = source !== null && !looksLikeMarkdown(source);

  return (
    <>
      {!narrow && (
        <div className="tree-actions">
          <button
            type="button"
            className="link-button"
            disabled={activePath === null}
            title="Rewrite this note's markdown, fixing JSON artefacts and escaped line breaks"
            onClick={repairActive}
          >
            Fix markdown
          </button>
          <button
            type="button"
            className="link-button"
            disabled={activePath === null || converted || !plain}
            title="Read this note as plain text and put the markdown syntax back into it"
            onClick={convertActive}
          >
            Plain → markdown
          </button>
        </div>
      )}
      {canWrite && (
        <div className="tree-actions">
          <button type="button" className="link-button" onClick={() => void createNote()}>
            New note
          </button>
          {/* The library has no folder to drop files into, so bringing one in is
              an action rather than a place. */}
          {mode === 'device' && <FilePicker compact />}
          {!narrow && (
            <>
              <button
                type="button"
                className="link-button"
                disabled={activePath === null}
                onClick={() => void renameActive()}
              >
                Rename
              </button>
              <button
                type="button"
                className="link-button is-danger"
                disabled={activePath === null}
                onClick={() => void deleteActive()}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
      <div
        ref={treeRef}
        role="tree"
        aria-label="Notes"
        className="tree"
        // Nothing is open yet, so nothing carries tabIndex 0. Without this the
        // tree would be unreachable by keyboard until a note had been clicked.
        tabIndex={activePath === null ? 0 : -1}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
          }
        }}
      >
        <Level entries={roots} depth={0} emptyLabel="No markdown files in this folder." />
      </div>
    </>
  );
}
