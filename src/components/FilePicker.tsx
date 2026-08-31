import { useRef, useState } from 'react';
import { isMarkdownFile } from '../fs/types.ts';
import { useVault } from '../state/vaultStore.ts';

/**
 * Takes files into the device library, by button or by drop. Only used where
 * folders are unavailable, so it stays out of the way of the real path.
 *
 * `compact` is the form used once there are already notes: a link rather than a
 * landing pad, since by then the app is not empty and does not need one.
 */
export function FilePicker({ compact = false }: { compact?: boolean } = {}) {
  const openLooseFile = useVault((s) => s.openLooseFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function accept(files: FileList | null) {
    setOver(false);
    const chosen = [...(files ?? [])];
    if (chosen.length === 0) return;

    const wrong = chosen.find((file) => !isMarkdownFile(file.name));
    if (wrong) {
      setProblem(`"${wrong.name}" is not a markdown file.`);
      return;
    }
    setProblem(null);
    void (async () => {
      // In order, so the last one opened is the last one chosen.
      for (const file of chosen) await openLooseFile(file);
    })();
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept=".md,.markdown,.mdown,.mkd,text/markdown"
      hidden
      onChange={(event) => {
        accept(event.target.files);
        // Reset, so choosing the same file twice in a row still fires change.
        event.target.value = '';
      }}
    />
  );

  if (compact) {
    return (
      <>
        <button type="button" className="link-button" onClick={() => inputRef.current?.click()}>
          Add a file…
        </button>
        {input}
      </>
    );
  }

  return (
    <div
      className={`dropzone${over ? ' is-over' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        accept(event.dataTransfer.files);
      }}
    >
      <p>Drop .md files here</p>
      <button type="button" className="button" onClick={() => inputRef.current?.click()}>
        or choose some…
      </button>
      {input}
      {problem && <p className="is-warn">{problem}</p>}
    </div>
  );
}
