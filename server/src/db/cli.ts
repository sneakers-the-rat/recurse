/**
 * `npm run migrate`: bring the database up to date without starting the server.
 *
 * The server migrates on start-up anyway, so this is for the deploy that wants the schema
 * change to have happened — and to have failed, if it was going to — before the old process is
 * stopped.
 */

import { loadEnvFile, readEnv } from '../env';
import { openDb } from './index';
import { migrate } from './migrate';

loadEnvFile();
const env = readEnv();
const { handle } = openDb(env.db);
const ran = migrate(handle, (line) => console.log(line));
console.log(ran === 0 ? `${env.db} is up to date` : `${env.db}: ${ran} migration(s) applied`);
handle.close();
