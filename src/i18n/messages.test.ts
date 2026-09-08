/**
 * The catalog is what a translator is handed, so the claims are about the catalog.
 *
 * The message *modules* are the editing surface and are deliberately loose about whitespace:
 * a paragraph of prose written on one line is unreadable and undiffable, so a long message is
 * written as a multiline template literal and `formatjs extract` collapses the indentation on
 * its way into `en.json`. That is the arrangement `formatjs/no-multiple-whitespaces` used to
 * enforce from the other end, and it is off for exactly this reason — see the note in
 * `eslint.config.js`.
 *
 * Which leaves a promise nobody was checking: that the collapsing actually happened. A run of
 * spaces in a shipped message is invisible in rendered HTML, which collapses it again, and
 * perfectly visible in a `title` attribute, in a `<pre>`, and in the translation tool a
 * translator reads it in. So it is asserted here, over the built artefact, rather than trusted
 * of the source.
 *
 * `en.json` is committed, which is what makes this a test and not a build step: it is read off
 * disk the same way the app imports it, and `npm run i18n:check` is what keeps it in step with
 * the modules.
 *
 * **Deliberately not asserted here: which rich-text tags a message may use.** Most come from
 * `INKS` on the provider, but several are declared at the call site instead — `<gilt>` and
 * `<pct>` on the stats screen, the how-to's two links — and that is a legitimate choice for a
 * tag only one sentence has any use for. A list here would forbid it.
 *
 * What *is* asserted is that no message carries a bare IPA symbol: those need `<ipa>` around
 * them or they are drawn in a face that has no glyph for them. See `--font-ipa`.
 */

import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';

const catalog = en as Record<string, string>;

/** Every message, as `[id, text]`, so a failure names the message rather than an index. */
const entries = Object.entries(catalog);

describe('the English catalog', () => {
  it('has messages in it at all', () => {
    // The guard that matters: `formatjs extract` writing an empty catalog is the failure mode
    // the pinned CLI version exists to avoid — see the note on `@formatjs/cli` in CLAUDE.md —
    // and every assertion below passes trivially over nothing.
    expect(entries.length).toBeGreaterThan(100);
  });

  /**
   * No run of whitespace, no newline, and nothing at either end.
   *
   * This is what extraction promises, so a failure means either the extractor's whitespace
   * handling has changed under us or `en.json` was edited by hand — which it never should be.
   */
  it('is normalised, whatever the message modules looked like', () => {
    const untidy = entries.filter(([, text]) => /\s\s|[\n\r\t]/.test(text) || text !== text.trim());
    expect(untidy).toEqual([]);
  });

  /** A message with nothing in it is a message that was deleted from one end only. */
  it('has no empty messages', () => {
    expect(entries.filter(([, text]) => text.length === 0)).toEqual([]);
  });

  /**
   * **Every IPA symbol in a message is inside `<ipa>`.**
   *
   * Neither face the game is set in has these characters, so one drawn without the tag sends
   * the browser to the platform for a glyph — see `--font-ipa` in index.css, and the note in
   * fonts.css for what that costs. It is also invisible when it goes wrong: the symbol still
   * draws, in whatever the platform picked, a size and a colour away from the text around it.
   *
   * The range is IPA Extensions and the one Greek letter the phoneme table uses, `θ`. A
   * message that wants to *talk* about a symbol rather than show one still wants the tag,
   * which is why this has no exceptions.
   */
  it('wraps every IPA symbol in <ipa>', () => {
    const ipa = /[\u0250-\u02AF\u03B8]/u;
    const bare: [string, string][] = [];
    for (const [id, text] of entries) {
      if (!ipa.test(text)) continue;
      // What is left once every `<ipa>…</ipa>` is taken out. Anything phonetic still in it is
      // a symbol nobody tagged.
      const rest = text.replace(/<ipa>.*?<\/ipa>/gu, '');
      if (ipa.test(rest)) bare.push([id, rest]);
    }
    expect(bare).toEqual([]);
  });
});
