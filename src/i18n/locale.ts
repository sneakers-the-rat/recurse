/**
 * Which language to speak, decided before anything is drawn.
 *
 * Pure and tested in node, like everything else this game reasons with: what a browser
 * asks for is a list of tags in order of preference, and what the game has is a much
 * shorter list, so the answer is a negotiation rather than a lookup.
 *
 * **A query parameter wins.** `?locale=xx-AC` is how the pseudo-locale is reached and how
 * a test asks for a language it is not configured to prefer. It is not remembered: the
 * URL already carries it, and a stored override would outlive the reason for it and
 * leave somebody's game in a language they cannot read with no visible way back.
 *
 * Matching is by language subtag as well as by whole tag, so a browser asking for
 * `en-AU` gets `en` rather than nothing. Region-specific catalogs would be matched first
 * if there ever were any.
 */

/**
 * The languages the game has words for. `en` is the source and the last resort.
 *
 * `xx-LS` is not a language: it is the pseudo-locale, English with every message padded
 * out by about a third. It is reached deliberately with `?locale=xx-LS` and never by
 * negotiation, because no browser asks for it — which is exactly what it is for. The
 * masthead is three things wide on a phone and the statement shrinks to fit the longer of
 * two words on one line; this is how you find out what a longer language does to both.
 */
export const LOCALES = ['en', 'xx-LS'] as const;

export type Locale = (typeof LOCALES)[number] | string;

/** What the game falls back to, and the language the catalog is written in. */
export const SOURCE_LOCALE = 'en';

/**
 * The best of `offered` for a browser preferring `wanted`, in order.
 *
 * **Preference order wins, and it is settled one tag at a time.** Each wanted tag is tried
 * whole, then with a subtag dropped, and so on — `pt-BR-x` asks after `pt-BR`, then `pt` —
 * before the next preference is looked at at all. That is the lookup RFC 4647 describes,
 * and getting it wrong is not subtle: an earlier version matched every exact tag across
 * the whole list first, so a browser asking for `fr-CA, pt-BR` was handed Portuguese,
 * because `pt-BR` was present exactly and `fr` only by truncation. Somebody's first
 * preference is their first preference.
 *
 * The last question asked of a tag is the other direction — an offered locale whose
 * *language* matches, so a browser asking for plain `pt` is given `pt-BR` rather than
 * English. Truncation alone cannot find that, since there is nothing to truncate.
 */
export function pickLocale(
  wanted: readonly string[],
  offered: readonly string[] = LOCALES,
): string {
  const languageOf = (tag: string) => tag.toLowerCase().split('-')[0];

  for (const tag of wanted) {
    const parts = tag.split('-');
    while (parts.length > 0) {
      const probe = parts.join('-').toLowerCase();
      const found = offered.find((one) => one.toLowerCase() === probe);
      if (found) return found;
      parts.pop();
    }
    const sameLanguage = offered.find((one) => languageOf(one) === languageOf(tag));
    if (sameLanguage) return sameLanguage;
  }
  return SOURCE_LOCALE;
}

/**
 * What this visit should be read in: the URL's `locale`, or the browser's preferences.
 *
 * An unknown `?locale=` is not an error — it falls through to the browser the same way a
 * language the game does not speak does. A URL is something people edit and forward, and
 * a mistyped one should give a playable board rather than a blank page, which is the same
 * rule the puzzle addresses follow.
 */
export function localeFor(
  search: string,
  languages: readonly string[],
  offered: readonly string[] = LOCALES,
): string {
  const asked = new URLSearchParams(search).get('locale');
  return pickLocale(asked ? [asked, ...languages] : languages, offered);
}
