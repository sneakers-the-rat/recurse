/**
 * Starting up, in the order that makes a failure say what is wrong.
 *
 * Configuration, then the database, then the bank, then the port — each one refusing loudly
 * rather than being deferred to the first request that needs it. A server that starts, looks
 * healthy, and turns away every round because it could not reach the site an hour ago is the
 * failure worth designing against; so the bank is fetched here, before anything is listening.
 *
 * The consequence is that this server cannot start while the site it scores for is down. That is
 * the right way round: it has nothing useful to say in that state anyway, and a process that
 * exits is a process systemd will restart.
 */

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { openBank } from './bank';
import { openDb } from './db';
import { migrate } from './db/migrate';
import { loadEnvFile, readEnv } from './env';
import { limiter } from './limit';

/** How often to drop rate-limit entries nobody is using. Cheap, and unbounded memory is not. */
const SWEEP = 10 * 60_000;

async function main() {
  loadEnvFile();
  const env = readEnv();

  const { handle, db } = openDb(env.db);
  const ran = migrate(handle, (line) => console.log(line));
  if (ran > 0) console.log(`database ready at ${env.db}`);

  console.log(`fetching the bank from ${env.data}`);
  const bank = await openBank(env.data);
  console.log(`bank ${bank.manifest.version}: ${bank.manifest.puzzles} puzzles`);

  const limits = limiter();
  const sweeping = setInterval(() => limits.sweep(Date.now()), SWEEP);
  // Nothing should be kept alive by a timer whose only job is housekeeping.
  sweeping.unref();

  const app = createApp({ db, bank, env, limits, now: () => Date.now() });

  serve({ fetch: app.fetch, port: env.port }, (at) => {
    console.log(`listening on http://localhost:${at.port}`);
    console.log(
      env.origins === '*'
        ? 'any origin may call this'
        : `origins allowed: ${env.origins.join(', ')}`,
    );
  });
}

main().catch((error: unknown) => {
  // The message alone for a misconfiguration, which is a sentence somebody has to read and act
  // on; the whole error for anything else, which is a thing to debug.
  if (error instanceof Error && error.name === 'Misconfigured') console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});
