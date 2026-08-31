import { useVault, type ViewMode } from '../state/vaultStore.ts';
import { useIsNarrow } from './useMediaQuery.ts';

/**
 * Which view the app is actually showing, as opposed to which one is stored.
 *
 * The two differ on a phone. `split` is a real stored choice and a sensible
 * desktop default, but two columns at phone width are two unreadable columns,
 * so a narrow screen shows the rendered note instead. That is derived rather
 * than written back, so widening the window returns you to the split you chose.
 *
 * It lives here because it was being derived in the workspace and *not* in the
 * toolbar, which is a decision made twice and therefore made differently: the
 * toolbar highlighted the stored mode, the stored mode was `split`, and `split`
 * is not offered on a phone — so on load neither Write nor Read looked selected
 * while the app was plainly showing one of them.
 */
export function effectiveViewMode(stored: ViewMode, narrow: boolean): ViewMode {
  return narrow && stored === 'split' ? 'preview' : stored;
}

export function useViewMode(): ViewMode {
  const stored = useVault((s) => s.viewMode);
  return effectiveViewMode(stored, useIsNarrow());
}

/**
 * The views a swipe moves between, in the order they sit in the toolbar. Only
 * the two a phone offers: `split` is not among them, and swiping into a view
 * that is not on screen would be a gesture with no visible result.
 */
export const SWIPEABLE: ViewMode[] = ['editor', 'preview'];

/**
 * The view a swipe lands on, or null at either end.
 *
 * Ends stop rather than wrap. Wrapping would mean one more swipe in the same
 * direction quietly returns you to where you began, which reads as the gesture
 * having failed rather than as having run out of road.
 */
export function swipeTarget(from: ViewMode, direction: 'left' | 'right'): ViewMode | null {
  // Swiping left moves the content left, so the next view along comes in from
  // the right — the same way a phone's tabs and photo galleries behave.
  const at = SWIPEABLE.indexOf(from);
  if (at === -1) return null;
  const to = at + (direction === 'left' ? 1 : -1);
  return SWIPEABLE[to] ?? null;
}
