/**
 * The server, end to end, over rounds somebody could actually have played.
 *
 * `playRound` is the repo's simulated player — it draws commands from `offers` and does them
 * with `act`, so what comes out is a round the game itself produced rather than a list of moves
 * written out by hand. That is what makes the scoring claim testable: the actions submitted here
 * are the actions a browser would have sent, and the score the server computes has a right
 * answer to be checked against, namely the `GameState` the simulated player ended on.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { actionsOf } from '../../src/lib/actions';
import { snapshot, type GameState } from '../../src/lib/game';
import type { Puzzle } from '../../src/lib/types';
import { playRound, SHAPES } from '../../src/test/rounds';
import { shippedData } from '../../src/test/shipped';
import { harness, shippedBankOf, type Harness } from './helpers';

const { bank, puzzles } = shippedBankOf();
const graph = shippedData().graph;

/** A board with room to wander on it, so `heavy` has somewhere to go. */
const board = puzzles.find((one) => one.par >= 3) ?? puzzles[0]!;

function round(puzzle: Puzzle, shape: keyof typeof SHAPES, seed = 7): GameState {
  return playRound(puzzle, { graph }, SHAPES[shape], seed).state;
}

function submission(state: GameState, puzzle: Puzzle) {
  return { actions: actionsOf(snapshot(state), puzzle) };
}

let app: Harness;
beforeAll(() => {
  app = harness(bank);
});
afterAll(() => app.close());

/** Somebody with a token, which is the first thing every other test needs. */
async function newPlayer() {
  const made = await app.call('/v1/players', { method: 'POST' });
  expect(made.status).toBe(201);
  return made.body as { id: string; name: string | null; token: string };
}

describe('minting a player', () => {
  it('gives a uuid and a token, and no name', async () => {
    const player = await newPlayer();
    expect(player.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(player.name).toBeNull();
    expect(player.token.length).toBeGreaterThan(20);
  });

  it('knows who a token names', async () => {
    const player = await newPlayer();
    const me = await app.call('/v1/players/me', { token: player.token });
    expect(me.body).toEqual({ id: player.id, name: null });
  });

  it('refuses a token that names nobody', async () => {
    const me = await app.call('/v1/players/me', { token: 'not-a-token' });
    expect(me.status).toBe(401);
    expect(me.body.error).toBe('unauthorized');
  });
});

describe('submitting a round', () => {
  it('scores it by replaying it, and agrees with the game', async () => {
    const player = await newPlayer();
    const state = round(board, 'ordinary');
    const sent = await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: submission(state, board),
    });

    expect(sent.status).toBe(201);
    // The whole claim: the server worked these out for itself and got what the game got.
    expect(sent.body.guesses).toBe(state.guesses);
    expect(sent.body.misses).toBe(state.misses);
    expect(sent.body.solved).toBe(state.solved);
    expect(sent.body.par).toBe(board.par);
  });

  it('takes no score from the client, whatever it sends', async () => {
    const player = await newPlayer();
    const state = round(board, 'ordinary');
    const sent = await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      // A client claiming a perfect round, with the real actions underneath it.
      body: { ...submission(state, board), guesses: 1, hints: 0, solved: true, par: 99 },
    });
    expect(sent.body.guesses).toBe(state.guesses);
    expect(sent.body.par).toBe(board.par);
  });

  it('refuses a round that does not replay', async () => {
    const player = await newPlayer();
    const state = round(board, 'tidy');
    const actions = actionsOf(snapshot(state), board);
    // One invented guess. `replayActions` would quietly drop it — this is the check that says
    // dropping it is an error rather than a smaller score.
    actions.push({ do: 'guess', words: ['zzzzzzzz'] });

    const sent = await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: { actions },
    });
    expect(sent.status).toBe(422);
    expect(sent.body.error).toBe('unplayable');
  });

  it('refuses a puzzle this bank has not got', async () => {
    const player = await newPlayer();
    const sent = await app.call('/v1/rounds/deadbeefdeadbeef', {
      method: 'PUT',
      token: player.token,
      body: { actions: [] },
    });
    expect(sent.status).toBe(404);
    expect(sent.body.error).toBe('unknown-puzzle');
  });

  it('wants a token', async () => {
    const sent = await app.call(`/v1/rounds/${board.id}`, { method: 'PUT', body: { actions: [] } });
    expect(sent.status).toBe(401);
  });
});

