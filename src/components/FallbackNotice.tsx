import { useEffect, useState } from 'react';
import { storageIsPersisted } from '../fs/persist.ts';
import { useIsNarrow } from '../hooks/useMediaQuery.ts';

/**
 * What "on this device" actually means.
 *
 * The temptation is to say "your notes are safe here" and stop. They are safer
 * than they were — a reload no longer takes them — but Safari clears
 * script-writable storage after seven days without a visit, and a browser under
 * storage pressure may clear it sooner. Both have an answer, and neither answer
 * is the app's to apply on someone's behalf: add it to the home screen, which
 * exempts it from that clock, and save anything that matters out to a real file.
 *
 * So the notice says the true thing, and stops being alarming once the browser
 * has promised to keep the storage.
 */
export function FallbackNotice() {
  const narrow = useIsNarrow();
  const [dismissed, setDismissed] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  useEffect(() => {
    void storageIsPersisted().then(setPersisted);
  }, []);

  if (dismissed || persisted === null) return null;

  return (
    <div className="notice">
      <span>
        {persisted
          ? 'These notes live in this browser rather than in a folder. Save a copy out for anything you want to keep elsewhere.'
          : narrow
            ? 'Kept in this browser. Add the app to your home screen so it is not cleared, and save copies out.'
            : 'These notes live in this browser rather than in a folder, and a browser may clear that — Safari does so after a week without a visit. Adding the app to your home screen exempts it; saving a copy out is the other answer.'}
      </span>
      <button
        type="button"
        className="notice-dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
