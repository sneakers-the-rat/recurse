/**
 * The optional server, and how to talk to it.
 *
 * **The game is offline-first and this module is what keeps that true.** Everything here is
 * behind one question — is there a server at all — and the answer is a build-time setting that
 * is empty by default. With nothing set, `serverAt()` is null, every call below returns null
 * without touching the network, and the game is byte-for-byte the game it was: a copy somebody
 * downloaded, changed, and is playing on a plane behaves exactly as the deployed one does minus
 * a panel. Nothing above this module may assume otherwise.
 *
 * **Everything fails soft, and that is the rule rather than a courtesy.** Not one function here
 * throws or rejects: a server that is down, slow, unreachable or talking nonsense comes back as
 * null, and the screen draws what it drew before there was a server. This is the same rule
 * storage.ts keeps about `localStorage` — a round must never be lost, or blocked, or turned into
 * an error page, because something outside the game did not work. The player finished their
 * puzzle; that is the part that matters and it has already happened locally.
 *
 * **It sends what was done, never what it scored.** A submission is a series of `Action`s, the
 * vocabulary actions.ts owns, and the server replays it and works the numbers out for itself.
 * There is nowhere in the wire format to put a score, which is deliberate — see api.ts.
 */

import {
  API_VERSION,
  readRefused,
  readRoundView,
  readScoreboard,
  readSession,
  type Refusal,
  type RoundView,
  type Scoreboard,
  type Session,
} from './api';
import type { Action } from './actions';

/**
 * Where the server is, or null if this build has none.
 *
 * Read through `import.meta.env?.` rather than at module scope, for the reason data.ts's `get`
 * gives: everything in `src/lib` has to survive being imported in plain node by the unit tests
 * and the Playwright fixtures, and a top-level `import.meta.env.X` is a crash on load in a
 * module those never call.
 *
 * A trailing slash is trimmed so that the rest of this file can write `${base}/v1/…` and the one
 * place a deployment gets to choose is the origin.
 */
export function serverAt(): string | null {
  const set = import.meta.env?.VITE_RECURSE_API?.trim();
  return set ? set.replace(/\/$/, '') : null;
}

/** Is there a server? What every caller asks before it draws anything server-shaped. */
export function hasServer(): boolean {
  return serverAt() !== null;
}

/**
 * How long to wait before giving up on the server.
 *
 * Short, because nothing here is on the path to anything: a scoreboard that has not arrived in
 * five seconds is a scoreboard the player has stopped waiting for, and the round is already
 * safe on their own device.
 */
const TIMEOUT = 5000;

/** What a call came to. `null` means it did not happen, for any reason at all. */
type Answer<T> = Promise<T | null>;

/**
 * One request, with every way it can go wrong flattened into null.
 *
 * `refusal` is handed back separately by the callers that have something to say about one — a
 * name being taken is worth a sentence, where a server being asleep is not.
 */
async function ask(
  path: string,
  init: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<{ ok: boolean; status: number; body: unknown } | null> {
  const base = serverAt();
  if (base === null) return null;

  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  try {
    const res = await fetch(`${base}/v${API_VERSION}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
  } catch {
    // Offline, blocked, timed out, CORS, or a body that is not JSON. All one thing from here.
    return null;
  }
}

/** Why a call was refused, when the caller has something to say about it. */
export type Why = Refusal | 'offline';

function why(answer: Awaited<ReturnType<typeof ask>>): Why {
  if (answer === null) return 'offline';
  return readRefused(answer.body)?.error ?? 'server';
}

/* ------------------------------------------------------------------ who is playing */

/**
 * Ask for a player id.
 *
 * Called once per browser, the first time there is anything to record. The token that comes
 * back is the secret and the id is not — see api.ts — so both are kept, and only the token is
 * ever sent.
 */
export async function mintPlayer(): Answer<Session> {
  const answer = await ask('/players', { method: 'POST' });
  return answer?.ok ? readSession(answer.body) : null;
}

/** Who the server thinks this token is, or null if it thinks nobody. */
export async function whoAmI(token: string): Answer<{ id: string; name: string | null }> {
  const answer = await ask('/players/me', { token });
  if (!answer?.ok) return null;
  const read = readSession({ ...(answer.body as object), token });
  return read ? { id: read.id, name: read.name } : null;
}

export type SignIn = { ok: true; session: Session } | { ok: false; why: Why };

/**
 * Take a name and a password for the player already playing here.
 *
 * The caller's token goes with it, which is the whole of how an anonymous history becomes an
 * account's: the server names the row that token points at rather than making a new one.
 */
export async function register(
  credentials: { username: string; password: string },
  token: string | null,
): Promise<SignIn> {
  const answer = await ask('/players/register', { method: 'POST', body: credentials, token });
  const session = answer?.ok ? readSession(answer.body) : null;
  return session ? { ok: true, session } : { ok: false, why: why(answer) };
}

export async function login(credentials: {
  username: string;
  password: string;
}): Promise<SignIn> {
  const answer = await ask('/players/login', { method: 'POST', body: credentials });
  const session = answer?.ok ? readSession(answer.body) : null;
  return session ? { ok: true, session } : { ok: false, why: why(answer) };
}

/* ----------------------------------------------------------------------- rounds */

/**
 * Send a round, finished or not.
 *
 * `PUT`, because there is one round per player per puzzle and sending the same one twice must
 * mean what sending it once meant. What comes back is the round as *stored*, which is not
 * always the round that was sent: the server keeps a finished round over a later one, and keeps
 * whichever unfinished round is further along. Both are the local store's own rules — see
 * `addCompletion` and `keepExisting` — so a caller that simply believes the answer is right.
 */
export async function sendRound(
  puzzle: string,
  actions: readonly Action[],
  token: string,
): Answer<RoundView> {
  const answer = await ask(`/rounds/${puzzle}`, {
    method: 'PUT',
    body: { actions },
    token,
  });
  return answer?.ok ? readRoundView(answer.body) : null;
}

/**
 * The low score screen for one puzzle.
 *
 * The token is optional and adds one thing — the caller's own row, wherever it is on the board.
 * Without one this is still the right screen to draw, which is what lets somebody who has never
 * registered see where their round landed.
 */
export async function fetchScores(
  puzzle: string,
  token: string | null,
  limit?: number,
): Answer<Scoreboard> {
  const query = limit === undefined ? '' : `?limit=${limit}`;
  const answer = await ask(`/puzzles/${puzzle}/scores${query}`, { token });
  return answer?.ok ? readScoreboard(answer.body) : null;
}