describe('a round in progress', () => {
  it('is replaced by one further along', async () => {
    const player = await newPlayer();
    const part = round(board, 'unfinished');
    const whole = round(board, 'ordinary');

    await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: submission(part, board),
    });
    const after = await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: submission(whole, board),
    });

    expect(after.status).toBe(200);
    expect(after.body.solved).toBe(true);
    expect(after.body.guesses).toBe(whole.guesses);
  });

  it('is not rolled back by a stale device', async () => {
    const player = await newPlayer();
    const whole = round(board, 'ordinary');
    const part = round(board, 'unfinished');

    await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: submission(whole, board),
    });
    // A tab that was open before any of that, submitting what it still thinks is true.
    const stale = await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: submission(part, board),
    });

    // What comes back is what is *stored*, so the client finds out by reading it.
    expect(stale.body.solved).toBe(true);
    expect(stale.body.guesses).toBe(whole.guesses);
  });

  it('keeps one row per player per puzzle', async () => {
    const player = await newPlayer();
    const state = round(board, 'tidy');
    for (let n = 0; n < 3; n++) {
      await app.call(`/v1/rounds/${board.id}`, {
        method: 'PUT',
        token: player.token,
        body: submission(state, board),
      });
    }
    const mine = await app.call('/v1/rounds', { token: player.token });
    expect(mine.body.rounds).toHaveLength(1);
  });
});

describe('the low score screen', () => {
  it('ranks fewest guesses first, and hints break the tie', async () => {
    const fresh = harness(bank);
    try {
      const tidy = await (async () => {
        const player = await (async () => {
          const made = await fresh.call('/v1/players', { method: 'POST' });
          return made.body as { token: string; id: string };
        })();
        const state = round(board, 'tidy', 11);
        await fresh.call(`/v1/rounds/${board.id}`, {
          method: 'PUT',
          token: player.token,
          body: submission(state, board),
        });
        return { player, state };
      })();

      const heavy = await (async () => {
        const made = await fresh.call('/v1/players', { method: 'POST' });
        const player = made.body as { token: string; id: string };
        const state = round(board, 'heavy', 23);
        await fresh.call(`/v1/rounds/${board.id}`, {
          method: 'PUT',
          token: player.token,
          body: submission(state, board),
        });
        return { player, state };
      })();

      const shown = await fresh.call(`/v1/puzzles/${board.id}/scores`);
      expect(shown.status).toBe(200);
      expect(shown.body.par).toBe(board.par);
      expect(shown.body.players).toBe(2);

      const [first, second] = shown.body.scores;
      expect(first.rank).toBe(1);
      expect(second.rank).toBe(2);
      // The tidy round took fewer guesses, so it leads however many hints the other one bought.
      expect(tidy.state.guesses).toBeLessThanOrEqual(heavy.state.guesses);
      expect(first.guesses).toBeLessThanOrEqual(second.guesses);
      // Nobody has registered, so every row is anonymous — a null name, never the word, which
      // belongs in the message catalog.
      expect(first.player.name).toBeNull();
    } finally {
      fresh.close();
    }
  });

  it('is readable without a token, and says nothing about you', async () => {
    const shown = await app.call(`/v1/puzzles/${board.id}/scores`);
    expect(shown.status).toBe(200);
    expect(shown.body.you).toBeNull();
  });

  it('points at your own row even when it is off the end', async () => {
    const fresh = harness(bank);
    try {
      // Three quick rounds, then one heavy one, asking for a board of two.
      let mine = '';
      for (const [at, shape] of (['tidy', 'tidy', 'tidy', 'heavy'] as const).entries()) {
        const made = await fresh.call('/v1/players', { method: 'POST' });
        const player = made.body as { token: string };
        const state = round(board, shape, 3 + at);
        await fresh.call(`/v1/rounds/${board.id}`, {
          method: 'PUT',
          token: player.token,
          body: submission(state, board),
        });
        mine = player.token;
      }

      const shown = await fresh.call(`/v1/puzzles/${board.id}/scores?limit=2`, { token: mine });
      expect(shown.body.scores).toHaveLength(2);
      expect(shown.body.players).toBe(4);
      expect(shown.body.you).not.toBeNull();
      expect(shown.body.you.rank).toBeGreaterThanOrEqual(1);
    } finally {
      fresh.close();
    }
  });

  it('shows an unplayed puzzle as an empty board rather than a 404', async () => {
    const other = puzzles.find((one) => one.id !== board.id)!;
    const shown = await app.call(`/v1/puzzles/${other.id}/scores`);
    expect(shown.status).toBe(200);
    expect(shown.body.scores).toEqual([]);
    expect(shown.body.players).toBe(0);
  });

  it('leaves an unfinished round off it', async () => {
    const fresh = harness(bank);
    try {
      const made = await fresh.call('/v1/players', { method: 'POST' });
      const player = made.body as { token: string };
      await fresh.call(`/v1/rounds/${board.id}`, {
        method: 'PUT',
        token: player.token,
        body: submission(round(board, 'unfinished'), board),
      });
      const shown = await fresh.call(`/v1/puzzles/${board.id}/scores`);
      expect(shown.body.scores).toEqual([]);
    } finally {
      fresh.close();
    }
  });
});

