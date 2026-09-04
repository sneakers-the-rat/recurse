/**
 * Saying a message where there is no React.
 *
 * Three things in `src/lib` produce words: the guess judge explains a refusal, the share
 * builder writes what a player pastes, and the stats reader explains a file it will not
 * import. All three are pure, all three are tested in node, and `e2e/fixtures.ts` imports
 * from `src/lib` outside a bundler entirely. None of them may reach for `useIntl`.
 *
 * So they take a `Phrasebook`: the one method they need, described structurally. A
 * component passes the `intl` it already has; a test passes one built by `phrasebook()`.
 * Neither has to know about the other, and `src/lib` gains no dependency at all — the
 * `MessageDescriptor` import is types only and disappears at runtime.
 *
 * The alternative was for those modules to return formatted strings, which meant either a
 * React import in a node module or English hard-coded below the layer that knows about
 * language. This is the seam.
 */

import { createIntl } from '@formatjs/intl';
import type { MessageDescriptor } from 'react-intl';
import en from '../locales/en.json';
import { SOURCE_LOCALE } from './locale';

/** What a value can be substituted into a message. Nothing here interpolates elements. */
export type Values = Record<string, string | number>;

/** Enough of react-intl's `IntlShape` for a module that only ever says plain sentences. */
export interface Phrasebook {
  formatMessage(descriptor: MessageDescriptor, values?: Values): string;
}

/**
 * A message and what to put in it, carried together until something can say it.
 *
 * This is what `judgeGuess` and `parseStats` return in place of a sentence. The pairing
 * matters: `values` without its descriptor is a bag of numbers, and a descriptor without
 * its values is a sentence with holes in it, so neither is worth passing alone.
 */
export interface Phrase {
  message: MessageDescriptor;
  values?: Values;
}

/** Say a phrase, whoever is holding the words. */
export function say(intl: Phrasebook, phrase: Phrase): string {
  return intl.formatMessage(phrase.message, phrase.values);
}

/**
 * A phrasebook with no React behind it, for tests and for anything run outside a browser.
 *
 * `@formatjs/intl` rather than `react-intl`: the same formatter without the components,
 * so importing this from a node test does not drag React in behind it. Defaults to the
 * shipped English catalog, which is what makes `share.test.ts` able to assert on the exact
 * string a player would paste.
 */
export function phrasebook(
  locale: string = SOURCE_LOCALE,
  messages: Record<string, string> = en,
): Phrasebook {
  return createIntl({ locale, defaultLocale: SOURCE_LOCALE, messages });
}
