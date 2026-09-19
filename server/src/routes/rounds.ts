/**
 * Rounds: submitting one, reading your own, and the low score screen.
 *
 * A submission is **the actions**, and the score is this server's finding — see rounds.ts for
 * what that buys and what it does not. Everything below is the plumbing around that one idea:
 * find the puzzle in the bank, fetch the graph of whichever mode it belongs to, replay, and
 * write the result down unless what is already stored should be kept.
 *
 * **The scoreboard is a low score screen**: fewest guesses first, because in this game the
 * number is a cost. Ties break on hints, and then on who got there first — a player who solved
 * it in four with no help is above a player who solved it in four with three hints, and between
 * two identical rounds the earlier one leads. Nothing here is a tiebreak on *speed*, which the
 * game does not measure and should not start measuring by the back door.
 */

import { and, asc, count, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  readPuzzleId,
  readSubmission,
  type RoundView,
  type Score,
  type Scoreboard,
} from '../../../src/lib/api';
import { rounds } from '../db/schema';
import { players } from '../db/schema';
import { limited, mustBePlayer, playerIfAny, refuse, type App } from '../http';
import { keepExisting, scoreRound } from '../rounds';
import { playerView } from './players';

/** How many rows a scoreboard shows, and the most it will show if asked. */
const SHOWN = 10;
const MOST = 50;

const when = (at: number) => new Date(at).toISOString();

export function roundRoutes() {
  const route = new Hono<App>();

  /**
   * Submit a round, finished or not.
   *
   * A `PUT` because there is one round per player per puzzle and sending the same one twice must
   * mean what sending it once meant. What makes that true is `keepExisting`, which is also what
   * keeps a stale tab from rolling a player's own progress back.
   *
   * The reply is always the round as *stored*, not the round as sent, so a client that was
   * refused an overwrite finds out by reading what came back rather than by being told no. There
   * is nothing to apologise for in that case: both are the player's own rounds.
   */
  route.put('/:puzzle', limited('write'), mustBePlayer(), async (c) => {
    const deps = c.get('deps');
    const player = c.get('player');

    const id = readPuzzleId(c.req.param('puzzle'));
    if (id === null) return refuse(c, 'malformed', 'that is not a puzzle id');

    const body = readSubmission({ ...(await c.req.json().catch(() => ({}))), puzzle: id });
    if (body === null) return refuse(c, 'malformed', 'expected a series of actions');

    const puzzle = await deps.bank.puzzle(id);
    if (puzzle === null) return refuse(c, 'unknown-puzzle');

    const graph = await deps.bank.graphFor(puzzle);
    const scored = scoreRound(body.actions, puzzle, graph);
    if (scored === null) {
      return refuse(c, 'unplayable', 'those actions do not replay on this puzzle');
    }

    const at = deps.now();
    const stored = deps.db
      .select()
      .from(rounds)
      .where(and(eq(rounds.player, player.id), eq(rounds.puzzle, id)))
      .get();

    if (stored && keepExisting(stored, scored)) {
      return c.json(view(stored, player, deps.bank.manifest.version));
    }

    const row = {
      player: player.id,
      puzzle: id,
      actions: JSON.stringify(body.actions),
      guesses: scored.guesses,
      hints: scored.hints,
      misses: scored.misses,
      solved: scored.solved,
      par: puzzle.par,
      band: puzzle.band,
      bank: deps.bank.manifest.version,
      created: stored?.created ?? at,
      updated: at,
      // The first time it was solved and not the last time it was written: it breaks ties on the
      // scoreboard, so re-submitting a finished round must not move anybody up or down.
      solvedAt: scored.solved ? (stored?.solvedAt ?? at) : null,
    };

    if (stored) {
      deps.db.update(rounds).set(row).where(eq(rounds.id, stored.id)).run();
    } else {
      deps.db.insert(rounds).values(row).run();
    }
    return c.json(view(row, player, row.bank), stored ? 200 : 201);
  });

  /** Every round this player has, newest first. The history behind a `/stats` that syncs. */
  route.get('/', limited('read'), mustBePlayer(), (c) => {
    const deps = c.get('deps');
    const player = c.get('player');
    const mine = deps.db
      .select()
      .from(rounds)
      .where(eq(rounds.player, player.id))
      .orderBy(sql`${rounds.updated} desc`)
      .all();
    return c.json({ rounds: mine.map((one) => view(one, player, one.bank)) });
  });

  return route;
}

