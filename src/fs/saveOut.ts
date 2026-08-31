import { baseName } from './types.ts';

/**
 * Getting a note out of the app, for the browsers that cannot write it back.
 *
 * This is what is left of the single-file fallback. That mode — one file, held
 * in memory, read-only — was replaced by the device library, which survives a
 * reload and holds more than one note; the adapter went with it and only these
 * two ways out remain. They are not really file-system code, which is why they
 * are named for what they do rather than for what used to be around them.
 */

/**
 * Whether this platform's share sheet is how a file reaches storage.
 *
 * On iOS it is the only way: there is no writable handle to the original, and
 * the sheet's *Save to Files* can put the note back in the folder it came from,
 * which a download into Downloads cannot. On a desktop the sheet is a worse
 * download, so this is deliberately limited to touch.
 */
export function canShareFile(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  if (!window.matchMedia('(hover: none)').matches) return false;
  try {
    return navigator.canShare({ files: [markdownFile('probe.md', '')] });
  } catch {
    return false;
  }
}

function markdownFile(name: string, contents: string): File {
  return new File([contents], baseName(name), { type: 'text/markdown' });
}

/**
 * Offer the note to the share sheet. Returns false if the platform will not take
 * it, so the caller can fall back — but true when the sheet was dismissed, since
 * changing one's mind is not a failure to route around.
 *
 * The share object carries `files` and nothing else: iOS rejects a mixed one.
 */
export async function shareText(name: string, contents: string): Promise<boolean> {
  let file = markdownFile(name, contents);
  // Not every platform admits to knowing what markdown is; the extension is what
  // decides where it lands anyway.
  if (!navigator.canShare?.({ files: [file] })) {
    file = new File([contents], baseName(name), { type: 'text/plain' });
    if (!navigator.canShare?.({ files: [file] })) return false;
  }

  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError';
  }
}

/** Hand the edited text back as a download, since saving in place is impossible. */
export function downloadText(name: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = baseName(name);
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can race the download in some browsers; a tick is enough.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
