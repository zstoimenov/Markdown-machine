import { useVault } from '../state/vaultStore';

/**
 * Shown when the open file changed on disk after it was read here. Autosave is
 * already stopped by this point; this is the choice that restarts it, and both
 * options are destructive to one side or the other, so neither is a default.
 */
export function ConflictBar() {
  const conflicted = useVault((s) => s.saveState.kind === 'conflict');
  const save = useVault((s) => s.save);
  const reloadFromDisk = useVault((s) => s.reloadFromDisk);

  if (!conflicted) return null;

  return (
    <div className="conflict" role="alert">
      <span>
        This note changed on disk after you opened it. Saving now would overwrite
        those changes.
      </span>
      <div className="conflict-actions">
        <button type="button" className="button" onClick={() => void reloadFromDisk()}>
          Discard mine, reload the file
        </button>
        <button
          type="button"
          className="button button-primary"
          onClick={() => void save({ overwrite: true })}
        >
          Keep mine, overwrite the file
        </button>
      </div>
    </div>
  );
}
