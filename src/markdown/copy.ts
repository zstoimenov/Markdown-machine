import { countSymbols } from './counts';
import { toPlainText } from './plaintext';

/**
 * Copying the open note out, in one of the two forms it is wanted in. Kept apart
 * from the button that started it because a phone reaches the same two things
 * through a menu rather than a dropdown, and the wording and the fallback should
 * not fork between them.
 */

export type CopyMode = 'source' | 'text';

export const COPY_VARIANTS: Array<{ mode: CopyMode; label: string; hint: string }> = [
  { mode: 'source', label: 'Markdown source', hint: 'The note exactly as written, markers and all' },
  { mode: 'text', label: 'Text for pasting', hint: 'Plain text, markers stripped, structure kept' },
];

/**
 * Clipboard access is a permission in some contexts and simply absent in older
 * ones, so the modern call falls back to the selection trick rather than
 * failing silently in someone's hand.
 */
export async function writeClipboard(text: string): Promise<boolean> {
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

/** Copies, and returns what to say about it. */
export async function copyNote(mode: CopyMode, value: string): Promise<string> {
  const result =
    mode === 'source'
      ? { text: value, symbols: countSymbols(value.trimEnd()) }
      : toPlainText(value);

  const copied = await writeClipboard(result.text);
  return copied ? `Copied ${result.symbols.toLocaleString()} symbols` : 'Could not reach the clipboard';
}
