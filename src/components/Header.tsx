/**
 * Masthead and the puzzle statement.
 *
 * The day number is the only number here that is decoration-adjacent, and it
 * earns its place: it is the real puzzle index, the thing a share string will
 * quote, and how players talk about a daily game.
 *
 * Memoised, like every other component App renders beside the plate. The board's
 * layout re-renders App on every frame it is moving, and the header has nothing to
 * do with any of them: it was being rebuilt eighty-odd times per guess to arrive at
 * the same two words and the same two numbers.
 */

import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { bandName, boardName, gameName } from '../i18n/bands';
import { header } from '../i18n/messages/header';
import { rules as rulesSays } from '../i18n/messages/rules';
import { Caret, Diamond, Dot, GameIcon, Query, Wordmark, hasGameIcon } from './marks';

interface Band {
  /** The flat identifier — `phonemes-long`. Not drawn; see `label`. */
  name: string;
  /** The word a player reads: `short`, `medium`, `long`. Both games have all three. */
  label: string;
  /** Which game it belongs to: an index into `games`. */
  mode: number;
  minPar: number;
  maxPar: number;
}

/**
 * Shut on Escape, or on a pointer going down anywhere else.
 *
 * `pointerdown` rather than `click`, because a menu left standing behind whatever the
 * player went on to do is worse than one that closes too eagerly — it should be gone
 * before the thing underneath it happens, not after.
 *
 * Both masthead menus use this, and the ref goes on whatever counts as "inside".
 */
function useDismiss(open: boolean, shut: () => void) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) shut();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shut();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, shut]);

  return box;
}

/** The chrome both masthead menus are drawn in: a hairline box, gilt when it is open. */
const CONTROL =
  'label border-rule hover:border-gilt-dim hover:text-gilt flex items-center border px-1.5 py-1 leading-none transition-colors sm:px-2';

/** And the panel each one drops, on the page's own surface rather than the platform's. */
const PANEL =
  'border-rule bg-noir-2 absolute top-full z-20 mt-1 border shadow-lg shadow-black/50';

/** One choice in such a panel. */
const CHOICE = 'label hover:bg-noir-3 w-full px-3 py-2 text-left whitespace-nowrap transition-colors';

/**
 * Every board a day offers, on the masthead line next to the day number, so what a
 * player reads across the top is one sentence: ReCurse, № 12, phonemes medium.
 *
 * They were three tabs in a row of their own under the title, which spent a whole band of
 * vertical space saying three words — on a phone, where the board is the thing actually
 * short of room. Hence one line: the name, and beside it what the length holds, which is
 * smaller and dimmer because a name alone is a promise the player cannot check but the
 * name is what they are choosing between.
 *
 * Drawn rather than a native `<select>`, whose menu is the operating system's and arrives
 * in the operating system's type, colour and corner radius — a grey rounded box in the
 * middle of a black Deco masthead. Only the closed state of a select can be styled, and the
 * closed state is the half that was already fine. It is also the only shape a *grouped* menu
 * could take and still be drawn in the page's own hand — `optgroup` is as unstyleable as the
 * rest of a select's menu.
 *
 * **Both games label their bands the same three words, so the menu groups rather than
 * qualifies.** Six rows reading "letters short, letters medium, …" spend two thirds of their
 * width on a word repeated three times, and the eye has to read to the second word every
 * time; a heading says it once.
 *
 * **The closed state has no heading over it, so it says the game as a mark.** Spelled out it
 * was a second word on a row that is three things wide on a phone; the menu's heading carries
 * the mark and the name together, which is where the mark is learnt. See `GameIcon`.
 *
 * Ruled on all four sides, which nothing else in the chrome is. Quiet caps beside a day
 * number read as a caption, and nobody clicks a caption; the box and the caret together
 * are the whole of what says otherwise.
 */
