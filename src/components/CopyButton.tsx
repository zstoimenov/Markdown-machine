import { useEffect, useMemo, useRef, useState } from 'react';
import { COPY_VARIANTS, copyNote, copySizes, type CopyMode } from '../markdown/copy';
import { useVault } from '../state/vaultStore';

/**
 * Copies the open note either exactly as written, markers and all, or as plain
 * text with the markup stripped and the structure kept.
 *
 * The plain form is read as often by an LLM agent as by a person, and both read
 * the same thing well: ordinary characters doing the structural work — bullets,
 * numbering, indentation, blank lines, URLs written out. Unicode look-alikes
 * for bold are not used; they buy an appearance at the cost of tokenisation,
 * search and screen readers, and do not exist for Cyrillic at all.
 *
 * This is the desktop affordance. On a phone the same two forms are reached
 * through the note menu, where everything else occasional lives.
 */
export function CopyButton() {
  const draft = useVault((s) => s.draft);
  const source = useVault((s) => s.source);
  const activePath = useVault((s) => s.activePath);

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);

  const value = draft ?? source;
  // Only while the menu is open: stripping the markers to count them is work,
  // and it is work nobody asked for until they are choosing between the two.
  const sizes = useMemo(
    () => (open && value !== null ? copySizes(value) : null),
    [open, value],
  );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // A different note means any confirmation on screen is about the old one.
  useEffect(() => {
    setOpen(false);
    setMessage(null);
  }, [activePath]);

  if (value === null) return null;

  async function copy(mode: CopyMode) {
    if (value === null) return;
    setMessage(await copyNote(mode, value));

    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setMessage(null);
    }, 3000);
  }

  return (
    <div className="copy" ref={wrapRef}>
      <button
        type="button"
        className="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          // While a confirmation is showing, the button means "show me the
          // options again", not "close" — the menu is open but not useful.
          window.clearTimeout(closeTimer.current);
          if (message !== null) {
            setMessage(null);
            setOpen(true);
            return;
          }
          setOpen(!open);
        }}
      >
        Copy
      </button>

      {open && (
        <div className="copy-menu" role="menu">
          {message ? (
            <p className="copy-message">{message}</p>
          ) : (
            COPY_VARIANTS.map(({ mode, label }) => (
              <button key={mode} type="button" role="menuitem" onClick={() => void copy(mode)}>
                <span>{label}</span>
                <small>{sizes ? `${sizes[mode].toLocaleString()} symbols` : ''}</small>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
