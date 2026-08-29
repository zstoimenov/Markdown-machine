import { useEffect, useMemo, useRef, useState } from 'react';
import { countSymbols, toPlainText } from '../markdown/plaintext';
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

type CopyMode = 'markdown' | 'plain' | 'styled';

interface Variant {
  mode: CopyMode;
  label: string;
  note: string;
}

const VARIANTS: Variant[] = [
  { mode: 'markdown', label: 'Markdown source', note: 'The note exactly as written' },
  { mode: 'plain', label: 'Plain text', note: 'Structure only — works in any language' },
  {
    mode: 'styled',
    label: 'With bold and italic',
    note: 'Unicode styling — Latin and Greek only',
  },
];

/**
 * Copies the note in whichever form the destination can take.
 *
 * Three modes rather than one, because they fail differently: markdown is exact
 * but only useful where markdown is understood, plain-text structure survives
 * anywhere, and Unicode emphasis exists for Latin and Greek only. Each is
 * offered with the symbol count it produces, since the destination usually has
 * a limit.
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

  // The counts are cheap and only recomputed while the menu is actually open.
  const counts = useMemo(() => {
    if (value === null || !open) return null;
    return {
      markdown: countSymbols(value.trimEnd()),
      plain: toPlainText(value, { styled: false }).symbols,
      styled: toPlainText(value, { styled: true }).symbols,
    };
  }, [value, open]);

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
      mode === 'markdown'
        ? { text: value, symbols: countSymbols(value.trimEnd()), partiallyStyled: false }
        : toPlainText(value, { styled: mode === 'styled' });

    const copied = await writeClipboard(result.text);

    setMessage(
      copied
        ? `Copied ${result.symbols.toLocaleString()} symbols${
            result.partiallyStyled ? ' — this script has no bold in plain text' : ''
          }`
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
            VARIANTS.map(({ mode, label, note }) => (
              <button
                key={mode}
                type="button"
                role="menuitem"
                onClick={() => void copy(mode)}
              >
                <span className="copy-label">{label}</span>
                <span className="copy-note">{note}</span>
                <span className="copy-count">{counts?.[mode].toLocaleString()} symbols</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
