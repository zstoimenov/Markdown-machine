import { useEffect, useState } from 'react';

/**
 * Keep the app inside the part of the screen the keyboard is not standing on.
 *
 * `100dvh` handles a shrinking address bar and nothing else: a software keyboard
 * does not change it, so the bottom of the app — the suggestion row and the
 * status bar, exactly the two things you want while writing — ends up underneath
 * the keys. Both ways out of that are used here, because neither is everywhere:
 *
 * - **The VirtualKeyboard API** (Chromium, which is what an Android phone is
 *   running here) is asked to stop resizing anything and to publish the keyboard's
 *   height as `env(keyboard-inset-height)` instead. The layout viewport then
 *   holds still and the app gives up the bottom of itself, which is the one
 *   arrangement that does not make the whole page jump on every focus.
 * - **The visual viewport**, everywhere else, reports the height that is actually
 *   visible. It is a resize event per keyboard animation frame rather than a CSS
 *   value, but it is right on iOS, which has no virtual-keyboard API at all.
 *
 * Both end up in one custom property, so the CSS has a single thing to read.
 */
export function useKeyboardInsets(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const keyboard = (
      navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } }
    ).virtualKeyboard;

    if (keyboard) {
      keyboard.overlaysContent = true;
      // `env(keyboard-inset-height)` does the sizing in CSS from here; this
      // listener exists only so the layout can be told the keyboard is up.
      const geometry = keyboard as unknown as EventTarget & { boundingRect?: DOMRect };
      const onGeometry = () => setOpen((geometry.boundingRect?.height ?? 0) > 0);
      geometry.addEventListener?.('geometrychange', onGeometry);
      return () => {
        geometry.removeEventListener?.('geometrychange', onGeometry);
        keyboard.overlaysContent = false;
        root.style.removeProperty('--app-height');
      };
    }

    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      root.style.setProperty('--app-height', `${Math.round(viewport.height)}px`);
      // A keyboard takes a good part of the screen; a toolbar sliding away does
      // not. The gap between the two is where the line goes.
      setOpen(window.innerHeight - viewport.height > 160);
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.removeProperty('--app-height');
    };
  }, []);

  // A class rather than a prop: the pieces that step back while the keyboard is
  // up are spread across the shell, and none of them need to re-render to do it.
  useEffect(() => {
    document.body.classList.toggle('is-keyboard', open);
    return () => document.body.classList.remove('is-keyboard');
  }, [open]);

  return open;
}
