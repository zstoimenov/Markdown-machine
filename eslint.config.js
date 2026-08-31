import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * There were `eslint-disable` comments in this codebase and no ESLint to read
 * them — so the rules they suppressed were not enforced anywhere, and the
 * comments documented a linter that did not exist.
 *
 * The set is deliberately small, and narrowed rather than inherited whole. The
 * type checker already runs on every build with `strict` and
 * `noUncheckedIndexedAccess`, so most of a large configuration is either
 * already covered or a matter of taste — and a linter that argues with
 * decisions this codebase made on purpose, and wrote a paragraph explaining,
 * is worse than no linter: it trains everyone to run it with their eyes shut.
 *
 * So what is on is what tsc cannot see and this project actually cares about:
 * the rules of hooks, and promises dropped on the floor.
 */
export default tseslint.config(
  { ignores: ['dist/', 'dist-analyze/', 'node_modules/'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // An unawaited promise here means a write nobody is watching, so the
      // deliberate ones are marked `void` and the rest are mistakes.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Underscore-prefixed arguments are a deliberate "unused on purpose".
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      /* ---- Off, with reasons ---- */

      // The adapters implement one interface across three backends. Whether a
      // given method happens to await is an implementation detail; the contract
      // is that all of them are async.
      '@typescript-eslint/require-await': 'off',

      // The repair and conversion passes mask code spans with NUL, precisely
      // because it cannot occur in a text file and so can never collide with
      // something an author wrote. The control character is the point.
      'no-control-regex': 'off',

      // `case 'text':` grouped with the case below it, with a comment between.
      // tsc's own noFallthroughCasesInSwitch already catches the real thing.
      'no-fallthrough': ['error', { allowEmptyCase: true }],

      // The "latest callback in a ref" pattern, which the components use so
      // that a changing prop does not tear down and rebuild a CodeMirror
      // instance on every keystroke. It is deliberate and commented where used.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },

  // Tests stand in for browser globals by casting through `unknown`, which is
  // what they are for rather than a lapse. And `describe`/`test` from node:test
  // return promises the runner is already waiting on — awaiting them by hand is
  // not how the runner is used.
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      // These assert about alignment and indentation, where a literal run of
      // spaces is the clearest way to write what is being asserted.
      'no-regex-spaces': 'off',
    },
  },

  /**
   * Plain JavaScript that runs outside the app's type program: the service
   * worker, the icon generator, the smoke test. Type-aware rules need a
   * tsconfig to point at and there is none for these, so they are checked
   * syntactically — which is what catches a typo in the worker, and the worker
   * is the file here nobody would otherwise notice was broken.
   */
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      // The worker is service-worker scope; the scripts are Node driving a
      // browser, so the bodies they hand to page.evaluate name browser globals.
      globals: { ...globals.node, ...globals.browser, ...globals.serviceworker },
    },
  },
);
