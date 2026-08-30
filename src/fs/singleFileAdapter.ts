import { baseName, type FileSnapshot, type TreeEntry, type VaultAdapter } from './types';

/**
 * The degradation path for browsers without the File System Access API —
 * Firefox and Safari today.
 *
 * A `File` from an <input> or a drop can be read but never written back: the
 * browser gives no handle to the original. So this adapter is permanently
 * unwritable, and the UI offers a download instead of a save. That is a
 * genuinely worse experience, which is why it is the fallback and not the design.
 */
class SingleFileVault implements VaultAdapter {
  constructor(private readonly file: File) {}

  get name(): string {
    return this.file.name;
  }

  /** Always false. There is nowhere to write to, not merely no permission yet. */
  get writable(): boolean {
    return false;
  }

  async requestWrite(): Promise<boolean> {
    return false;
  }

  async listDir(path: string): Promise<TreeEntry[]> {
    if (path !== '') return [];
    return [{ name: this.file.name, path: this.file.name, kind: 'file' }];
  }

  async readFile(path: string): Promise<FileSnapshot> {
    if (path !== this.file.name) throw new Error(`Not open: "${path}"`);
    return { text: await this.file.text(), modifiedAt: this.file.lastModified };
  }

  async readBinary(): Promise<Blob> {
    // Relative images live beside the file, in a folder this mode cannot see.
    throw new Error('Images need a folder, which this browser cannot open.');
  }

  private unsupported(): never {
    throw new Error('This browser can only open one file at a time, read-only.');
  }

  async writeFile(): Promise<number> {
    this.unsupported();
  }

  async createFile(): Promise<void> {
    this.unsupported();
  }

  async renameFile(): Promise<void> {
    this.unsupported();
  }

  async deleteFile(): Promise<void> {
    this.unsupported();
  }
}

export function openSingleFile(file: File): VaultAdapter {
  return new SingleFileVault(file);
}

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
