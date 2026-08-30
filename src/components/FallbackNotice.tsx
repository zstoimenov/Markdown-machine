import { useState } from 'react';
import { useIsNarrow } from '../hooks/useMediaQuery';

/**
 * Why a note opened this way cannot be saved.
 *
 * It is read once and understood, so it does not deserve three permanent lines
 * at the top of a phone — the short form says the same thing, and it can be put
 * away. On a desktop, where the room is not contested, it stays as it was.
 */
export function FallbackNotice() {
  const narrow = useIsNarrow();
  const [dismissed, setDismissed] = useState(false);

  if (narrow && dismissed) return null;

  return (
    <div className="notice">
      <span>
        {narrow
          ? 'Read-only — save a copy to keep your changes.'
          : 'One file, opened read-only — this browser cannot write back to the original. Your edits live here until you save a copy out.'}
      </span>
      {narrow && (
        <button
          type="button"
          className="notice-dismiss"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      )}
    </div>
  );
}
