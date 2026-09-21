/**
 * Which board is being played, and every other one that could be.
 *
 * A drawn menu on the masthead line, beside the day number, so the top of the screen reads as
 * one sentence: ReCurse, № 12, medium.
 *
 * They were three tabs in a row of their own under the title, which spent a whole band of
 * vertical space saying three words — on a phone, where the board is the thing actually short
 * of room. Hence one line: the name, and beside it what the length holds, which is smaller and
 * dimmer because a name alone is a promise the player cannot check but the name is what they
 * are choosing between.
 *
 * Drawn rather than a native `<select>`, whose menu is the operating system's and arrives in
 * the operating system's type, colour and corner radius — a grey rounded box in the middle of a
 * black Deco masthead. Only the closed state of a select can be styled, and the closed state is
 * the half that was already fine. It is also the only shape a *grouped* menu could take and
 * still be drawn in the page's own hand — `optgroup` is as unstyleable as the rest of a
 * select's menu.
 *
 * **Every game's boards are grouped, so a row says one word.** All three games label their
 * boards with words the others use too — both daily games have a "short", and the open game's
 * two boards are called after the very games above them — so a flat list would spend two
 * thirds of its width on a qualifier the eye has to read every time. A heading says it once.
 *
 * **The closed state has no heading over it, so it says the game as a mark.** Spelled out it
 * was a second word on a row that is three things wide on a phone; the menu's heading carries
 * the mark and the name together, which is where the mark is learnt. A game with no mark of its
 * own — the open one has none, being a way of playing rather than an alphabet — falls back to
 * its name, which is wider and correct.
 *
 * Ruled on all four sides, which nothing else in the chrome is. Quiet caps beside a day number
 * read as a caption, and nobody clicks a caption; the box and the caret together are the whole
 * of what says otherwise.
 */

import { Fragment, useCallback, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { bandName, EXPLORE, gameName, playName } from '../i18n/bands';
import { header } from '../i18n/messages/header';
import { Caret, GameIcon, hasGameIcon } from './marks';
import { CHOICE, CONTROL, PANEL, useDismiss } from './Masthead';

/** One of the day's boards, as the manifest lists it. */
export interface Band {
  /** The flat identifier — `phonemes-long`. Not drawn; see `label`. */
  name: string;
  /** The word a player reads: `short`, `medium`, `long`. Both daily games have all three. */
  label: string;
  /** Which game it belongs to: an index into `games`. */
  mode: number;
  minPar: number;
  maxPar: number;
}

/**
 * What the switch is pointing at, and what it can be moved to.
 *
 * Two kinds, because there are two kinds of board. A daily one is a *position in the manifest's
 * flat band list*, which is how every other thing that addresses one names it — the calendar,
 * the stored preference, a puzzle's own `band`. An open one has no such list to be in: it is
 * not scheduled, has no par and no day, so what names it is the game whose graph it is a map
 * of. Written down, those are `letters-short` and `explore-letters`, and `Boards` is the one
 * place both are offered.
 */
export type Playing = { daily: number } | { explore: string };

/** Is the switch on this one? */
function same(one: Playing, two: Playing): boolean {
  return 'daily' in one && 'daily' in two
    ? one.daily === two.daily
    : 'explore' in one && 'explore' in two && one.explore === two.explore;
}

/** One row of the menu, and the closed state when it is the one being played. */
interface Choice {
  /** The game it belongs to, by the name the manifest uses — or `explore`. */
  game: string;
  /** What it is called within that game, already in the player's language. */
  label: string;
  /** What this length holds, for a board of the daily game. The open game has no par. */
  holds?: { minPar: number; maxPar: number } | undefined;
  at: Playing;
}

export function Boards({
  bands,
  games,
  at,
  onPlay,
}: {
  bands: readonly Band[];
  /** The games, in the manifest's order. A band's `mode` indexes this. */
  games: readonly { name: string }[];
  at: Playing;
  onPlay: (wanted: Playing) => void;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const box = useDismiss(
    open,
    useCallback(() => setOpen(false), []),
  );

  /*
    Every board there is, in one list, grouped by the game it belongs to.

    The daily ones come from the manifest, because the bank decides what a day offers. The open
    ones do not: there is one per game whose graph can be mapped, which is every game there is,
    and nothing in the data says so because there is nothing for the builder to have built.
  */
  const choices: Choice[] = [
    ...bands.map((band, index) => ({
      game: games[band.mode]?.name ?? '',
      label: bandName(intl, band.label),
      holds: band,
      at: { daily: index } as Playing,
    })),
    ...games.map((game) => ({
      game: EXPLORE,
      // A map is named after the game it is a map of, so its label is that game's name — which
      // is why it is `gameName` here and `bandName` above.
      label: gameName(intl, game.name),
      at: { explore: game.name } as Playing,
    })),
  ];

  const here = choices.find((choice) => same(choice.at, at));
  if (!here) return null;

  /** What a length holds, in the smaller hand the tabs used for it. */
  const holds = (choice: Choice) =>
    choice.holds && (
      <span className="text-[0.5625rem] tracking-[0.18em] normal-case opacity-70">
        <FormattedMessage
          {...header.lengthHolds}
          values={{ min: choice.holds.minPar, max: choice.holds.maxPar }}
        />
      </span>
    );

  return (
    <div ref={box} data-tour="length" className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={intl.formatMessage(header.chooseBoard)}
        className={`${CONTROL} gap-1 sm:gap-1.5 ${
          open ? 'border-gilt-dim text-gilt' : 'text-bone-dim'
        }`}
      >
        {/* The game as its mark, the board as a word. See the note at the top of the file. */}
        <span className="flex items-baseline gap-1 sm:gap-1.5">
          {hasGameIcon(here.game) ? (
            <GameIcon game={here.game} className="self-center opacity-80" />
          ) : (
            <span className="opacity-70">{gameName(intl, here.game)}</span>
          )}
          {here.label}
        </span>
        {/* Not on a phone, where the masthead is already three things wide. */}
        <span className="hidden sm:inline">{holds(here)}</span>
        <Caret />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={intl.formatMessage(header.boardMenu)}
          className={`${PANEL} left-0`}
        >
          {choices.map((choice, index) => (
            // Its place in the list, which is its address here — three games label their
            // boards with words the others use, and a label reused as a key is two options
            // React thinks are one.
            <Fragment key={index}>
              {/* A heading wherever the game changes, which is what turns a flat list of eight
                  into three lists. `role="presentation"` because it is not an option and must
                  not be counted as one by anything reading the menu aloud; the options
                  themselves are grouped for that purpose by their own labels. */}
              {choices[index - 1]?.game !== choice.game && (
                <p
                  role="presentation"
                  className="label text-ash border-rule mt-1 flex items-center gap-1.5 border-t px-3 pt-2 pb-1 first:mt-0 first:border-t-0"
                >
                  {/* The mark and the name together, which is the only place they appear
                      together and so the only place the mark can be learnt. */}
                  <GameIcon game={choice.game} />
                  {gameName(intl, choice.game)}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={same(choice.at, at)}
                // Read out with its game, because a heading is presentation and a player
                // hearing "short" alone has been told half of it.
                aria-label={playName(intl, choice.game, choice.label)}
                onClick={() => {
                  setOpen(false);
                  if (!same(choice.at, at)) onPlay(choice.at);
                }}
                className={`${CHOICE} flex items-baseline gap-2 pl-5 ${
                  same(choice.at, at) ? 'text-gilt' : 'text-ash-lit hover:text-bone-dim'
                }`}
              >
                {choice.label}
                {holds(choice)}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
