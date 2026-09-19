/**
 * The schema, as SQL, applied in order.
 *
 * Written out rather than generated. drizzle-kit would produce these from schema.ts, and the
 * reason not to is the same reason `recurse.yaml` is committed: this is the file somebody reads
 * to find out what is actually in their database, and a generated one is a file nobody reads and
 * everybody runs. The cost is that schema.ts and this have to be changed together — so the
 * tests open a fresh database, migrate it, and use the drizzle tables against it, which is what
 * catches the two drifting apart.
 *
 * **Append only.** A migration that has run is history: change one and the databases that
 * already ran it disagree with the ones that have not, silently. Fixing a mistake means a new
 * entry that undoes it.
 *
 * Tracked in SQLite's own `user_version`, an integer in the file header that exists for exactly
 * this and costs no table. Each step runs in a transaction with the bump, so an interrupted
 * migration leaves the version where it was rather than half-applied.
 */

import type Database from 'better-sqlite3';

interface Step {
  /** What it is for, in a few words. Printed as it runs. */
  what: string;
  sql: string;
}

const STEPS: Step[] = [
  {
    what: 'players, sessions and rounds',
    sql: `
      CREATE TABLE players (
        id       TEXT PRIMARY KEY,
        name     TEXT,
        hash     TEXT,
        created  INTEGER NOT NULL
      );

      -- Unique over the non-null names. SQLite treats NULLs as distinct in a unique index, so
      -- every anonymous player coexists here without a partial index saying so.
      CREATE UNIQUE INDEX players_name ON players (name);

      CREATE TABLE sessions (
        token    TEXT PRIMARY KEY,
        player   TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
        created  INTEGER NOT NULL,
        used     INTEGER NOT NULL
      );

      CREATE INDEX sessions_player ON sessions (player);

      CREATE TABLE rounds (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        player    TEXT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
        puzzle    TEXT NOT NULL,
        actions   TEXT NOT NULL,
        guesses   INTEGER NOT NULL,
        hints     INTEGER NOT NULL,
        misses    INTEGER NOT NULL,
        solved    INTEGER NOT NULL,
        par       INTEGER NOT NULL,
        band      INTEGER NOT NULL,
        bank      TEXT NOT NULL,
        created   INTEGER NOT NULL,
        updated   INTEGER NOT NULL,
        solved_at INTEGER
      );

      -- One round per player per puzzle: what makes a submission an upsert rather than an append.
      CREATE UNIQUE INDEX rounds_player_puzzle ON rounds (player, puzzle);

      -- The scoreboard's order, as an index. Partial, because an unsolved round is never on one
      -- and there are far more of those.
      CREATE INDEX rounds_board ON rounds (puzzle, guesses, hints, solved_at) WHERE solved = 1;
    `,
  },
];

/**
 * Bring a database up to date. Returns how many steps ran, which is 0 on every start but the
 * first after a change.
 */
export function migrate(handle: Database.Database, say: (line: string) => void = () => {}): number {
  const at = Number(
    (handle.pragma('user_version', { simple: true }) as number | bigint | undefined) ?? 0,
  );
  if (at > STEPS.length) {
    throw new Error(
      `this database is at schema version ${at} and this server only knows ${STEPS.length}: ` +
        'it was written by a later version of the server',
    );
  }
  let ran = 0;
  for (let step = at; step < STEPS.length; step++) {
    const { what, sql } = STEPS[step]!;
    say(`migrating to ${step + 1}: ${what}`);
    handle.transaction(() => {
      handle.exec(sql);
      // Not a bound parameter: pragmas do not take them. The value is a loop counter.
      handle.pragma(`user_version = ${step + 1}`);
    })();
    ran += 1;
  }
  return ran;
}
