import { SHORTCUTS } from '../markdown/shortcuts';

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
                .map((key, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <kbd key={index}>{key}</kbd>
                ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
