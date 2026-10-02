/**
 * The board switch: a menu on the masthead line offering every board of every game.
 *
 * Drawn rather than a native `<select>`, whose open menu cannot be styled. Rows are grouped
 * under a heading per game, so each row is just the board's label. The closed state shows the
 * game as its mark, falling back to its name for a game with no mark.
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

/** A daily board by its index in the manifest's bands, or an open map by its game's name. */
export type Playing = { daily: number } | { explore: string };

function same(one: Playing, two: Playing): boolean {
  return 'daily' in one && 'daily' in two
    ? one.daily === two.daily
    : 'explore' in one && 'explore' in two && one.explore === two.explore;
}

/** One row of the menu. */
interface Choice {
  /** The manifest's mode name, or `explore`. */
  game: string;
  /** Already translated. */
  label: string;
  /** The par range, for a daily board. */
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
  /**
   * Every mode in the manifest, unfiltered, since a band's `mode` indexes it. Includes the
   * explore graphs, which carry `of` (see `RawMode.of` in data.ts) and are not offered.
   */
  games: readonly { name: string; of?: string }[];
  at: Playing;
  onPlay: (wanted: Playing) => void;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const box = useDismiss(
    open,
    useCallback(() => setOpen(false), []),
  );

  // The daily bands, then one open map per daily game.
  const choices: Choice[] = [
    ...bands.map((band, index) => ({
      game: games[band.mode]?.name ?? '',
      label: bandName(intl, band.label),
      holds: band,
      at: { daily: index } as Playing,
    })),
    ...games
      .filter((game) => game.of === undefined)
      .map((game) => ({
        game: EXPLORE,
        // A map is labelled with the name of the game it maps.
        label: gameName(intl, game.name),
        at: { explore: game.name } as Playing,
      })),
  ];

  const here = choices.find((choice) => same(choice.at, at));
  if (!here) return null;

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
            // Keyed by index: labels repeat across games.
            <Fragment key={index}>
              {/* A heading wherever the game changes; presentation only, so not an option. */}
              {choices[index - 1]?.game !== choice.game && (
                <p
                  role="presentation"
                  className="label text-ash border-rule mt-1 flex items-center gap-1.5 border-t px-3 pt-2 pb-1 first:mt-0 first:border-t-0"
                >
                  <GameIcon game={choice.game} />
                  {gameName(intl, choice.game)}
                </p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={same(choice.at, at)}
                // Includes the game, since the heading is not read out.
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
