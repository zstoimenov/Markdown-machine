import { useSyncExternalStore } from 'react';

/**
 * Below this the two panes stop being two panes: at phone widths a split view
 * gives each side a column too narrow to write or read in.
 */
export const NARROW_QUERY = '(max-width: 720px)';

/**
 * Below this the sidebar stops being a column and becomes a drawer over the
 * content. That is a different question from the one above, and it has a
 * different answer: a tablet has room for two panes but not for two panes
 * *and* a permanent 248px index, and the index is the part you consult
 * occasionally rather than read.
 *
 * 1024px rather than a rule about orientation, which sounds right and is not:
 * every phone and tablet held upright is at most 1024px across — an iPad Pro
 * 12.9" in portrait is exactly that — so this already covers them, while a
 * portrait *monitor* keeps the column it has plenty of room for.
 */
export const DRAWER_QUERY = '(max-width: 1024px)';

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

/** Whether the sidebar is an overlay rather than a column beside the content. */
export function useIsDrawer(): boolean {
  return useMediaQuery(DRAWER_QUERY);
}
