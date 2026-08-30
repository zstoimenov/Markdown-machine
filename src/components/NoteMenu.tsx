import { useEffect, useMemo, useState } from 'react';
import { COPY_VARIANTS, copyNote, copySizes, type CopyMode } from '../markdown/copy';
import { looksLikeMarkdown } from '../markdown/fromPlainText';
import { canShareFile } from '../fs/singleFileAdapter';
import { canRevert, useVault } from '../state/vaultStore';

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

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
          <div className="sheet" role="menu" aria-label="Note actions">
            {message !== null && <p className="sheet-message">{message}</p>}

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
