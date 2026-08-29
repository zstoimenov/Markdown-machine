import { useVault } from '../state/vaultStore';

/**
 * Offered when a file opens with damage a repair would address. It rewrites the
 * buffer, not the file, so the result can be read before it is kept and undone
 * with Ctrl+Z if it is not.
 */
export function RepairBar() {
  const repairs = useVault((s) => s.repairs);
  const dismissed = useVault((s) => s.repairDismissed);
  const repairActive = useVault((s) => s.repairActive);
  const dismissRepair = useVault((s) => s.dismissRepair);

  if (dismissed || repairs.length === 0) return null;

  return (
    <div className="notice notice-repair" role="status">
      <div className="notice-body">
        <strong>This file looks damaged.</strong>{' '}
        <span>Fixing it would have {new Intl.ListFormat('en').format(repairs.map((r) => r.label))}.</span>
      </div>
      <div className="notice-actions">
        <button type="button" className="button" onClick={dismissRepair}>
          Leave it
        </button>
        <button type="button" className="button button-primary" onClick={repairActive}>
          Fix markdown
        </button>
      </div>
    </div>
  );
}
