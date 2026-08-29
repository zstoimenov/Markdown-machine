/**
 * The shortcut list lives apart from the commands themselves so that showing it
 * costs nothing. Importing it from `commands.ts` pulled @codemirror/state into
 * the initial chunk and undid the code-splitting the editor was moved out for.
 */
export const SHORTCUTS: Array<[string, string]> = [
  ['Bold', 'Mod B'],
  ['Italic', 'Mod I'],
  ['Inline code', 'Mod E'],
  ['Link', 'Mod K'],
  ['Cycle heading', 'Mod ⇧ H'],
  ['Bullet list', 'Mod ⇧ L'],
  ['Save now', 'Mod S'],
];
