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
import {base} from "../lib/route"

/**
 * What separates one figure from the next.
 *
 * Punctuation between two messages, belonging to neither — which is also why it is a
 * component rather than part of either message: a translator moving it would be moving
 * something that is not theirs.
 */
export const Dot = () => <span className="text-ash-lit mx-2">·</span>;

/**
 * The slashes a transcription is written between: `/kuləst/`.
 *
 * Not language — it is the convention for "this is a pronunciation and not a spelling", and
 * it is the same convention in every language that writes IPA at all. The transcription
 * inside comes from the mode's lexicon rather than from a catalog, so there is nothing here
 * for a translator either way.
 */
export const Said = ({ children }: { children: string }) => (
  <>/{children}/</>
);

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
  <a href={base()}>
    <span className="text-bone text-xl leading-none font-semibold tracking-tight">
      Re<span className="text-blood-lit italic">Curse</span>
    </span>
  </a>
);

/**
 * Which game a board belongs to, as a shape rather than as a word.
 *
 * The masthead switch reads "ReCurse, № 12, short" and had to say which of two games that
 * was, which put a whole second word on a row already three things wide on a phone. A mark
 * takes the width of one character and says the same thing, and it is the same mark over the
 * menu's heading, so the two readings are learnt together.
 *
 * **Files, masked.** Each icon is an `.svg` of its own, used as a CSS mask over `bg-current` —
 * so the shape is filled by whatever colour the surrounding text is in and keeps the gilt/bone
 * grammar the rest of the chrome is drawn in. An inlined `<svg fill="currentColor">` would
 * colour the same way at the cost of putting artwork in the middle of a component; an `<img>`
 * would keep the file and lose the colour. Sized in `em`, so it is the height of the caps it
 * sits beside at any size.
 *
 * **Served from `public/`, like the fonts, and for a sharper reason than tidiness.** Imported
 * from `src/` these are small enough for Vite to inline, and an inlined SVG arrives as a data
 * URI whose quotes and newlines do not survive being written into a `url()` in an inline style:
 * the browser drops the declaration, `mask-image` computes to `none`, and the mark renders as
 * the solid square its `bg-current` was always going to be behind the mask. A path to a real
 * file has nothing to escape. The base is read at call time for the reason `route.ts` gives.
 *
 * Unicode was the first thing tried and is the same trap the masthead menu's hamburger avoids:
 * 🔤 and 🔊 are outside both vendored subsets, so they arrive in whatever emoji face the
 * platform keeps — full colour, its own metrics, beside a Deco masthead. Neither can be *set*
 * as type either, for the same reason: an SVG used as a mask resolves fonts against the
 * platform, so `<text>ABC</text>` would be a different mark on every machine.
 *
 * **The letters mark is three glyphs and not one**, stepping down to the right. It was a single
 * capital A, which is not a symbol for letters — it is the letter A, and the masthead read
 * "A short" and the menu heading "A letters". Three of them cascading say *alphabet*, and the
 * stepped diagonal is what survives at fourteen pixels even once the B's counters have closed
 * up: the shape is doing the work, not the letterforms.
 *
 * **Both are drawn at the same stroke weight**, which is what makes them a pair rather than two
 * icons. The letters mark carries far more detail in the same box and so reads heavier at the
 * same weight; that is the cost of the two being legibly one system.
 *
 * **The open game's mark is three words and two moves**, which is the smallest thing this game
 * draws that is recognisably a board — and the same unit the calendar schedules by. The other
 * two marks say what a *word* is here, by spelling or by sound; the open game does not change
 * what a word is, it changes what you are looking at, so its mark is the graph rather than the
 * alphabet. Circles and lines at the same weight, which is also what the plate is drawn in.
 *
 * **A game with no icon draws nothing**, and the caller falls back to its name. Same rule as
 * `bandName`: adding a mode must not be able to break a screen that has never heard of it. It
 * is not a comfortable fallback, though — on the masthead the name is a second whole word on a
 * row that is three things wide, and it is what made the switch wrap on a map before this one
 * existed.
 */
const GAME_ICONS: Record<string, string> = {
  letters: 'icons/letters.svg',
  phonemes: 'icons/phonemes.svg',
  explore: 'icons/explore.svg',
};

export function GameIcon({ game, className = '' }: { game: string; className?: string }) {
  const file = GAME_ICONS[game];
  if (!file) return null;
  const icon = `${import.meta.env?.BASE_URL ?? '/'}${file}`;
  const mask = {
    maskImage: `url(${icon})`,
    WebkitMaskImage: `url(${icon})`,
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskSize: 'contain',
    maskPosition: 'center',
    WebkitMaskPosition: 'center',
  };
  return (
    <span
      aria-hidden
      className={`inline-block size-[1em] shrink-0 bg-current ${className}`}
      style={mask}
    />
  );
}

/** Whether a game has a mark of its own, for callers that must know before laying one out. */
export function hasGameIcon(game: string): boolean {
  return game in GAME_ICONS;
}

/**
 * The question mark on the masthead's mode marker.
 *
 * Punctuation and not language: every locale this game is likely to reach asks with the same
 * glyph, and the button's own label — which *is* language — says what it opens.
 */
export const Query = () => <>?</>;

/**
 * The plus on the power that puts a word straight onto an open map.
 *
 * The same argument as `Query`, and the same glyph as the sign on a move that adds letters —
 * which is not a coincidence worth avoiding: both mean something arriving on the board, and a
 * player who has learnt one reads the other. Bare rather than `MoveSign`, because this is not a
 * move and has no direction to colour itself by; the button it sits on carries the words.
 */
export const Plus = () => <>+</>;

/**
 * The cross that shuts a page.
 *
 * Same argument as `Query`: the glyph is the same everywhere and the button carries the words.
 * Which means the label is still in the catalog and still says where shutting it *goes* — a
 * cross on its own says "not this" and not "back to the board", and a screen reader should
 * hear the latter.
 *
 * `×`, the multiplication sign, rather than a letter x or `✕`: it is the one of the three that
 * is centred on the maths axis, is in both vendored subsets, and is not a character somebody
 * might be reading as a word.
 */
export const Close = () => <>×</>;

/**
 * `×` before a count: how many of a thing there were.
 *
 * Arithmetic rather than language — a tally of five fields is `×5` in every locale this game
 * is likely to reach — and it appears only in the dev bar's code inspector, where every other
 * glyph on the line is a number too. The same `×` `Close` uses, and for the same reasons: on
 * the maths axis, in both vendored subsets, and not a letter anybody reads as a word.
 */
export const Times = () => <>×</>;
