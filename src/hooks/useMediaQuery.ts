import { useSyncExternalStore } from 'react';

/**
 * Below this the two panes stop being two panes: at phone widths a split view
 * gives each side a column too narrow to write or read in.
 */
export const NARROW_QUERY = '(max-width: 720px)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // No DOM during a server render; a desktop layout is the safer guess.
    () => false,
  );
}

export function useIsNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}
