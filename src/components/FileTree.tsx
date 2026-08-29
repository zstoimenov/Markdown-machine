import { useVault } from '../state/vaultStore';
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
  if (!roots) return null;
  return (
    <nav className="tree" aria-label="Notes">
      <Level entries={roots} depth={0} emptyLabel="No markdown files in this folder." />
    </nav>
  );
}
