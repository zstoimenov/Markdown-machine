import { useVault } from '../state/vaultStore';
import { looksLikeMarkdown } from '../markdown/fromPlainText';
import type { TreeEntry } from '../fs/types';

function Row({ entry, depth }: { entry: TreeEntry; depth: number }) {
  const expanded = useVault((s) => s.expanded.has(entry.path));
  const loading = useVault((s) => s.loadingDirs.has(entry.path));
  const active = useVault((s) => s.activePath === entry.path);
  const children = useVault((s) => s.children[entry.path]);
  const toggleDir = useVault((s) => s.toggleDir);
  const openFile = useVault((s) => s.openFile);

  const isDir = entry.kind === 'directory';
  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  return (
    <>
      <button
        type="button"
        className={`tree-row${active ? ' is-active' : ''}`}
        style={indent}
        aria-expanded={isDir ? expanded : undefined}
        onClick={() => (isDir ? toggleDir(entry.path) : openFile(entry.path))}
      >
        <span className="tree-icon" aria-hidden="true">
          {isDir ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="tree-name">{entry.name}</span>
        {loading && <span className="tree-hint">…</span>}
      </button>

      {isDir && expanded && children && (
        <Level entries={children} depth={depth + 1} emptyLabel="empty" />
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
  // The file as opened, not the draft: this decides whether a button is offered,
  // and a judgement that flickered on every keystroke would be worse than useless.
  const source = useVault((s) => s.source);
  const converted = useVault((s) => s.converted);
  const convertActive = useVault((s) => s.convertActive);

  if (!roots) return null;

  const plain = source !== null && !looksLikeMarkdown(source);

  return (
    <>
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
      {canWrite && (
        <div className="tree-actions">
          <button type="button" className="link-button" onClick={() => void createNote()}>
            New note
          </button>
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
        </div>
      )}
      <nav className="tree" aria-label="Notes">
        <Level entries={roots} depth={0} emptyLabel="No markdown files in this folder." />
      </nav>
    </>
  );
}
