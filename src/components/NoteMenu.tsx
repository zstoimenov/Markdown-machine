import { useEffect, useMemo, useRef, useState } from 'react';
import { COPY_VARIANTS, copyNote, copySizes, type CopyMode } from '../markdown/copy.ts';
import { looksLikeMarkdown } from '../markdown/fromPlainText.ts';
import { canShareFile } from '../fs/singleFileAdapter.ts';
import { canRevert, useVault } from '../state/vaultStore.ts';

/**
 * Everything you do to a note occasionally, on a phone, in one sheet.
 *
 * A phone has room for about three things in a toolbar, and while you are
 * writing it has room for one: the words. So the toolbar keeps what is used
 * every minute — the drawer, which note this is, and whether you are writing or
 * reading — and the rest comes up from the bottom when it is asked for.
 *
 * From the bottom, specifically. A menu hanging off a button in the top-right
 * corner is the one place on a modern phone a thumb cannot reach.
 */
export function NoteMenu() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const mode = useVault((s) => s.mode);
  const canWrite = useVault((s) => s.canWrite);
  const activePath = useVault((s) => s.activePath);
  const source = useVault((s) => s.source);
  const draft = useVault((s) => s.draft);
  const converted = useVault((s) => s.converted);
  const revertable = useVault(canRevert);

  const repairActive = useVault((s) => s.repairActive);
  const convertActive = useVault((s) => s.convertActive);
  const revert = useVault((s) => s.revert);
  const renameActive = useVault((s) => s.renameActive);
  const deleteActive = useVault((s) => s.deleteActive);
  const downloadActive = useVault((s) => s.downloadActive);
  const pick = useVault((s) => s.pick);
  const close = useVault((s) => s.close);

  const value = draft ?? source;
  // Costed only while the sheet is open — see CopyButton for why.
  const sizes = useMemo(() => (open && value !== null ? copySizes(value) : null), [open, value]);

  // A different note means a confirmation still on screen is about the old one.
  useEffect(() => {
    setOpen(false);
    setMessage(null);
  }, [activePath]);

  /**
   * Focus goes into the sheet when it opens and back to the ⋯ button when it
   * closes, and Tab is held inside while it is up.
   *
   * Without the first, a keyboard user opening the sheet was still behind the
   * scrim, tabbing towards a menu they could not see the start of. Without the
   * last, Tab walked out of a sheet that is visually covering the page and into
   * the controls underneath it, which is worse than no sheet at all.
   */
  useEffect(() => {
    if (!open) return;
    const returnTo = triggerRef.current;

    const items = () =>
      Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);

    items()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }

      const focusable = items();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const at = focusable.indexOf(document.activeElement as HTMLElement);

      // This is announced as a menu, so it has to behave like one: arrows move
      // between the items, and the ends wrap rather than dead-ending.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const next = at === -1 ? 0 : (at + step + focusable.length) % focusable.length;
        focusable[next]?.focus();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        (event.key === 'Home' ? first : last).focus();
        return;
      }

      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // The sheet is already gone by the time this runs, and removing the
      // focused element drops focus to <body>. That is the case worth
      // rescuing; if a prompt or another note has since taken focus, it is
      // somewhere more useful than the button that opened this.
      if (document.activeElement === document.body) returnTo?.focus();
    };
  }, [open]);

  function run(action: () => void | Promise<void>) {
    setOpen(false);
    void action();
  }

  async function copy(copyMode: CopyMode) {
    if (value === null) return;
    setMessage(await copyNote(copyMode, value));
  }

  const plain = source !== null && !looksLikeMarkdown(source);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="icon-button"
        aria-label="More"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => {
          setMessage(null);
          setOpen(!open);
        }}
      >
        ⋯
      </button>

      {open && (
        <>
          <button
            type="button"
            className="scrim"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div ref={sheetRef} className="sheet" role="menu" aria-label="Note actions">
            {message !== null && (
              <p className="sheet-message" role="status" aria-live="polite">
                {message}
              </p>
            )}

            {value !== null && (
              <section className="sheet-group">
                <h2>This note</h2>
                {COPY_VARIANTS.map(({ mode: copyMode, label, hint }) => (
                  <button
                    key={copyMode}
                    type="button"
                    role="menuitem"
                    onClick={() => void copy(copyMode)}
                  >
                    <span>Copy {label.toLowerCase()}</span>
                    <small>
                      {sizes ? `${sizes[copyMode].toLocaleString()} symbols · ` : ''}
                      {hint}
                    </small>
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  disabled={converted || !plain}
                  onClick={() => run(convertActive)}
                >
                  <span>Plain → markdown</span>
                  <small>Read it as plain text and put the syntax back in</small>
                </button>
                <button type="button" role="menuitem" onClick={() => run(repairActive)}>
                  <span>Fix markdown</span>
                  <small>Undo the damage an LLM export leaves behind</small>
                </button>
                {revertable && (
                  <button type="button" role="menuitem" onClick={() => run(revert)}>
                    <span>Revert</span>
                    <small>Back to how it was when you opened it</small>
                  </button>
                )}
              </section>
            )}

            <section className="sheet-group">
              <h2>{mode === 'device' ? 'This device' : 'Folder'}</h2>
              {mode === 'device' && activePath !== null && (
                <button type="button" role="menuitem" onClick={() => run(downloadActive)}>
                  <span>{canShareFile() ? 'Save a copy…' : 'Download a copy'}</span>
                  <small>
                    {canShareFile()
                      ? 'Through the share sheet — Save to Files puts it back where it came from'
                      : 'The only way to keep changes in this browser'}
                  </small>
                </button>
              )}
              {mode === 'vault' && canWrite && activePath !== null && (
                <>
                  <button type="button" role="menuitem" onClick={() => run(renameActive)}>
                    <span>Rename…</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="is-danger"
                    onClick={() => run(deleteActive)}
                  >
                    <span>Delete…</span>
                  </button>
                </>
              )}
              {mode === 'vault' && (
                <button type="button" role="menuitem" onClick={() => run(pick)}>
                  <span>Open another folder…</span>
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => run(close)}>
                <span>Close</span>
              </button>
            </section>
          </div>
        </>
      )}
    </>
  );
}
