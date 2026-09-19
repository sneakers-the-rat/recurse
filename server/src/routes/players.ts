/**
 * Who is playing: minting one, naming one, and coming back as one.
 *
 * **A player exists before an account does, and registering does not make a new one.** That is
 * the whole shape of this file. The first time a browser has anything to say it asks for a
 * player and gets a UUID and a token; every round it submits from then on hangs off that row.
 * Registering writes a username and a password hash onto *that same row*, so a history built up
 * anonymously is the account's history the moment there is an account — no copying, no merge
 * step, nothing that can half-succeed.
 *
 * The consequence to know, because it will come up: a player who has been playing anonymously on
 * a *second* device and then logs in there has two player rows, and only the one they logged
 * into follows them. Joining those up is a real feature with a real conflict rule and it is not
 * this one.
 *
 * **No email, so no reset.** Somebody who forgets their password has lost that account, and the
 * screen that takes the password has to say so plainly rather than leaving it to be discovered.
 */

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  nameProblem,
  passwordProblem,
  readCredentials,
  type Player,
  type Session,
} from '../../../src/lib/api';
import { hashPassword, newPlayerId, newToken, verifyPassword } from '../auth';
import { players, sessions, type PlayerRow } from '../db/schema';
import { limited, mustBePlayer, playerIfAny, refuse, type App, type Deps } from '../http';

/** The public view of a player. The hash is never in one, which is what this function is for. */
export function playerView(row: PlayerRow): Player {
  return { id: row.id, name: row.name };
}

/** A fresh token for a player, written down hashed. See auth.ts. */
function openSession(deps: Deps, player: PlayerRow): Session {
  const { token, digest } = newToken();
  const at = deps.now();
  deps.db.insert(sessions).values({ token: digest, player: player.id, created: at, used: at }).run();
  return { ...playerView(player), token };
}

/**
 * Both ways of taking a name and a password, sharing one set of refusals.
 *
 * Checked here rather than trusted from the client, which checks the same rules from the same
 * constants so it can say what is wrong before anything is sent. The client's check is a
 * courtesy; this one is the rule.
 */
function readForm(body: unknown) {
  const form = readCredentials(body);
  if (form === null) return null;
  if (nameProblem(form.username) !== null) return null;
  if (passwordProblem(form.password) !== null) return null;
  return form;
}

export function playerRoutes() {
  const route = new Hono<App>();

  /**
   * Mint an anonymous player.
   *
   * The only endpoint that creates a row for somebody holding nothing, so it is the one with the
   * strict limit on it — see `RATES.mint`. A player calls this once, ever.
   */
  route.post('/', limited('mint'), (c) => {
    const deps = c.get('deps');
    const row: PlayerRow = {
      id: newPlayerId(),
      name: null,
      hash: null,
      created: deps.now(),
    };
    deps.db.insert(players).values(row).run();
    return c.json(openSession(deps, row), 201);
  });

  /**
   * Take a name and a password.
   *
   * With a token, this names the caller's existing player and keeps everything they have done.
   * Without one it makes a new player, which is the person signing up on a fresh device before
   * they have played anything.
   *
   * A new token comes back either way, and the old one keeps working: registering is not a
   * security event, and signing somebody out of their other browser for having chosen a username
   * would be a surprising thing to do.
   */
  route.post('/register', limited('auth'), async (c) => {
    const deps = c.get('deps');
    const form = readForm(await c.req.json().catch(() => null));
    if (form === null) return refuse(c, 'invalid', 'username or password is not allowed');

    // Whoever the token names, if it names anybody. No refusal here: registering without one is
    // an ordinary thing to do.
    const existing = playerIfAny(c);
    if (existing?.name) return refuse(c, 'taken', 'this player has already registered');

    const hash = await hashPassword(form.password);
    const at = deps.now();

    // Uniqueness is the database's, not a read-then-write: two registrations racing for one name
    // both pass a `select` and only one may have it. The unique index is what decides, and the
    // loser arrives here as a constraint error rather than as a second row.
    try {
      if (existing) {
        deps.db
          .update(players)
          .set({ name: form.username, hash })
          .where(eq(players.id, existing.id))
          .run();
        return c.json(openSession(deps, { ...existing, name: form.username, hash }));
      }
      const row: PlayerRow = { id: newPlayerId(), name: form.username, hash, created: at };
      deps.db.insert(players).values(row).run();
      return c.json(openSession(deps, row), 201);
    } catch (error) {
      if (isUniqueViolation(error)) return refuse(c, 'taken', 'that name is taken');
      throw error;
    }
  });

  /**
   * A token for an existing account.
   *
   * The password is verified even when the name matches nobody, against a hash that cannot
   * match. Without that, a wrong name returns in a microsecond and a wrong password takes a
   * tenth of a second, and the difference is a way to find out which names exist.
   */
  route.post('/login', limited('auth'), async (c) => {
    const deps = c.get('deps');
    const form = readCredentials(await c.req.json().catch(() => null));
    if (form === null) return refuse(c, 'malformed', 'expected a username and a password');

    const found = deps.db.select().from(players).where(eq(players.name, form.username)).get();
    const ok = await verifyPassword(form.password, found?.hash ?? DECOY);
    if (!found || !ok) return refuse(c, 'credentials');
    return c.json(openSession(deps, found));
  });

  route.get('/me', mustBePlayer(), (c) => c.json(playerView(c.get('player'))));

  return route;
}

/**
 * A hash of nothing in particular, to be checked against when no player was found.
 *
 * Its only job is to cost what a real one costs. Built once at start-up rather than per request,
 * because hashing on the way in would itself be the timing signal.
 */
const DECOY = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** SQLite's way of saying a unique index refused a row. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  );
}
