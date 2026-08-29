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