describe('registering', () => {
  it('keeps the history the player already had', async () => {
    const player = await newPlayer();
    await app.call(`/v1/rounds/${board.id}`, {
      method: 'PUT',
      token: player.token,
      body: submission(round(board, 'tidy'), board),
    });

    const signed = await app.call('/v1/players/register', {
      method: 'POST',
      token: player.token,
      body: { username: 'jonny', password: 'a good long password' },
    });
    expect(signed.status).toBe(200);
    // The same player, named. That is what makes the history theirs without copying anything.
    expect(signed.body.id).toBe(player.id);
    expect(signed.body.name).toBe('jonny');

    const mine = await app.call('/v1/rounds', { token: signed.body.token });
    expect(mine.body.rounds).toHaveLength(1);
  });

  it('puts the name on the scoreboard', async () => {
    const shown = await app.call(`/v1/puzzles/${board.id}/scores`);
    expect(shown.body.scores.some((one: { player: { name: string } }) => one.player.name === 'jonny')).toBe(true);
  });

  it('refuses a name somebody has', async () => {
    const player = await newPlayer();
    const again = await app.call('/v1/players/register', {
      method: 'POST',
      token: player.token,
      body: { username: 'jonny', password: 'another good password' },
    });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('taken');
  });

  it('refuses a second registration from one player', async () => {
    const player = await newPlayer();
    await app.call('/v1/players/register', {
      method: 'POST',
      token: player.token,
      body: { username: 'once', password: 'a good long password' },
    });
    const twice = await app.call('/v1/players/register', {
      method: 'POST',
      token: player.token,
      body: { username: 'twice', password: 'a good long password' },
    });
    expect(twice.status).toBe(409);
  });

  it('refuses a name or a password the rules do not allow', async () => {
    const player = await newPlayer();
    for (const body of [
      { username: 'no', password: 'a good long password' },
      { username: 'spaces here', password: 'a good long password' },
      { username: 'fine-name', password: 'short' },
    ]) {
      const sent = await app.call('/v1/players/register', {
        method: 'POST',
        token: player.token,
        body,
      });
      expect(sent.status).toBe(422);
      expect(sent.body.error).toBe('invalid');
    }
  });

  it('works without a token, for somebody who has not played yet', async () => {
    const signed = await app.call('/v1/players/register', {
      method: 'POST',
      body: { username: 'fresh-face', password: 'a good long password' },
    });
    expect(signed.status).toBe(201);
    expect(signed.body.name).toBe('fresh-face');
  });
});

/**
 * Its own harness, because logging in is rate-limited by design.
 *
 * `RATES.auth` is ten attempts a quarter of an hour, which is the right number for a login
 * endpoint and far too few to share with a whole file's worth of registrations. A test that
 * borrowed the harness above found that out by being refused, which is the limiter working —
 * but a test whose subject is "what does a wrong password say" should not be answering that
 * question about the bucket.
 */
