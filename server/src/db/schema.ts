/**
 * What is kept, and the reasons for each column.
 *
 * Three tables, which is the whole of it: who is playing, what proves they are them, and every
 * round anybody has played.
 *
 * **A round is stored as its actions, not as a score.** The numbers beside them — guesses,
 * hints, solved — are the server's own findings, written down because a scoreboard has to sort
 * by something without replaying ten thousand rounds. They are a cache of the actions, and the
 * actions are the record: a bug in the scoring is then a re-derivation rather than a history
 * that is quietly wrong for ever. `par` and `bank` are stored beside them because par is a taste
 * knob that moves week to week while a puzzle's id does not, so a score against a par that has
 * since changed is visible rather than silent.
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Somebody playing, registered or not.
 *
 * **A player exists before an account does.** The first round anybody submits mints one of
 * these with no name and no password, and registering fills those two columns in on the *same*
 * row — which is what makes "your history becomes your account's history" true by construction
 * rather than by a migration step that could half-fail.
 *
 * `name` is null exactly when nobody has registered, and a scoreboard draws that as "anonymous",
 * a word that lives in the message catalog and never in this column.
 */
export const players = sqliteTable(
  'players',
  {
    /** A UUID, minted by the server. Public: it travels in every scoreboard. */
    id: text('id').primaryKey(),
    /**
     * The name on a scoreboard, exactly as it was typed, or null for anonymous.
     *
     * Unique case-sensitively, which is the rule `api.ts` documents: `Jonny` and `jonny` are two
     * accounts. If that ever reads as a mistake on a live scoreboard it is a unique index on
     * `lower(name)` and a one-off check for collisions — easier to add than to take away.
     */
    name: text('name'),
    /** The password, hashed. Null until somebody registers. See auth.ts for the format. */
    hash: text('hash'),
    created: integer('created').notNull(),
  },
  (table) => [uniqueIndex('players_name').on(table.name)],
);

/**
 * A token that proves somebody is a player.
 *
 * **The token is stored hashed, like a password**, because it is one: anybody holding the string
 * is the player until it is revoked, so a copy of this table should not be a copy of everybody's
 * logins. The hash is a plain SHA-256 and not the slow one — the input is 32 random bytes rather
 * than something a person chose, so there is nothing to guess and nothing to slow down.
 *
 * A row per login rather than a column on the player, so signing in on a phone does not sign out
 * a laptop, and so one device can be revoked without touching the rest.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the bearer token, hex. The token itself is never written down. */
    token: text('token').primaryKey(),
    player: text('player')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    created: integer('created').notNull(),
    /** Last time this token was used, for retiring the ones nobody carries any more. */
    used: integer('used').notNull(),
  },
  (table) => [index('sessions_player').on(table.player)],
);

/**
 * One round: one player, one puzzle, finished or not.
 *
 * **One row, updated as play goes on**, rather than an append-only log of every state a board
 * passed through. A round is a thing somebody is doing and there is only ever one of it per
 * board — which is also how the local store thinks (`storage.ts` keys a game by its puzzle) — so
 * the unique index is on the pair and the submission handler is an upsert with a rule about when
 * it may overwrite. See `keepExisting` in rounds.ts: a solved round is never replaced, and an
 * unsolved one is only replaced by one further along, so a stale tab cannot roll anybody back.
 */
export const rounds = sqliteTable(
  'rounds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    player: text('player')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    /** The puzzle's id — its address, and a digest of its answer. See graphgen's id.rs. */
    puzzle: text('puzzle').notNull(),
    /**
     * Every action, as JSON. **The record; everything else in this row is derived from it.**
     *
     * Text rather than a blob because it is the column somebody will want to read with `sqlite3`
     * when a score looks wrong, and legibility is the reason this is not a board code.
     */
    actions: text('actions').notNull(),

    /* Derived by replaying `actions`. Never received from a client. */
    guesses: integer('guesses').notNull(),
    hints: integer('hints').notNull(),
    misses: integer('misses').notNull(),
    solved: integer('solved', { mode: 'boolean' }).notNull(),

    /** The puzzle's par and its band, from the bank at the time. Both can move; the id cannot. */
    par: integer('par').notNull(),
    band: integer('band').notNull(),
    /** Which bank the two above came from — `manifest.version`. */
    bank: text('bank').notNull(),

    created: integer('created').notNull(),
    updated: integer('updated').notNull(),
    /**
     * When the round was first *solved*.
     *
     * Its own column because it is what breaks a tie on the scoreboard, and neither of the other
     * two says it: `created` is when the board was first touched, which rewards opening one and
     * sitting on it, and `updated` moves every time the row is written.
     */
    solvedAt: integer('solved_at'),
  },
  (table) => [
    uniqueIndex('rounds_player_puzzle').on(table.player, table.puzzle),
    /**
     * The scoreboard's own index: one puzzle, solved rounds, in rank order.
     *
     * Partial, on `solved`, because an unsolved round is never on a scoreboard and there will be
     * far more of those than of finished ones. The column order is the `ORDER BY` — guesses,
     * then hints, then who got there first.
     */
    index('rounds_board')
      .on(table.puzzle, table.guesses, table.hints, table.solvedAt)
      .where(sql`${table.solved} = 1`),
  ],
);

export type PlayerRow = typeof players.$inferSelect;
export type RoundRow = typeof rounds.$inferSelect;
