/**
 * The vocabulary every route is written in: what a handler has, how it refuses, and who is
 * calling.
 *
 * Small on purpose. The interesting decision here is that **a refusal is a code and never a
 * sentence** — `Refusal` in api.ts — because the words a player reads live in
 * `src/i18n/messages/` and are translated, and a server that returned English would be the one
 * place in this project that wrote player-facing text somewhere else. The status code is chosen
 * here so that every route agrees about which refusal is a 400 and which is a 409, and the body
 * carries the fact.
 */

import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import type { Refusal, Refused } from '../../src/lib/api';
import { bearer, digestToken } from './auth';
import type { Bank } from './bank';
import type { Db } from './db';
import { players, sessions, type PlayerRow } from './db/schema';
import type { Env } from './env';
import { callerOf, type Bucket, type Limiter } from './limit';

/** Everything a route needs, passed in rather than imported, so a test can supply its own. */
export interface Deps {
  db: Db;
  bank: Bank;
  env: Env;
  limits: Limiter;
  /** The clock, injectable because the rate limiter and every timestamp read it. */
  now: () => number;
}

/** Hono's generics for this app: what `c.get` and `c.env` can be asked for. */
export interface App {
  Variables: {
    deps: Deps;
    /** The authenticated player, set by `mustBePlayer`. */
    player: PlayerRow;
  };
  /**
   * What the node adapter puts under `c.env`, described structurally rather than imported.
   *
   * Only the caller's address is wanted, and only the rate limiter wants it. Optional all the
   * way down because `app.request()` — which is how the tests drive this, and how any other
   * adapter would — has no node request behind it at all.
   */
  Bindings: {
    incoming?: { socket?: { remoteAddress?: string | undefined } | undefined } | undefined;
  };
}

const STATUS: Record<Refusal, 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500> = {
  malformed: 400,
  unauthorized: 401,
  // Not 403: the caller may well be allowed to register, just not under that name.
  taken: 409,
  credentials: 401,
  invalid: 422,
  'unknown-puzzle': 404,
  // The request was well-formed and the server understood it; what it says did not happen.
  unplayable: 422,
  'slow-down': 429,
  server: 500,
};

/**
 * Refuse, with a code the client can say in the player's own language.
 *
 * `why` is for a log or a terminal and is never rendered. It is worth writing: the two refusals
 * that will actually confuse somebody — `unplayable` and `malformed` — are much easier to
 * diagnose when the response says which action was wrong.
 */
export function refuse(c: Context, error: Refusal, why?: string): Response {
  const body: Refused = why === undefined ? { error } : { error, message: why };
  return c.json(body, STATUS[error]);
}

/**
 * Hold this route to one of the rate buckets.
 *
 * Per caller and per bucket, so a player reading scoreboards does not spend the allowance they
 * would need to log in. `callerOf` decides what "per caller" means, and behind a proxy that is
 * only trustworthy because `RECURSE_PROXIED` says something trustworthy sets the header.
 */
export function limited(bucket: Bucket): MiddlewareHandler<App> {
  return async (c, next) => {
    const { limits, env, now } = c.get('deps');
    const address = c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
    const who = callerOf(c.req.raw.headers, address, env.proxied);
    if (!limits.take(bucket, who, now())) return refuse(c, 'slow-down');
    await next();
    return;
  };
}

/**
 * Only for somebody holding a valid token.
 *
 * Every session use touches `used`, which is what a later "retire tokens nobody carries" would
 * read. One extra write per request against an indexed primary key, which is nothing, and the
 * alternative is a column that is always the day everybody signed up.
 */
export function mustBePlayer(): MiddlewareHandler<App> {
  return async (c, next) => {
    const { db, now } = c.get('deps');
    const token = bearer(c.req.header('authorization'));
    if (token === null) return refuse(c, 'unauthorized', 'no bearer token');

    const digest = digestToken(token);
    const found = db
      .select({ player: players })
      .from(sessions)
      .innerJoin(players, eq(players.id, sessions.player))
      .where(eq(sessions.token, digest))
      .get();
    if (!found) return refuse(c, 'unauthorized', 'that token names nobody');

    db.update(sessions).set({ used: now() }).where(eq(sessions.token, digest)).run();
    c.set('player', found.player);
    await next();
    return;
  };
}

/**
 * The player if there is one, without insisting.
 *
 * A scoreboard is readable by anybody — it is the screen a player sees the moment they finish,
 * before they have thought about who they are — but it says more to somebody it recognises,
 * because it can point at their own row. So this is the same lookup with no refusal in it.
 */
export function playerIfAny(c: Context<App>): PlayerRow | null {
  const { db } = c.get('deps');
  const token = bearer(c.req.header('authorization'));
  if (token === null) return null;
  const found = db
    .select({ player: players })
    .from(sessions)
    .innerJoin(players, eq(players.id, sessions.player))
    .where(eq(sessions.token, digestToken(token)))
    .get();
  return found?.player ?? null;
}
