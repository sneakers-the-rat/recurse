/**
 * Opening the database, and the four pragmas that matter.
 *
 * SQLite because the history of a word game is small, one process writes it, and a file that can
 * be copied with `cp` is the difference between "you could run your own" and "you could run your
 * own if you also ran a database". Drizzle is what keeps the table definitions and the types one
 * thing; it speaks Postgres too, so this is a decision that can be revisited by changing the
 * driver rather than the queries.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = ReturnType<typeof openDb>['db'];

/**
 * Open the database at `path`, or in memory when it is `:memory:`.
 *
 * The handle comes back beside the drizzle wrapper because two things need the raw one: the
 * migrations, which are SQL, and the tests, which want to close it.
 */
export function openDb(path: string) {
  const handle = new Database(path);

  // Write-ahead logging: a reader does not block the writer, which is what keeps a scoreboard
  // being drawn from waiting on somebody submitting a round.
  handle.pragma('journal_mode = WAL');
  // Off by default in SQLite, which means the `references` in schema.ts would be decoration.
  handle.pragma('foreign_keys = ON');
  // Wait rather than fail when the file is briefly locked. Five seconds is far longer than any
  // write here takes and turns a race into a pause.
  handle.pragma('busy_timeout = 5000');
  // `NORMAL` rather than `FULL`: with WAL it is durable across a process crash and only risks
  // the last transactions in a power cut, which for a scoreboard is the right trade against
  // an fsync per write.
  handle.pragma('synchronous = NORMAL');

  return { handle, db: drizzle(handle, { schema }) };
}
