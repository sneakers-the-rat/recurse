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

/**
 * `round` is the round the link carried, when it could be read at all.
 *
 * **A link whose round was written against an older word list is the third state here**, and
 * it is the one worth being careful about. A code is positions into lists the word list
 * determines — see `staleCode` — so when the list moves, the same code names whatever now sits
 * at those positions. Sometimes that does not decode, and sometimes it decodes into a round
 * nobody played, which is the failure a visitor cannot see. Either way the remedy is one
 * sentence and it is the same sentence, so it is said in both: ask for a fresh link.
 *
 * The board underneath opens regardless, because its *address* no longer depends on the word
 * list. That is the whole point of the trade — a stale link costs the round and never the
 * board.
 */
export const SharedBoard = memo(function SharedBoard({
  onPlay,
  round,
  stale,
}: {
  onPlay: () => void;
  round: boolean;
  stale: boolean;
}) {
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
          <FormattedMessage {...(round ? says.sharedNote : says.staleRound)} />
        </span>
        {round && stale && (
          <span className="text-blood-lit">
            <FormattedMessage {...says.sharedStale} />
          </span>
        )}
        {/* Nothing to take over when the round could not be read: the board below already is
            the visitor's own. */}
        {round && (
          <button
            onClick={onPlay}
            className="label text-bone-dim hover:text-gilt ml-auto underline decoration-dotted underline-offset-4 transition-colors"
            type="button"
          >
            <FormattedMessage {...says.playShared} />
          </button>
        )}
      </p>
    </section>
  );
});
