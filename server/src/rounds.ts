/**
 * Scoring a round, by playing it.
 *
 * The one thing this server does that a thin CRUD layer would not: a client does not say what it
 * scored, it says what it *did*, and the score is worked out here. `replayActions` turns the
 * series into the snapshot a reload would have produced and `restore` turns that into a game —
 * both of them the client's own code, imported unchanged. There is one definition of what a
 * guess costs and it is `game.ts`, and this module deliberately adds nothing to it.
 *
 * **What that is and is not worth.** It is not a proof that somebody played fairly: a solver
 * given the dictionary can find the shortest route in milliseconds and submit it as a series of
 * honest-looking actions, and nothing in a leaderboard can tell that from a person who was very
 * good. What it does buy is that **every score on the board corresponds to a real route through
 * the real graph** — the numbers are commensurable, a round cannot claim a par it did not walk,
 * and a bug in a client cannot inflate anybody. That is the property a scoreboard actually
 * needs, and the rest is a social problem rather than a technical one.
 *
 * **A round that does not replay exactly is refused.** `restore` and `replayActions` are both
 * forgiving by design — a move the graph does not have is dropped, because a snapshot out of
 * `localStorage` is the player's own history and salvaging it is kindness. Here the same
 * forgiveness would quietly score a round as something other than what was submitted, so the
 * count is checked afterwards and a mismatch is an error rather than a smaller number. It is
 * also the signal worth having: an honest client that is a bank behind fails this way, and the
 * player can be told to reload rather than shrugged at.
 */

import { replayActions, type Action } from '../../src/lib/actions';
import { hintCount, restore } from '../../src/lib/game';
import type { Graph, Puzzle } from '../../src/lib/types';

/** What replaying a round found out about it. Every field derived; none received. */
export interface Scored {
  guesses: number;
  hints: number;
  misses: number;
  solved: boolean;
}

/**
 * Play the actions and read the result, or null if they do not play.
 *
 * Null covers both a fabricated series and an honest one against the wrong bank; the caller
 * turns it into `unplayable`, which is one refusal because the client's answer is the same
 * either way — reload, and try again.
 */
export function scoreRound(
  actions: readonly Action[],
  puzzle: Puzzle,
  graph: Graph,
): Scored | null {
  const state = restore(puzzle, replayActions(actions, puzzle, graph));

  // Every `guess` action should have produced a guess. `replayActions` skips a move the graph
  // does not join and one that was already made, and `restore` skips again on the same two
  // rules — so a series with anything invented in it arrives here having been quietly trimmed,
  // and this is where that is noticed. An honest round played on this bank is exact.
  const claimed = actions.filter((one) => one.do === 'guess').length;
  if (state.guesses !== claimed) return null;

  return {
    guesses: state.guesses,
    hints: hintCount(state),
    misses: state.misses,
    solved: state.solved,
  };
}

/**
 * Should the round already stored be kept, rather than replaced by this one?
 *
 * Both halves of the rule are the local store's, brought over so that two devices behave the way
 * one device does:
 *
 * - **A finished round is never overwritten.** That is `addCompletion`'s "first write per pair
 *   wins", and it exists for the same reason: a board can be opened again after it is done — to
 *   read the result, to copy the share text — and every one of those visits offers the round
 *   again. Keeping the first is what makes this a log of rounds rather than of visits.
 * - **An unfinished round is only replaced by one further along.** A phone that was left open on
 *   a board and comes back three guesses behind must not roll a laptop's progress back, and
 *   guesses only ever go up within one round.
 *
 * Equal guesses keeps what is there, so a resubmission of the same state writes nothing.
 */
export function keepExisting(stored: { solved: boolean; guesses: number }, fresh: Scored): boolean {
  if (stored.solved) return true;
  return fresh.guesses <= stored.guesses && !fresh.solved;
}
