import { useRef, useState } from 'react';
import { isMarkdownFile } from '../fs/types';
import { useVault } from '../state/vaultStore';

/**
 * Opens a single loose file, by button or by drop. Only used where folders are
 * unavailable, so it stays out of the way of the real path.
 */
export function FilePicker() {
  const openLooseFile = useVault((s) => s.openLooseFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function accept(file: File | undefined) {
    setOver(false);
    if (!file) return;
    if (!isMarkdownFile(file.name)) {
      setProblem(`"${file.name}" is not a markdown file.`);
      return;
    }
    setProblem(null);
    void openLooseFile(file);
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
        accept(event.dataTransfer.files[0]);
      }}
    >
      <p>Drop a .md file here</p>
      <button type="button" className="button" onClick={() => inputRef.current?.click()}>
        or choose one…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown,.mdown,.mkd,text/markdown"
        hidden
        onChange={(event) => {
          accept(event.target.files?.[0]);
          // Reset, so choosing the same file twice in a row still fires change.
          event.target.value = '';
        }}
      />
      {problem && <p className="is-warn">{problem}</p>}
    </div>
  );
}
