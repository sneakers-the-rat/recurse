/**
 * The board's end of the optional server: send what happened, and get the low score screen.
 *
 * Two jobs, one hook, because they are two halves of one exchange and both hang off the same
 * question — is there a server, and who is this browser to it.
 *
 * **Nothing here can hold the game up.** Every call in server.ts fails soft, this never throws,
 * and none of what it returns is on the path to drawing a board: the round is already safe in
 * `localStorage` before any of this runs. A build with no server set does no work at all —
 * `hasServer()` is false and every effect returns immediately, which is what keeps a downloaded
 * copy of the game exactly the game it was.
 *
 * **A round is sent as it is played, not only when it ends**, so a board carries on between a
 * phone and a laptop. Debounced, because a request per guess is a request per keystroke's worth
 * of thought: what is sent is the round as it stands a moment after the player stops. The server
 * refuses to go backwards (see `keepExisting`), so a late arrival from a stale tab cannot undo
 * anything — which is what makes a debounce safe rather than a race.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action } from './actions';
import { nameProblem, passwordProblem, type Scoreboard } from './api';
import {
  fetchScores,
  hasServer,
  login,
  mintPlayer,
  register,
  sendRound,
  type Why,
} from './server';
import { loadPlayer, savePlayer, type StoredPlayer } from './storage';

/** How long after the last move to send the round. Long enough that a flurry is one request. */
const SETTLE = 2500;

/**
 * Where the scoreboard has got to.
 *
 * `absent` is its own state and not an error: the server being unreachable is an ordinary thing
 * that should draw a quiet line rather than a warning, because nothing is wrong with the round.
 */
export type Standing =
  | { state: 'off' }
  | { state: 'waiting' }
  | { state: 'absent' }
  | { state: 'ready'; board: Scoreboard };

/**
 * The player this browser is, minting one if it has none.
 *
 * A module-level promise rather than a per-component one, because two boards mounting together
 * would otherwise ask for two players and the second would silently orphan the first's history.
 * Cleared on failure so a later attempt can still succeed.
 */
let minting: Promise<StoredPlayer | null> | null = null;

function player(): Promise<StoredPlayer | null> {
  const held = loadPlayer();
  if (held) return Promise.resolve(held);
  if (!hasServer()) return Promise.resolve(null);
  minting ??= mintPlayer()
    .then((session) => {
      if (!session) return null;
      const stored: StoredPlayer = { id: session.id, name: session.name, token: session.token };
      savePlayer(stored);
      return stored;
    })
    .finally(() => {
      minting = null;
    });
  return minting;
}

/** What a round looks like to this module: which puzzle, what was done, and whether it is over. */
export interface Playing {
  puzzle: string;
  actions: readonly Action[];
  solved: boolean;
}

export interface Served {
  standing: Standing;
  /** Who this browser is, or null before anything has been sent. */
  me: StoredPlayer | null;
  /** Take a name, or come back as one. Null on success; a reason otherwise. */
  signIn(
    kind: 'register' | 'login',
    credentials: { username: string; password: string },
  ): Promise<Why | 'invalid' | null>;
  /** Forget the token, which makes this browser a stranger again. */
  signOut(): void;
  /** Fetch the board again — after signing in, and after finishing. */
  refresh(): void;
}

export function useServer(round: Playing | null): Served {
  const [me, setMe] = useState<StoredPlayer | null>(() => loadPlayer());
  const [standing, setStanding] = useState<Standing>(() =>
    hasServer() ? { state: 'waiting' } : { state: 'off' },
  );
  const [asked, setAsked] = useState(0);

  /**
   * What has already been sent, so an unchanged round is not sent again.
   *
   * The count of actions is enough to tell one state of a round from the next: every action a
   * player takes appends one, and the only things that rewrite the series in place — a hint
   * level going up, the refusal tally — also change nothing anybody is waiting to see synced.
   */
  const sent = useRef<string>('');

  const puzzle = round?.puzzle ?? null;
  const count = round?.actions.length ?? 0;
  const solved = round?.solved ?? false;

  /* Sending the round. Debounced, and cancelled if the round moves on before it fires. */
  useEffect(() => {
    if (!hasServer() || !round || puzzle === null) return;
    const mark = `${puzzle}:${count}:${solved ? 1 : 0}`;
    if (mark === sent.current) return;

    // A finished round goes at once. Everything else waits for the player to stop: the
    // scoreboard is drawn from what was sent, and a wait between the last guess and the board
    // appearing is exactly the wrong moment to be saving a request.
    const wait = solved ? 0 : SETTLE;
    const actions = [...round.actions];
    let dropped = false;

    const timer = setTimeout(() => {
      void (async () => {
        const who = await player();
        if (dropped || !who) return;
        setMe(who);
        const view = await sendRound(puzzle, actions, who.token);
        if (dropped) return;
        sent.current = mark;
        // Only a finished round has a scoreboard to be on, and asking after sending is what
        // makes the player's own row already there when the panel appears.
        if (view?.solved) setAsked((n) => n + 1);
      })();
    }, wait);

    return () => {
      dropped = true;
      clearTimeout(timer);
    };
  }, [puzzle, count, solved, round]);

  /* Reading the scoreboard. Only for a finished round: there is nothing to show before one. */
  useEffect(() => {
    if (!hasServer()) {
      setStanding({ state: 'off' });
      return;
    }
    if (puzzle === null || !solved) return;

    let dropped = false;
    setStanding({ state: 'waiting' });
    void fetchScores(puzzle, loadPlayer()?.token ?? null).then((board) => {
      if (dropped) return;
      setStanding(board ? { state: 'ready', board } : { state: 'absent' });
    });

    return () => {
      dropped = true;
    };
  }, [puzzle, solved, asked]);

  const refresh = useCallback(() => setAsked((n) => n + 1), []);

  const signIn = useCallback<Served['signIn']>(async (kind, credentials) => {
    // Checked here as well as at the server, from the same constants, so somebody who typed a
    // two-letter name is told so without a round trip. The server's check is the rule; this is
    // the courtesy.
    if (nameProblem(credentials.username) !== null) return 'invalid';
    if (passwordProblem(credentials.password) !== null) return 'invalid';

    const held = loadPlayer();
    const done =
      kind === 'login'
        ? await login(credentials)
        : await register(credentials, held?.token ?? null);
    if (!done.ok) return done.why;

    const stored: StoredPlayer = {
      id: done.session.id,
      name: done.session.name,
      token: done.session.token,
    };
    savePlayer(stored);
    setMe(stored);
    // Logging in can make this browser a different player, so what was sent under the old token
    // says nothing about what this one has. The next render sends the round again, which the
    // server takes or keeps as its own rules decide.
    sent.current = '';
    setAsked((n) => n + 1);
    return null;
  }, []);

  const signOut = useCallback(() => {
    savePlayer(null);
    setMe(null);
    sent.current = '';
    setAsked((n) => n + 1);
  }, []);

  return { standing, me, signIn, signOut, refresh };
}
