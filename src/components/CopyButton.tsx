import { useEffect, useRef, useState } from 'react';
import { toCanonicalMarkdown } from '../markdown/canonical';
import { countSymbols } from '../markdown/counts';
import { useVault } from '../state/vaultStore';

/**
 * Clipboard access is a permission in some contexts and simply absent in older
 * ones, so the modern call falls back to the selection trick rather than
 * failing silently in someone's hand.
 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '0';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    } catch {
      return false;
    }
  }
}

type CopyMode = 'source' | 'text';

const VARIANTS: Array<{ mode: CopyMode; label: string }> = [
  { mode: 'source', label: 'Markdown source' },
  { mode: 'text', label: 'Text for pasting' },
];

/**
 * Copies the open note, either exactly as written or re-serialised into
 * canonical Markdown.
 *
 * Both come out as Markdown on purpose. The text is read as often by an LLM
 * agent as by a person, and those two want the same thing: Markdown is the
 * format models are trained on hardest, and `**bold**` costs a person nothing
 * to read. Substituting Unicode look-alikes to fake real bold would break
 * tokenisation, search and screen readers to buy an appearance — so that option
 * is gone rather than merely discouraged.
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

    const result =
      mode === 'source'
        ? { text: value, symbols: countSymbols(value.trimEnd()) }
        : toCanonicalMarkdown(value);

    const copied = await writeClipboard(result.text);

    setMessage(
      copied
        ? `Copied ${result.symbols.toLocaleString()} symbols`
        : 'Could not reach the clipboard',
    );

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
            VARIANTS.map(({ mode, label }) => (
              <button key={mode} type="button" role="menuitem" onClick={() => void copy(mode)}>
                {label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
