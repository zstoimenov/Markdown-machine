import { useVault } from '../state/vaultStore';

function countWords(source: string): number {
  const matches = source.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

export function StatusBar() {
  const activePath = useVault((s) => s.activePath);
  const source = useVault((s) => s.source);
  const error = useVault((s) => s.error);

  if (error) return <footer className="status status-error">{error}</footer>;
  if (!activePath) return <footer className="status" />;

  const words = source ? countWords(source) : 0;
  return (
    <footer className="status">
      <span className="status-path">{activePath}</span>
      {source !== null && (
        <span>
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
        </span>
      )}
      <span className="status-mode">read-only · editing arrives in M2</span>
    </footer>
  );
}
