/**
 * Somebody else's board, said out loud.
 *
 * A link can carry a round with it — see boardCode.ts — and when one does, everything on the
 * screen belongs to whoever sent it: the guesses in the header, the trail on the plate, the
 * score in the result. None of that is the visitor's, and a board that looked exactly like
 * their own would be a quiet lie about which of them played it. So one line above the figure
 * says whose it is, and offers the only thing there is to do about it.
 *
 * It is a strip rather than a dialog because there is nothing to answer: the board is the
 * thing worth looking at, and a panel over it would be in the way of the reason the link was
 * sent. And it is **one wrapping line** rather than a row of blocks, because every pixel it
 * takes is a pixel off the figure below it: a shared board that is also a finished round has
 * the result under this too, and the plate is what is left over. Three stacked rows of
 * letter-spaced caps is enough to clip the puzzle's own first word off the top of the board
 * on a phone.
 *
 * The way out is a link and not a button for the same reason, and it is the affordance the
 * day's other lengths already use two rows down — dotted underline, gilt on hover.
 */

import { memo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { round as says } from '../i18n/messages/round';

export const SharedBoard = memo(function SharedBoard({ onPlay }: { onPlay: () => void }) {
  const intl = useIntl();

  return (
    <section
      aria-label={intl.formatMessage(says.sharedBoard)}
      className="bg-noir-2 border-rule border-b"
    >
      {/*
        Separated by the gap rather than by a `·`, which is the one thing a wrapping line
        cannot have: a mark between two pieces ends up at the start of the second one the
        moment they land on different rows, and on a phone they always do.
      */}
      <p className="label mx-auto flex max-w-2xl flex-wrap items-baseline gap-x-3 px-4 py-2">
        <span className="text-bone">
          <FormattedMessage {...says.sharedBoard} />
        </span>
        {/* What it means, in the one clause that matters: nothing here is being kept. */}
        <span className="text-ash-lit">
          <FormattedMessage {...says.sharedNote} />
        </span>
        <button
          onClick={onPlay}
          className="label text-bone-dim hover:text-gilt ml-auto underline decoration-dotted underline-offset-4 transition-colors"
          type="button"
        >
          <FormattedMessage {...says.playShared} />
        </button>
      </p>
    </section>
  );
});
