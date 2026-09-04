/**
 * The words, wrapped around the app.
 *
 * Two decisions live here and both are about how the rest of the code reads.
 *
 * **The catalog is `{id: message}` and nothing else.** `formatjs extract --format simple`
 * writes it, every locale file has the same shape, and react-intl parses the ICU at
 * runtime. There is no compile step and no build artefact to commit: the alternative
 * ships a pre-parsed AST, which is faster to format and a second generated thing to keep
 * in step with the first for a game whose whole vocabulary is a few hundred short lines.
 *
 * **Rich text tags are declared once, here.** The game's grammar is three inks — a word
 * is mono and bone, letters arriving are gilt, letters leaving are blood — and the prose
 * in the rules and the tutorial is full of all three. Declared globally, a message can
 * say `<w>base</w> <add>+ ball</add>` and the markup travels with the sentence into the
 * catalog, where a translator can move it. Declared per call site, every one of those
 * sentences would need a map of tags to components beside it, and the words would be back
 * in the components in all but name.
 *
 * English is bundled: it is the source, it is the fallback for every other language, and
 * a game that cannot draw its own chrome until a fetch returns is a game with a blank
 * first frame. Anything else is fetched, and until it lands react-intl falls back to the
 * `defaultMessage` carried on each descriptor, so nothing is ever missing — only English.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IntlProvider, type MessageFormatElement } from 'react-intl';
import en from '../locales/en.json';
import { SOURCE_LOCALE, localeFor } from './locale';

/**
 * The three inks, as tags a message can use.
 *
 * At module scope on purpose: react-intl compares this object by identity, and one built
 * during render would invalidate every formatted message on every frame the board moves.
 */
const INKS = {
  /** A word of the game, set the way the board sets it. */
  w: (chunks: ReactNode) => <span className="word text-bone">{chunks}</span>,
  /** Letters arriving. */
  add: (chunks: ReactNode) => <span className="word text-gilt">{chunks}</span>,
  /** Letters leaving. */
  cut: (chunks: ReactNode) => <span className="word text-blood-lit">{chunks}</span>,
  /** Said louder, in the chrome's own ink rather than the dimmed body colour. */
  b: (chunks: ReactNode) => <span className="text-bone font-bold">{chunks}</span>,
  /** Emphasis that is not loudness — the game uses it for "any", "every", and the like. */
  em: (chunks: ReactNode) => <em className="text-bone not-italic">{chunks}</em>,
} as const;

/**
 * A catalog, either way round.
 *
 * English ships as plain ICU strings, which react-intl parses on demand. The pseudo-locale
 * ships pre-parsed, because `formatjs compile --pseudo-locale` only emits AST — and
 * react-intl takes either, so there is nothing to reconcile.
 */
type Catalog = Record<string, string> | Record<string, MessageFormatElement[]>;

const CATALOGS: Record<string, Catalog> = { [SOURCE_LOCALE]: en };

/**
 * Every catalog on disk, as a loader each, resolved at build time.
 *
 * `import.meta.glob` rather than a template-literal `import()`. The template form makes
 * every file in the directory a candidate including English's, which is *also* imported
 * statically at the top of this file — and Vite then warns that it cannot decide which
 * chunk to put it in and gives up on splitting it. Naming the set here and reading
 * English from the static import keeps the two apart: English is in the main bundle
 * because the first frame needs it, and each other language is a chunk of its own.
 */
const ELSEWHERE = import.meta.glob<{ default: Catalog }>([
  '../locales/*.json',
  '!../locales/en.json',
]);

/**
 * A locale's words, fetched once.
 *
 * A locale with no catalog and a fetch that fails both resolve to nothing rather than
 * throwing: no catalog means the game speaks English, which is a game that still works.
 */
async function loadCatalog(locale: string): Promise<Catalog | null> {
  const held = CATALOGS[locale];
  if (held) return held;

  const load = ELSEWHERE[`../locales/${locale}.json`];
  if (!load) return null;
  try {
    const fetched = await load();
    CATALOGS[locale] = fetched.default;
    return fetched.default;
  } catch {
    return null;
  }
}

export function Words({ children }: { children: ReactNode }) {
  const wanted = useMemo(
    () =>
      localeFor(
        typeof location === 'undefined' ? '' : location.search,
        typeof navigator === 'undefined' ? [] : [...navigator.languages],
      ),
    [],
  );

  // English is already here; anything else arrives a moment later, and until it does the
  // descriptors' own defaults are what get drawn.
  const [catalog, setCatalog] = useState<Catalog>(() => CATALOGS[wanted] ?? en);

  useEffect(() => {
    let live = true;
    void loadCatalog(wanted).then((found) => {
      if (live && found) setCatalog(found);
    });
    return () => {
      live = false;
    };
  }, [wanted]);

  return (
    <IntlProvider
      locale={wanted}
      defaultLocale={SOURCE_LOCALE}
      messages={catalog}
      defaultRichTextElements={INKS}
      // A message the catalog has not got is drawn from its own default, which is the
      // English it was written in. That is a translation still to be done, not a fault,
      // and it must not fill a player's console with red on every frame the board moves.
      onError={(error) => {
        if (error.code === 'MISSING_TRANSLATION') return;
        console.error(error);
      }}
    >
      {children}
    </IntlProvider>
  );
}
