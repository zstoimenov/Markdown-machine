import { useVault } from '../state/vaultStore';

export function Toolbar() {
  const vaultName = useVault((s) => s.vaultName);
  const pick = useVault((s) => s.pick);
  const close = useVault((s) => s.close);

  return (
    <header className="toolbar">
      <h1 className="brand">Markdown Machine</h1>
      <span className="vault-name" title={vaultName ?? undefined}>
        {vaultName}
      </span>
      <div className="toolbar-actions">
        <button type="button" className="button" onClick={() => void pick()}>
          Open folder…
        </button>
        <button type="button" className="button button-quiet" onClick={() => void close()}>
          Close
        </button>
      </div>
    </header>
  );
}
