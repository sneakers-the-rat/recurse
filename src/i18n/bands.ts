/**
 * Translating what the *builder* calls a game and a band, which are the only player-facing
 * words the client does not write down itself.
 *
 * Every mode declares its own name and its own bands in `recurse.yaml` — "letters" and
 * "phonemes", each offering "short", "medium" and "long" — and both reach the masthead, the
 * archive's cards, the stats screen and the share text. They are words a player reads, so they
 * need translating; but they are not written down anywhere in the client, so there is nothing
 * for `defineMessages` to have caught.
 *
 * **A name with no message falls back to itself.** That is the whole design, and it is what
 * makes adding a game a change to one file: a band renamed or a mode added keeps working and
 * simply reads untranslated, rather than the client throwing or drawing a blank where a band
 * should be. The alternative was emitting stable keys from the Rust side, which is a change to
 * the data format and a bank rebuild to buy something this handles in a few lines.
 *
 * **A band is translated by its label, never by its name.** The name is the flat identifier —
 * `phonemes-long` — and belongs to storage and comparison; the label is the word. Both games
 * offer a band labelled "short", so a label alone does not say which game, and nothing here
 * tries to: saying so is the menu's job, which groups the bands under their mode. See
 * `Lengths` in Header.tsx.
 */

import type { IntlShape } from 'react-intl';
import { bands, modes } from './messages/dev';

/** The band labels we have words for, by the string the builder writes. */
const LABELS: Record<string, (typeof bands)[keyof typeof bands]> = {
  short: bands.short,
  medium: bands.medium,
  long: bands.long,
};

/** And the games. */
const GAMES: Record<string, (typeof modes)[keyof typeof modes]> = {
  letters: modes.letters,
  phonemes: modes.phonemes,
};

/** Enough of the manifest to name a board: the bands, and what the games are called. */
interface Naming {
  modes: readonly { name: string }[];
  bands: readonly { label: string; mode: number }[];
}

/** What to call a band, given whatever the manifest labelled it. */
export function bandName(intl: IntlShape, label: string): string {
  const message = LABELS[label];
  return message ? intl.formatMessage(message) : label;
}

/** What to call a game, given whatever the manifest named it. */
export function gameName(intl: IntlShape, name: string): string {
  const message = GAMES[name];
  return message ? intl.formatMessage(message) : name;
}

/**
 * One board named in full — "phonemes long" — for everywhere a band stands on its own.
 *
 * The masthead's menu is the one place that does not want this, because it has just said
 * which game in a heading over the row. Everywhere else — an archive card, the share text,
 * the list of a day's other boards — has a length and no context, and both games have a
 * band called "short". Empty for a band this manifest does not have, which is the same
 * nothing the callers drew before.
 */
export function boardName(intl: IntlShape, band: number, manifest: Naming): string {
  const one = manifest.bands[band];
  if (!one) return '';
  return intl.formatMessage(modes.board, {
    game: gameName(intl, manifest.modes[one.mode]?.name ?? ''),
    band: bandName(intl, one.label),
  });
}
