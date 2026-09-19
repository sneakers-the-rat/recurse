/**
 * The app: what every request passes through before it reaches a route.
 *
 * Built from its dependencies rather than reaching for them, so a test gets an app over an
 * in-memory database and a stub bank without a network, a port, or a `.env` anywhere.
 *
 * **The origin allowlist is hygiene and not a control**, and it is worth being exact about why,
 * because it is the thing people reach for when they mean "only my site may use this". CORS is
 * enforced by browsers: it stops a *page* on another origin from reading a response made with
 * this player's token. It does nothing at all about curl, a script, or anything that is not a
 * browser obeying the rules — none of which send an `Origin` they did not choose. What actually
 * holds here is the bearer token and the rate limiter. The allowlist is still worth setting: the
 * attack it prevents is real, it is just not the attack people usually have in mind.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { API_VERSION } from '../../src/lib/api';
import { refuse, type App, type Deps } from './http';
import { playerRoutes } from './routes/players';
import { roundRoutes, scoreRoutes } from './routes/rounds';

export function createApp(deps: Deps) {
  const app = new Hono<App>();

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (deps.env.origins === '*') return origin || '*';
        // Echoed rather than listed, which is what the spec wants when more than one origin is
        // allowed — and returning the caller's own origin only when it is on the list is the
        // whole of the check.
        return deps.env.origins.includes(origin) ? origin : null;
      },
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      // 24 hours, so a browser stops asking before every request. Nothing here changes often
      // enough for a stale preflight to matter.
      maxAge: 86_400,
    }),
  );

  /**
   * Whether the server is up and which bank it is scoring against.
   *
   * The bank version is the useful half: a server holding a bank the site no longer serves will
   * refuse every round from an up-to-date client as `unknown-puzzle`, and this is where that is
   * visible before anybody reports it.
   */
  app.get('/health', (c) =>
    c.json({ ok: true, api: API_VERSION, bank: deps.bank.manifest.version }),
  );

  const v1 = new Hono<App>();
  v1.route('/players', playerRoutes());
  v1.route('/rounds', roundRoutes());
  v1.route('/puzzles', scoreRoutes());
  app.route(`/v${API_VERSION}`, v1);

  app.notFound((c) => refuse(c, 'malformed', 'no such route'));

  /**
   * Anything that got out.
   *
   * The client is told `server` and nothing else — a stack trace in a response body is a gift to
   * somebody reading it — and the whole error goes to the log, where the person who can act on
   * it is looking.
   */
  app.onError((error, c) => {
    console.error('unhandled:', error);
    return refuse(c, 'server');
  });

  return app;
}
