import { SHORTCUTS } from '../markdown/shortcuts.ts';

const IS_APPLE = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Spell the modifier the way this keyboard actually has it printed. */
function forKeyboard(combo: string): string {
  return combo.replace('Mod', IS_APPLE ? '⌘' : 'Ctrl');
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <p className="empty-message">{message}</p>
      <dl className="shortcuts">
        {SHORTCUTS.map(([label, combo]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {forKeyboard(combo)
                .split(' ')
                // The index is the key because the value is not unique — a
                // chord can repeat a modifier — and the list is regenerated
                // whole rather than reordered, so nothing can go stale.
                .map((key, index) => <kbd key={`${index}-${key}`}>{key}</kbd>)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
