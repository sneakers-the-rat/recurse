/**
 * What the linter is here for, which is one thing: keeping player-facing words out of the
 * code and in the catalog.
 *
 * There was no ESLint in this repo before i18n, and this config is deliberately not a style
 * guide. `tsc --noEmit` already answers every question a type checker answers, and house
 * style is prose comments, which no rule can check. Adding `recommended` here would mean
 * a few hundred findings about code nobody asked to have reviewed, and the one rule that
 * matters would be lost in them. Every rule below is about messages.
 *
 * **Parsed by Babel, not by typescript-eslint.** typescript-eslint reads the TypeScript
 * compiler's own API and refuses outright to load against TS 7, which is what this repo
 * builds with; its documented workaround is to install a second, older TypeScript beside
 * the real one. Every rule here is a question about syntax — where a string literal sits,
 * what a call is named — and none of them wants a type. Babel is already a dependency by
 * way of `@vitejs/plugin-react`, it parses TSX without knowing or caring which TypeScript
 * the project compiles with, and that is one fewer thing to break on an upgrade.
 *
 * The one structural rule is `no-restricted-syntax`: `defineMessages` may only be called
 * under `src/i18n/messages/`. Without it a string drifts back to the component that
 * renders it, one file at a time, and the promise that all the words are in one place is
 * only true on the day it was made.
 */

import babelParser from '@babel/eslint-parser';
import formatjs from 'eslint-plugin-formatjs';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Attributes that reach a player.
 *
 * `no-literal-string-in-jsx` checks text nodes and nothing else by default, and this game
 * says a great deal through `aria-label` — the board is an `<svg role="img">` whose every
 * word is a labelled circle, so a screen reader hears almost nothing but these.
 */
const SPOKEN_PROPS = [
  ['*', 'aria-label'],
  ['*', 'aria-description'],
  ['*', 'aria-placeholder'],
  ['*', 'aria-roledescription'],
  ['*', 'title'],
  ['*', 'placeholder'],
  ['*', 'alt'],
];

/**
 * Babel, told to read TypeScript and JSX and to take no notice of any babel config.
 *
 * The syntax plugins are named directly rather than reached through
 * `@babel/preset-typescript` and `@babel/preset-react`. A preset installs its parser
 * plugin from a `manipulateOptions` hook that only runs during a transform, and
 * `@babel/eslint-parser` never transforms — it resolves the config and parses — so a
 * config written with presets loads without complaint and then fails on the first `type`
 * import in the file. Naming the two plugins is also the more honest description of what
 * is wanted here, which is a parser and no compiler at all.
 */
const TS_AND_JSX = {
  parser: babelParser,
  parserOptions: {
    requireConfigFile: false,
    sourceType: 'module',
    babelOptions: {
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
    },
  },
};

/** `defineMessages` belongs in exactly one place, and this is how that is kept true. */
const MESSAGES_LIVE_TOGETHER = {
  selector: 'CallExpression[callee.name=/^defineMessages?$/]',
  message:
    'Messages live in src/i18n/messages/. Defining one here puts the words back in the component, which is the thing this arrangement exists to prevent.',
};

export default [
  {
    ignores: [
      'dist/**',
      'dist-e2e/**',
      'public/data/**',
      'playwright-report/**',
      'e2e/.results/**',
      'e2e/shots/**',
      'src/locales/**',
      'tools/graphgen/**',
    ],
  },

  {
    files: ['**/*.{ts,tsx,js}'],
    languageOptions: TS_AND_JSX,
    /*
     * Stale `eslint-disable` comments are not reported, which is the price of registering
     * `react-hooks` without enabling it. Its seven directives in App.tsx and Tutorial.tsx
     * suppress a rule that never fires *here* and does fire in an editor that has the
     * recommended config on, so every one of them reads as unused and none of them is.
     */
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    /*
     * `react-hooks` is registered and every one of its rules is left off.
     *
     * App.tsx and Tutorial.tsx already carry `eslint-disable-next-line
     * react-hooks/exhaustive-deps` in seven places, written for whatever editor the
     * author lints in. ESLint treats a disable comment naming a rule it has never heard
     * of as an error, so without the plugin here this config would fail on comments that
     * predate it — and turning the rules *on* would be reviewing hook dependencies, which
     * is a different job from this one and not one anybody asked for.
     */
    plugins: { formatjs, 'react-hooks': reactHooks },
    rules: {},
  },

  /*
   * The catalog's own rules. A message with no description is a message a translator has
   * to guess at, and this game's words are terse enough that the guess would be wrong:
   * "reset" is a camera, "hide" is a key, and "long" is a band of par rather than a length
   * of time.
   */
  {
    files: ['src/i18n/messages/**/*.ts'],
    rules: {
      'formatjs/enforce-default-message': ['error', 'literal'],
      'formatjs/enforce-description': 'error',
      'formatjs/no-invalid-icu': 'error',
      'formatjs/no-multiple-whitespaces': 'error',
      'formatjs/no-offset': 'error',
    },
  },

  /*
   * Everything that renders. An error, because there is nothing left for it to find: every
   * word a player can read is in the catalog, and the marks that are not words are in
   * `components/marks.tsx` behind one exemption.
   *
   * A new literal here is a string a translator will never see, which is a bug that is
   * invisible until somebody plays the game in another language. Failing the build is the
   * only moment it is cheap to fix.
   */
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ignores: ['src/i18n/**', 'src/**/*.test.ts', 'src/test/**'],
    rules: {
      'formatjs/no-literal-string-in-jsx': ['error', { props: { include: SPOKEN_PROPS } }],
      'no-restricted-syntax': ['error', MESSAGES_LIVE_TOGETHER],
    },
  },

  /*
   * Tests, fixtures and tools say whatever they like. A spec asserting on 'no guesses yet'
   * is asserting on what a player sees, which is the entire point of it.
   */
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'src/test/**/*.ts',
      'e2e/**/*.ts',
      '*.config.ts',
      '*.config.js',
    ],
    rules: {
      'formatjs/no-literal-string-in-jsx': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