export function scoreRoutes() {
  const route = new Hono<App>();

  /**
   * The low score screen for one puzzle.
   *
   * Readable without a token, because it is the screen that appears the moment a round ends and
   * a player who has never registered is exactly who is looking at it. A token adds one thing:
   * `you`, the caller's own row and rank, **whether or not it is in the list** — a board you are
   * not on is a board about other people.
   */
  route.get('/:puzzle/scores', limited('read'), async (c) => {
    const deps = c.get('deps');
    const id = readPuzzleId(c.req.param('puzzle'));
    if (id === null) return refuse(c, 'malformed', 'that is not a puzzle id');

    const asked = Number(c.req.query('limit') ?? SHOWN);
    const shown = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MOST) : SHOWN;

    // The puzzle is looked up so that `par` on the board is the bank's, not a number read off
    // whichever round happens to be top. An id nobody has played is a board with no rows in it
    // rather than a 404 — which is the ordinary case for the first person to finish today.
    const puzzle = await deps.bank.puzzle(id);
    if (puzzle === null) return refuse(c, 'unknown-puzzle');

    const solved = and(eq(rounds.puzzle, id), eq(rounds.solved, true));
    const rows = deps.db
      .select({ round: rounds, player: players })
      .from(rounds)
      .innerJoin(players, eq(players.id, rounds.player))
      .where(solved)
      .orderBy(asc(rounds.guesses), asc(rounds.hints), asc(rounds.solvedAt))
      .limit(shown)
      .all();

    const total = deps.db.select({ n: count() }).from(rounds).where(solved).get()?.n ?? 0;

    const board: Scoreboard = {
      puzzle: id,
      par: puzzle.par,
      bank: deps.bank.manifest.version,
      players: total,
      scores: rows.map((row, at) => line(at + 1, row.round, row.player)),
      you: null,
    };

    const me = playerIfAny(c);
    if (me) {
      const mine = deps.db
        .select()
        .from(rounds)
        .where(and(eq(rounds.player, me.id), eq(rounds.puzzle, id), eq(rounds.solved, true)))
        .get();
      if (mine) board.you = line(rankOf(deps.db, id, mine), mine, me);
    }

    return c.json(board);
  });

  return route;
}

/**
 * Where a round sits on the board: how many rounds beat it, plus one.
 *
 * Counted rather than read off the page, because the caller's row is usually not on the page —
 * that is the whole reason `you` exists. The comparison is the `ORDER BY` written out: fewer
 * guesses wins, then fewer hints, then earlier.
 */
function rankOf(
  db: App['Variables']['deps']['db'],
  puzzle: string,
  mine: { guesses: number; hints: number; solvedAt: number | null },
): number {
  const ahead =
    db
      .select({ n: count() })
      .from(rounds)
      .where(
        and(
          eq(rounds.puzzle, puzzle),
          eq(rounds.solved, true),
          sql`(${rounds.guesses} < ${mine.guesses}
            or (${rounds.guesses} = ${mine.guesses}
                and (${rounds.hints} < ${mine.hints}
                     or (${rounds.hints} = ${mine.hints}
                         and ${rounds.solvedAt} < ${mine.solvedAt ?? 0}))))`,
        ),
      )
      .get()?.n ?? 0;
  return ahead + 1;
}

function line(
  rank: number,
  round: { guesses: number; hints: number; solvedAt: number | null; updated: number },
  player: Parameters<typeof playerView>[0],
): Score {
  return {
    rank,
    player: playerView(player),
    guesses: round.guesses,
    hints: round.hints,
    at: when(round.solvedAt ?? round.updated),
  };
}

function view(
  row: {
    puzzle: string;
    guesses: number;
    hints: number;
    misses: number;
    solved: boolean;
    par: number;
    updated: number;
  },
  player: Parameters<typeof playerView>[0],
  bank: string,
): RoundView {
  return {
    puzzle: row.puzzle,
    player: playerView(player),
    guesses: row.guesses,
    hints: row.hints,
    misses: row.misses,
    solved: row.solved,
    par: row.par,
    bank,
    at: when(row.updated),
  };
}
