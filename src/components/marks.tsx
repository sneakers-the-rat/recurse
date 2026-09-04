/**
 * The typographic marks, in one place, so their exemption is written once.
 *
 * These are the characters the game punctuates with rather than speaks with: a separator
 * between two figures, an ornament between the two words of a puzzle, a caret on a menu.
 * None of them is language. A translator handed `·` has nothing to do with it, and a
 * catalog that carries it is a catalog with noise in it.
 *
 * They live here because the alternative is an `eslint-disable` beside every one of them,
 * and there are a great many — the chrome is drawn almost entirely in rules and marks.
 * One file, one exemption, and each mark says what it is for.
 *
 * `+` and `−` are the exception that proves the rule. They are not punctuation but the
 * game's grammar — gilt for letters arriving, blood for letters leaving — so `MoveSign`
 * takes the move's own kind and colours itself from it. *Inside* a sentence they arrive a
 * different way, as the `<add>` and `<cut>` rich-text tags declared on the provider, since
 * a mark mid-sentence belongs to the sentence. See `src/i18n/provider.tsx`.
 */

/* eslint-disable formatjs/no-literal-string-in-jsx -- marks and ornament: the whole point of this file */

/**
 * What separates one figure from the next.
 *
 * Punctuation between two messages, belonging to neither — which is also why it is a
 * component rather than part of either message: a translator moving it would be moving
 * something that is not theirs.
 */
export const Dot = () => <span className="text-ash-lit mx-2">·</span>;

/**
 * The ornament between the two words a puzzle is about.
 *
 * `aria-hidden`, because what a screen reader should hear is the two words, and "black
 * diamond" between them is furniture read aloud.
 */
export const Diamond = ({ className = 'text-gilt text-xs' }: { className?: string }) => (
  <span aria-hidden className={className}>
    ◆
  </span>
);

/**
 * Which way a pair reads: `source → target`.
 *
 * Between two fields in the archive's search and in dev mode's lookup, and between the
 * words of a printed route. Takes its ink from wherever it is used.
 */
export const Arrow = ({ className = 'text-ash-lit' }: { className?: string }) => (
  <span className={className}>→</span>
);

/** Between a card's two words, spaced the way the card wants it. */
export const Separator = () => <span className="text-ash-lit"> · </span>;

/** A prompt that has been answered. `aria-hidden`: the prompt itself already says so. */
export const Ticked = () => (
  <span aria-hidden className="mr-1.5">
    ✓
  </span>
);

/** The tutorial's step arrows. The buttons around them carry the accessible names. */
export const StepBack = () => <>‹</>;
export const StepOn = () => <>›</>;

/** Dev mode's, which step the calendar rather than the lesson. */
export const TrackBack = () => <>◀</>;
export const TrackOn = () => <>▶</>;

/** The caret that says a menu drops. Also furniture, also hidden. */
export const Caret = ({ className = 'text-gilt-dim text-[0.5rem]' }: { className?: string }) => (
  <span aria-hidden className={className}>
    ▾
  </span>
);

/**
 * Which way a move goes, drawn beside the word it adds or removes.
 *
 * Not a word in any language: it is the same sign the board draws on an edge and the same
 * one the rules explain. The colour is the statement — gilt arriving, blood leaving — so
 * the sign and its ink are one component and cannot drift apart.
 */
export const MoveSign = ({ kind }: { kind: 'add' | 'remove' }) => (
  <span className={kind === 'add' ? 'text-gilt' : 'text-blood-lit'}>{moveSign(kind)}</span>
);

/**
 * The same sign as a bare character, for the board.
 *
 * The plate draws its marks inside SVG `<text>`, which cannot hold a `<span>` — and does
 * not need one, since the `<text>` already carries the fill. So the sign itself is a
 * function and `MoveSign` is the wrapper that colours it for ordinary HTML.
 */
export function moveSign(kind: 'add' | 'remove'): string {
  return kind === 'add' ? '+' : '−';
}

/**
 * Between a score and what it is out of: `5 / 7`.
 *
 * Arithmetic notation rather than language — the same solidus in every locale this game
 * is likely to reach, and spaced the way the figures want it.
 */
export const Slash = () => <span> / </span>;

/**
 * A space between two things that are not one sentence.
 *
 * Whitespace is typography, not language — but a bare `{' '}` is a string literal sitting
 * in JSX, which is exactly the shape of the mistake the linter is watching for and it
 * cannot tell the two apart. Named, it is obvious to both.
 */
export const Space = () => <>{' '}</>;

/**
 * The wordmark.
 *
 * Not a message: it is the name of the thing, and a translated logo is a different logo.
 * Two spans, so `Curse` can be blood-red and italic.
 */
export const Wordmark = () => (
  <span className="text-bone text-xl leading-none font-semibold tracking-tight">
    Re<span className="text-blood-lit italic">Curse</span>
  </span>
);