function Lengths({
  bands,
  games,
  band,
  onBand,
}: {
  bands: readonly Band[];
  /** The games, in the manifest's order. A band's `mode` indexes this. */
  games: readonly { name: string }[];
  band: number;
  onBand: (band: number) => void;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, useCallback(() => setOpen(false), []));
  const here = bands[band];

  if (!here) return null;

  /** The two lists back together, which is all `boardName` wants of a manifest. */
  const naming = { modes: games, bands };

  /** What a length holds, in the smaller hand the tabs used for it. */
  const holds = (it: Band) => (
    <span className="text-[0.5625rem] tracking-[0.18em] normal-case opacity-70">
      <FormattedMessage {...header.lengthHolds} values={{ min: it.minPar, max: it.maxPar }} />
    </span>
  );

  return (
    <div ref={box} data-tour="length" className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={intl.formatMessage(header.chooseLength)}
        className={`${CONTROL} gap-1 sm:gap-1.5 ${
          open ? 'border-gilt-dim text-gilt' : 'text-bone-dim'
        }`}
      >
        {/*
          The game as its mark, the length as a word.

          Which game this is has to be said — there is nothing else on the line that says it —
          and spelled out it was a second whole word on a row that is three things wide on a
          phone. The mark is one character and the menu it opens repeats it over the heading,
          so the two are learnt together. A game with no mark of its own falls back to its
          name, which is wider and correct.
        */}
        <span className="flex items-baseline gap-1 sm:gap-1.5">
          {hasGameIcon(games[here.mode]?.name ?? '') ? (
            <GameIcon game={games[here.mode]?.name ?? ''} className="self-center opacity-80" />
          ) : (
            <span className="opacity-70">{gameName(intl, games[here.mode]?.name ?? '')}</span>
          )}
          {bandName(intl, here.label)}
        </span>
        {/* Not on a phone, where the masthead is already three things wide. */}
        <span className="hidden sm:inline">{holds(here)}</span>
        <Caret />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={intl.formatMessage(header.lengthMenu)}
          className={`${PANEL} left-0`}
        >
          {bands.map((it, index) => (
            // The band's index, which is its address here — two games both call a band
            // "short", and a label reused as a key is two options React thinks are one.
            <Fragment key={index}>
              {/* A heading wherever the game changes, which is what turns a flat list of six
                  into two lists of three. `role="presentation"` because it is not an option
                  and must not be counted as one by anything reading the menu aloud; the
                  options themselves are grouped for that purpose by their own labels. */}
              {(bands[index - 1]?.mode ?? -1) !== it.mode && (
                <p
                  role="presentation"
                  className="label text-ash border-rule mt-1 flex items-center gap-1.5 border-t px-3 pt-2 pb-1 first:mt-0 first:border-t-0"
                >
                  {/* The mark and the name together, which is the only place they appear
                      together and so the only place the mark can be learnt. */}
                  <GameIcon game={games[it.mode]?.name ?? ''} />
                  {gameName(intl, games[it.mode]?.name ?? '')}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={index === band}
                // Read out with its game, because a heading is presentation and a player
                // hearing "short" alone has been told half of it.
                aria-label={boardName(intl, index, naming)}
                onClick={() => {
                  setOpen(false);
                  if (index !== band) onBand(index);
                }}
                className={`${CHOICE} flex items-baseline gap-2 pl-5 ${
                  index === band ? 'text-gilt' : 'text-ash-lit hover:text-bone-dim'
                }`}
              >
                {bandName(intl, it.label)}
                {holds(it)}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The ways off this board — the archive, the record, and the rules — behind one button on a
 * phone.
 *
 * Written out, they are most of the masthead's width, which left no room for the day and the
 * length beside them and wrapped the row onto a second line. They are also the things a
 * player wants least often: the board is what they came for.
 *
 * Three hairlines rather than a `☰`, which is not in either of the two subsets the faces
 * ship and would arrive in whatever the system fell back to. Rules are what this chrome is
 * drawn in anyway.
 */
function Menu({
  onHelp,
  onPuzzles,
  onStats,
  onTutorial,
}: {
  onHelp: () => void;
  onPuzzles: () => void;
  onStats: () => void;
  onTutorial: () => void;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const box = useDismiss(open, useCallback(() => setOpen(false), []));

  const item = (name: string, go: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        go();
      }}
      className={`${CHOICE} text-ash-lit hover:text-bone-dim block`}
    >
      {name}
    </button>
  );

  return (
    <div ref={box} data-tour="menu" className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={intl.formatMessage(header.menu)}
        className={`${CONTROL} justify-center ${
          open ? 'border-gilt-dim text-gilt' : 'text-bone-dim'
        }`}
      >
        {/* As tall as the caps beside it, so the two masthead controls are the same box. */}
        <span aria-hidden className="flex h-[0.6875rem] w-3.5 flex-col justify-between">
          <span className="h-px w-full bg-current" />
          <span className="h-px w-full bg-current" />
          <span className="h-px w-full bg-current" />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={intl.formatMessage(header.menu)}
          className={`${PANEL} right-0`}
        >
          {item(intl.formatMessage(header.puzzles), onPuzzles)}
          {item(intl.formatMessage(header.stats), onStats)}
          {item(intl.formatMessage(header.tutorial), onTutorial)}
          {item(intl.formatMessage(header.howToPlay), onHelp)}
        </div>
      )}
    </div>
  );
}

interface Props {
  source: string;
  target: string;
  par: number;
  /**
   * How many ways through there are that are *shorter* than par, which exist because a rarer
   * word cuts a corner. Said out loud from the start: that a shortcut exists is the hook, and
   * which words it runs through is the puzzle. Zero on most boards, and then not shown.
   */
  shortcuts?: number;
  /**
   * Every board a day offers — both games' three lengths — and which one is on screen.
   *
   * From the manifest, so what each holds is that mode's own `bandCuts` rather than anything
   * decided here. The switch is the only way between them on a phone: the band is
   * deliberately not in the URL — a board is addressed by its id and nothing else.
   */
  bands: readonly Band[];
  /** The games those bands belong to, in the manifest's order. */
  games: readonly { name: string }[];
  /**
   * The game this board is of, named as the manifest names it — or null when that game has
   * nothing of its own to say, which is the letters game and every game like it.
   *
   * Null rather than a second boolean prop, because "which game" and "is it worth a marker"
   * are one question: the marker names the game, and there is nothing to name it for. App
   * asks `hasModeRules`, which is the same list the page itself reads.
   */
  game: string | null;
  /** To that game's rules page. See `ModeRules`. */
  onModeRules: () => void;
  band: number;
  onBand: (band: number) => void;
  day: number;
  guesses: number;
  /** Hints asked for. Shown beside the guesses: it is the other half of a score. */
  hints: number;
  /**
   * The opening card is showing the statement, so this one waits its turn — the card
   * ends up here, and two copies of the same two words fading past each other reads as
   * a glitch rather than a hand-off.
   */
  quiet?: boolean;
  /**
   * The round is over. Said in the chrome as well as in the result panel, so a board
   * you come back to is visibly a board you have already played before you have read a
   * word of it.
   */
  finished?: boolean;
  /** And they beat par, which is the one outcome louder than finishing. */
  beatPar?: boolean;
  onHelp: () => void;
  /** To the archive of everything already played. See `Puzzles`. */
  onPuzzles: () => void;
  /** To the record of every round finished. See `Stats`. */
  onStats: () => void;
  /** To the walkthrough, which is a real board with a lesson over it. See `Tutorial`. */
  onTutorial: () => void;
}

export const Header = memo(function Header({
  source,
  target,
  par,
  shortcuts = 0,
  bands,
  games,
  game,
  onModeRules,
  band,
  onBand,
  day,
  guesses,
  hints,
  quiet = false,
  finished = false,
  beatPar = false,
  onHelp,
  onPuzzles,
  onStats,
  onTutorial,
}: Props) {
  const intl = useIntl();

  /**
   * The bar's own colour, which is a statement about the round rather than decoration.
   *
   * Gilt, because gilt is what this game means by *arrived* — letters arriving, a word on
   * the route, a secret found. Dim gilt for a round finished, full gilt for one that beat
   * par, and the ordinary rule while there is still playing to do. Nothing else changes:
   * the two words and the tally are the same two words and the same tally.
   */
  const rule = finished ? (beatPar ? 'border-gilt' : 'border-gilt-dim') : 'border-rule';

  return (
    <header data-tour="masthead" className={`border-b ${rule} ${finished ? 'bg-noir-2' : ''}`}>
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2.5 sm:gap-x-4">
        {/*
          Title, day, length: one line, read left to right, because that is the order of the
          questions — which game, which day, which length. The length is grouped with the day
          rather than with the two menus, since it is a fact about the board on screen and
          they are ways off it.
        */}
        <span className="flex items-center gap-2 sm:gap-3">
          <h1 className="flex items-baseline gap-2">
            <Wordmark />
            <span className="label text-ash-lit">
              <FormattedMessage {...header.day} values={{ day }} />
            </span>
          </h1>
          <Lengths bands={bands} games={games} band={band} onBand={onBand} />
        </span>

        {/* Written out where there is room for them, and behind the button where there is not. */}
        <span className="hidden items-center gap-4 sm:flex">
          <button
            onClick={onPuzzles}
            className="label hover:text-gilt transition-colors"
            type="button"
          >
            <FormattedMessage {...header.puzzles} />
          </button>
          <button onClick={onStats} className="label hover:text-gilt transition-colors" type="button">
            <FormattedMessage {...header.stats} />
          </button>
          <button
            onClick={onTutorial}
            className="label hover:text-gilt transition-colors"
            type="button"
          >
            <FormattedMessage {...header.tutorial} />
          </button>
          <button onClick={onHelp} className="label hover:text-gilt transition-colors" type="button">
            <FormattedMessage {...header.howToPlay} />
          </button>
        </span>
        <Menu onHelp={onHelp} onPuzzles={onPuzzles} onStats={onStats} onTutorial={onTutorial} />
      </div>

      {/* The statement, set like a Deco title page: rule, line, rule. */}
      {/*
        Out at once, back in slowly. The card is the same two words in the same place, so
        a *fade* out means both are on screen together for a moment, which reads as a
        glitch; coming back is the hand-off and wants the time.
      */}
      <div
        className={`border-t ${rule} transition-opacity ${
          quiet ? 'opacity-0 duration-0' : 'opacity-100 duration-700'
        }`}
      >
        <div className="mx-auto max-w-2xl px-4 py-4 text-center">
          {/*
            The size on this line is the ceiling, not the size: `.statement` in index.css
            shrinks the two words from here until the longer of them fits the measure on
            one line, which the longest words in the bank do not do at 3xl on a phone.
            Hence `--chars`, which is all that rule needs to know about them.
          */}
          <p
            data-tour="statement"
            className="statement flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xl sm:text-3xl"
            style={{ '--chars': Math.max(source.length, target.length) } as CSSProperties}
          >
            <span className="word text-bone">{source}</span>
            <Diamond />
            <span className="word text-bone">{target}</span>
          </p>
          {/*
            Which game this is, spelled out, and the way to what makes it different.

            Only for a game that *has* rules of its own — see `hasModeRules`. The letters game
            has none, on purpose: a word being its spelling is what everyone assumes, and a
            marker pointing at a page that says so is a marker pointing at nothing. So this is
            not a fixture of the header; it is the header saying that there is something here
            worth knowing, and it is absent whenever there is not.

            **The whole marker is the link, `?` and all.** The words name the thing there is
            something to read about, so they are the thing to click: a `?` that was the only
            live part of the phrase left the phrase itself looking like a caption with a button
            stuck to it, and made the target one small circle. The ring is still drawn, because
            a wavy underline says "there is a note on this" and the `?` says what kind of note,
            but it is a mark inside the link rather than a control beside it.

            **It brightens on hover, text and squiggle together**, which is the only thing that
            says "link" here — there is no other underlined text on this screen and nothing else
            to compare it to. Both from the button, so they cannot get out of step.

            The squiggle has to be `decoration-*` utilities rather than a border: an underline
            follows the text across a line break and a border draws a box round it. It is on the
            words alone, and the ring is outside that span — a wavy line under a circle reads as
            a mistake.

            Between the two words and the tally because that is the reading order — what the
            puzzle is, what game it is played by, how it is scored.
          */}
          {game !== null && (
            <p className="label mt-2 flex items-center justify-center">
              <button
                type="button"
                onClick={onModeRules}
                // The tooltip says what it opens; the accessible name is the visible phrase,
                // which is what a player would say out loud to ask for it.
                title={intl.formatMessage(rulesSays.open, { game: gameName(intl, game) })}
                // `uppercase` restated: the caps come from `.label` on the paragraph, and
                // Tailwind's preflight resets `text-transform` on a button — so the phrase
                // came out in sentence case in the middle of a line of small caps.
                //
                // The same ink as the tally at rest, brighter on hover. Dimmer than the
                // caption around it would be a link that recedes, which is backwards.
                className="group text-bone-dim hover:text-bone flex items-center gap-1.5 uppercase transition-colors"
              >
                <span className="decoration-gilt-dim group-hover:decoration-gilt underline decoration-wavy underline-offset-4 transition-colors">
                  <FormattedMessage
                    {...rulesSays.marker}
                    values={{ game: gameName(intl, game) }}
                  />
                </span>
                {/*
                  `tracking-normal` because the caps around it are letter-spaced, and letter
                  spacing is added *after* each glyph — so a `?` centred in a flex box sat half
                  a letter-space left of the middle of its own ring.
                */}
                <span
                  aria-hidden
                  className="border-rule group-hover:border-gilt-dim group-hover:text-gilt flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.625rem] leading-none tracking-normal transition-colors"
                >
                  <Query />
                </span>
              </button>
            </p>
          )}
          <p data-tour="tally" className="label mt-2.5">
            <FormattedMessage {...header.par} values={{ count: par }} />
            {shortcuts > 0 && (
              <>
                <Dot />
                <span className="text-gilt-dim">
                  <FormattedMessage {...header.shortcuts} values={{ count: shortcuts }} />
                </span>
              </>
            )}
            <Dot />
            <FormattedMessage {...header.guesses} values={{ count: guesses }} />
            {/* Only once any have been asked for: a nought here would read as a
                score to protect, and hints are not something to be stingy with. */}
            {hints > 0 && (
              <>
                <Dot />
                <FormattedMessage {...header.hints} values={{ count: hints }} />
              </>
            )}
          </p>
        </div>
      </div>
    </header>
  );
});