describe('logging in', () => {
  let here: Harness;
  const account = { username: 'jonny', password: 'a good long password' };

  beforeAll(async () => {
    here = harness(bank);
    await here.call('/v1/players/register', { method: 'POST', body: account });
  });
  afterAll(() => here.close());

  it('gives a token for the account', async () => {
    const back = await here.call('/v1/players/login', { method: 'POST', body: account });
    expect(back.status).toBe(200);
    expect(back.body.name).toBe('jonny');

    const me = await here.call('/v1/players/me', { token: back.body.token });
    expect(me.body.name).toBe('jonny');
  });

  it('refuses a wrong password, and says the same thing about a name nobody has', async () => {
    const wrong = await here.call('/v1/players/login', {
      method: 'POST',
      body: { ...account, password: 'not the password' },
    });
    const nobody = await here.call('/v1/players/login', {
      method: 'POST',
      body: { username: 'nobody-at-all', password: 'not the password' },
    });
    expect(wrong.status).toBe(401);
    // The same refusal either way, so the response cannot be read as "that name exists".
    expect(wrong.body).toEqual(nobody.body);
  });

  it('leaves the other tokens working', async () => {
    const made = await here.call('/v1/players', { method: 'POST' });
    const player = made.body as { token: string };
    await here.call('/v1/players/register', {
      method: 'POST',
      token: player.token,
      body: { username: 'two-devices', password: 'a good long password' },
    });
    await here.call('/v1/players/login', {
      method: 'POST',
      body: { username: 'two-devices', password: 'a good long password' },
    });
    // The token that registered still names the player: signing in elsewhere is not a reason to
    // throw somebody out of the browser they are sitting in front of.
    const me = await here.call('/v1/players/me', { token: player.token });
    expect(me.status).toBe(200);
  });
});

describe('rate limits', () => {
  it('refuses once the bucket is empty, and refills', async () => {
    const tight = harness(bank, {
      rates: {
        mint: { burst: 2, per: 60_000 },
        auth: { burst: 2, per: 60_000 },
        write: { burst: 2, per: 60_000 },
        read: { burst: 2, per: 60_000 },
      },
    });
    try {
      expect((await tight.call('/v1/players', { method: 'POST' })).status).toBe(201);
      expect((await tight.call('/v1/players', { method: 'POST' })).status).toBe(201);
      const refused = await tight.call('/v1/players', { method: 'POST' });
      expect(refused.status).toBe(429);
      expect(refused.body.error).toBe('slow-down');

      // Half the window back is one token back.
      tight.tick(30_000);
      expect((await tight.call('/v1/players', { method: 'POST' })).status).toBe(201);
    } finally {
      tight.close();
    }
  });

  it('counts each kind of request separately', async () => {
    const tight = harness(bank, {
      rates: {
        mint: { burst: 1, per: 60_000 },
        auth: { burst: 1, per: 60_000 },
        write: { burst: 5, per: 60_000 },
        read: { burst: 5, per: 60_000 },
      },
    });
    try {
      await tight.call('/v1/players', { method: 'POST' });
      expect((await tight.call('/v1/players', { method: 'POST' })).status).toBe(429);
      // Reading a scoreboard was never going to be the thing that ran out.
      expect((await tight.call(`/v1/puzzles/${board.id}/scores`)).status).toBe(200);
    } finally {
      tight.close();
    }
  });
});

describe('the edges', () => {
  it('says which bank it is scoring against', async () => {
    const health = await app.call('/health');
    expect(health.body.ok).toBe(true);
    expect(health.body.bank).toBe(bank.manifest.version);
  });

  it('refuses a body that is not a series of actions', async () => {
    const player = await newPlayer();
    for (const body of [{}, { actions: 'nope' }, { actions: [{ do: 'fly' }] }]) {
      const sent = await app.call(`/v1/rounds/${board.id}`, {
        method: 'PUT',
        token: player.token,
        body,
      });
      expect(sent.status).toBe(400);
    }
  });

  it('refuses an id that is not one', async () => {
    const shown = await app.call('/v1/puzzles/not-hex/scores');
    expect(shown.status).toBe(400);
  });

  it('has no route it does not have', async () => {
    const sent = await app.call('/v1/nonsense');
    expect(sent.status).toBe(400);
  });
});
