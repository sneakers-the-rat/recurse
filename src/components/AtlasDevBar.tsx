/**
 * The dev bar over an open map. Separate from `DevBar`, which is about a puzzle.
 *
 * `walk` plays a run of legal guesses one at a time, animated; `fill` makes the same run in one
 * pass. Both go through the ordinary guess. The second box names a word to spread out from
 * breadth first (`spread` in atlas.ts); left empty the run is a random walk (`wander`).
 */

import { memo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { dev as says } from '../i18n/messages/dev';
import { Field, Key, Stat } from './DevKeys';
import type { Lexicon } from '../lib/lexicon';

/** Enough mana to try every power. */
const PURSE = 99;

interface Props {
  /** Words reached, and words in the figure (found plus rim). */
  found: number;
  figure: number;
  regions: number;
  points: number;
  /** The word the next guess is made from. */
  at: string;
  lexicon: Lexicon;
  /** Steps of a walk still to come. */
  walking: number;
  /** Whether a typed spelling is a found word, and so somewhere a run can start from. */
  knows: (typed: string) => boolean;
  /** Play this many guesses one at a time; again to stop. `from` empty means a random walk. */
  onWalk: (steps: number, from: string) => void;
  /** The same run in one pass, with no animation. */
  onFill: (steps: number, from: string) => void;
  onPay: (points: number) => void;
  /** Reset the map to its starting word. */
  onBlank: () => void;
  onHide: () => void;
}

/** Moves per run when the count box is empty. */
const SOME = 50;

export const AtlasDevBar = memo(function AtlasDevBar({
  found,
  figure,
  regions,
  points,
  at,
  lexicon,
  walking,
  knows,
  onWalk,
  onFill,
  onPay,
  onBlank,
  onHide,
}: Props) {
  const intl = useIntl();
  const [steps, setSteps] = useState('');
  const [origin, setOrigin] = useState('');

  const howMany = () => {
    const n = Number(steps);
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : SOME;
  };
  const from = origin.trim();
  const nowhere = from !== '' && !knows(from);

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
            onWalk(howMany(), from);
          }}
        >
          <Field
            value={steps}
            onChange={setSteps}
            placeholder={intl.formatMessage(says.walkHow)}
            label={intl.formatMessage(says.walkLabel)}
          />
          <Field
            value={origin}
            onChange={setOrigin}
            width="w-28"
            wrong={nowhere}
            placeholder={intl.formatMessage(says.walkFrom)}
            label={intl.formatMessage(says.walkFromLabel)}
          />
          {/* `Key` is `type="button"`, so Enter reaches the form's handler and a click this. */}
          <Key onClick={() => onWalk(howMany(), from)}>
            <FormattedMessage {...(walking > 0 ? says.stopWalk : says.walk)} />
          </Key>
          <Key onClick={() => onFill(howMany(), from)}>
            <FormattedMessage {...says.fill} />
          </Key>
          {walking > 0 && <Stat name={says.walk}>{walking}</Stat>}
        </form>

        <Stat name={says.found}>{found}</Stat>
        <Stat name={says.figure}>{figure}</Stat>
        <Stat name={says.territories}>{regions}</Stat>
        <Stat name={says.mana}>{points}</Stat>
        <Stat name={says.standing}>{lexicon.label(at)}</Stat>

        <span className="ml-auto flex items-center gap-1.5">
          <Key onClick={() => onPay(PURSE)}>
            <FormattedMessage {...says.pay} />
          </Key>
          <Key onClick={onBlank}>
            <FormattedMessage {...says.blank} />
          </Key>
          <Key onClick={onHide} label={intl.formatMessage(says.hideLabel)}>
            <FormattedMessage {...says.hide} />
          </Key>
        </span>
      </div>
    </div>
  );
});
