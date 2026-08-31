import { useEffect, useRef } from 'react';

/**
 * A horizontal swipe over an element, for moving between views on a phone.
 *
 * Deliberately decided on `touchend` rather than followed live. A pane that
 * tracked the finger would have to animate two lazily-loaded panes at once and
 * decide what to show when a half-finished drag is abandoned; the gesture here
 * is a shortcut for pressing a button that is already on screen, and the button
 * changing is the feedback.
 *
 * Nothing is ever prevented on the way through. The listeners are passive, so a
 * swipe that turns out to be a scroll scrolls, and a gesture the browser owns —
 * a pinch, a text selection, the drawer opening — is left alone.
 */

/** Far enough to be meant, in CSS pixels. */
const DISTANCE = 60;
/** And enough more sideways than down to not be a scroll that wandered. */
const DOMINANCE = 1.6;
/**
 * Longer than this and it is a drag, not a swipe — most likely a text selection
 * being adjusted, which must not also change the view out from under it.
 */
const DURATION_MS = 600;

/**
 * Whether the gesture belongs to something inside the pane instead.
 *
 * Code blocks, tables and the suggestion row all scroll sideways, and a swipe
 * that started on one of them is aimed at it. Only when it has no room left to
 * move in that direction does the swipe belong to the view.
 */
function claimedByScroller(from: EventTarget | null, until: Element, dx: number): boolean {
  let node = from instanceof Element ? from : null;
  while (node && node !== until) {
    const scrollable = node.scrollWidth - node.clientWidth;
    if (scrollable > 1) {
      const style = getComputedStyle(node);
      if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
        // Swiping left reads as moving further right through the content.
        const room = dx < 0 ? scrollable - node.scrollLeft : node.scrollLeft;
        if (room > 1) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function useHorizontalSwipe(
  element: HTMLElement | null,
  onSwipe: (direction: 'left' | 'right') => void,
  enabled: boolean,
) {
  // Held in a ref so that a changing handler does not re-bind the listeners
  // mid-gesture, which would lose the touch already in progress.
  const onSwipeRef = useRef(onSwipe);
  onSwipeRef.current = onSwipe;

  useEffect(() => {
    if (!element || !enabled) return;

    let start: { x: number; y: number; at: number } | null = null;

    function onTouchStart(event: TouchEvent) {
      // A second finger means a pinch or a zoom, which is not this.
      if (event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      start = { x: touch.clientX, y: touch.clientY, at: Date.now() };
    }

    function onTouchMove(event: TouchEvent) {
      if (event.touches.length > 1) start = null;
    }

    function onTouchEnd(event: TouchEvent) {
      const from = start;
      start = null;
      if (!from || !element) return;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (Date.now() - from.at > DURATION_MS) return;
      if (Math.abs(dx) < DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
      if (claimedByScroller(event.target, element, dx)) return;

      onSwipeRef.current(dx < 0 ? 'left' : 'right');
    }

    function onTouchCancel() {
      start = null;
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: true });
    element.addEventListener('touchend', onTouchEnd, { passive: true });
    element.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [element, enabled]);
}
