/**
 * Translating the three lengths, which are the only player-facing words the *builder*
 * writes rather than the client.
 *
 * `RECURSE_BAND_CUTS` produces a manifest naming the bands "short", "medium" and "long",
 * and those names reach the masthead, the archive's cards, the stats screen and the share
 * text. They are words a player reads, so they need translating — but they are not written
 * down anywhere in the client, so there is nothing for `defineMessages` to have caught.
 *
 * **A name with no message falls back to itself.** That is the whole design: a band renamed
 * or a fourth one added in the builder keeps working and simply reads untranslated, rather
 * than the client throwing or drawing a blank where a length should be. The alternative was
 * emitting stable keys from the Rust side, which is a change to the data format and a bank
 * rebuild to buy something this handles in four lines.
 */

import type { IntlShape } from 'react-intl';
import { bands } from './messages/dev';

/** The manifest names we have words for, by the string the builder writes. */
const KNOWN: Record<string, (typeof bands)[keyof typeof bands]> = {
  short: bands.short,
  medium: bands.medium,
  long: bands.long,
};

/** What to call a band, given whatever the manifest called it. */
export function bandName(intl: IntlShape, name: string): string {
  const message = KNOWN[name];
  return message ? intl.formatMessage(message) : name;
}
