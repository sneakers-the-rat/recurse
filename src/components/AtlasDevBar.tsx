/**
 * The instrument panel over an open map.
 *
 * A second bar rather than a wider `DevBar`, because almost everything that one says is about a
 * puzzle: an index into the calendar, a par, a corridor, an answer, a code written against two
 * endpoints. None of that exists here. What carries over is the *look* — see `DevKeys` — and
 * the two keys that mean the same thing on any board: start again, and put the instruments away.
 *
 * **`walk` is the point of it.** Every question this mode's layout turns on is about a map of a
 * thousand words or five, and the only honest way to have one is to have played it. So the bar
 * plays: `wander` makes that many random legal guesses and the board grows in front of you,
 * through the same guess, the same arrangement and the same ooze a typed word goes through.
 * Nothing here is a shortcut past the game, only past the typing.
 *
 * **Two keys, because there are two questions.** `walk` plays the run one guess at a time, each
 * arrival animating in as a typed one would — which is how "what does a guess onto a hub look
 * like" gets answered at all, and is therefore what the key a person reaches for should do.
 * `fill` makes the same run in one pass with no animation, for when what is wanted is a large map
 * to look at rather than the growing of one: a walk of two thousand played out is half an hour,
 * and `e2e/atlas.spec.ts` shoots its contact sheet in thirty seconds.
 *
 * Styled flat and mono for the reason the other one is: a screenshot of an instrumented board
 * must never be mistaken for the game.
 */

import { memo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { dev as says } from '../i18n/messages/dev';
import { Field, Key, Stat } from './DevKeys';
import type { Lexicon } from '../lib/lexicon';

/** Enough mana to buy anything, for trying the powers without earning first. */
const PURSE = 99;

interface Props {
  /** Words reached, and words the figure holds — everything found plus its rim. */
  found: number;
  figure: number;
  /** How many of those survive the cull to what is in shot. See detail.ts. */
  shown: number;
  regions: number;
  points: number;
  /** Where the next guess would be made from, written the way the player reads it. */
  at: string;
  lexicon: Lexicon;
  /** How many steps of a walk are still to come, so the key can offer to call it off. */
  walking: number;
  /** Play this many random legal guesses, one at a time. Again, to stop. See `wander`. */
  onWalk: (steps: number) => void;
  /** The same run in one pass, with no animation. */
  onFill: (steps: number) => void;
  /** Hand over enough mana to exercise the powers. */
  onPay: (points: number) => void;
  /** Back to the one word the map began at. */
  onBlank: () => void;
  onHide: () => void;
}

/** How many moves a press of `walk` makes when the box is left empty. */
const SOME = 50;

export const AtlasDevBar = memo(function AtlasDevBar({
  found,
  figure,
  shown,
  regions,
  points,
  at,
  lexicon,
  walking,
  onWalk,
  onFill,
  onPay,
  onBlank,
  onHide,
}: Props) {
  const intl = useIntl();
  const [steps, setSteps] = useState('');

  const howMany = () => {
    const n = Number(steps);
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : SOME;
  };

  return (
    <div className="border-rule bg-noir-3 border-b font-mono text-[11px] text-neutral-400">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <span className="font-semibold tracking-wider text-neutral-500">
          <FormattedMessage {...says.bar} />
        </span>

        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            onWalk(howMany());
          }}
        >
          <Field
            value={steps}
            onChange={setSteps}
            placeholder={intl.formatMessage(says.walkHow)}
            label={intl.formatMessage(says.walkLabel)}
          />
          {/* Not a submit: every key in either bar is `type="button"`, so the form's own
              handler is what Enter reaches and this is what the click reaches. */}
          <Key onClick={() => onWalk(howMany())}>
            {/* Says *stop* while one is running: a walk of two thousand played one guess at a
                time takes as long as it takes, and there has to be a way out of it. */}
            <FormattedMessage {...(walking > 0 ? says.stopWalk : says.walk)} />
          </Key>
          <Key onClick={() => onFill(howMany())}>
            <FormattedMessage {...says.fill} />
          </Key>
          {walking > 0 && <Stat name={says.walk}>{walking}</Stat>}
        </form>

        <Stat name={says.found}>{found}</Stat>
        <Stat name={says.figure}>{figure}</Stat>
        <Stat name={says.shown}>{shown}</Stat>
        <Stat name={says.territories}>{regions}</Stat>
        <Stat name={says.mana}>{points}</Stat>
        {/* The word a guess would be made from, said the way the player reads it — in the
            phonemes game the token is a row of codes and tells nobody anything. */}
        <Stat name={says.standing}>{lexicon.label(at)}</Stat>

        <span className="ml-auto flex items-center gap-1.5">
          <Key onClick={() => onPay(PURSE)}>
            <FormattedMessage {...says.pay} />
          </Key>
          <Key onClick={onBlank}>
            <FormattedMessage {...says.blank} />
          </Key>
          {/* Says the key as well, because with the bar gone it is the only way back. */}
          <Key onClick={onHide} label={intl.formatMessage(says.hideLabel)}>
            <FormattedMessage {...says.hide} />
          </Key>
        </span>
      </div>
    </div>
  );
});
