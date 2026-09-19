/**
 * What the client and the server say to each other, written down once.
 *
 * The game is offline-first and stays that way: there is no server in the ordinary case, and
 * nothing in `src/lib` above this module knows one can exist. What this adds is a *contract* —
 * the shapes that cross the wire and the total readers that check them — so that the two halves
 * cannot drift apart without the typechecker noticing.
 *
 * **Both sides import this file.** That is the whole point of it, and it is why it holds no
 * runtime dependency of its own: the client's dependency list is React, d3-force, driver.js and
 * react-intl, and a wire format that dragged a validation library into the bundle would have
 * bought its convenience with the one rule this project actually keeps. So the readers are
 * hand-written and total, in the same style as `readCompletion` in stats.ts — which is also the
 * style the server needs, because a body arriving from the network deserves rather more
 * suspicion than a string out of `localStorage`.
 *
 * **A round travels as its actions, not as a score.** `Action` is actions.ts's vocabulary, the
 * one the screen, the game and a shared link already share, and it is a full account of what
 * somebody did: which words were guessed, in order, from where, with which hints bought. The
 * server replays it against the real graph with `replayActions` and `restore` — the same two
 * functions a reload goes through — and derives the guesses, the hints and whether the round was
 * solved for itself. Nobody posts a number. A round the server cannot replay is a round it
 * refuses, and the rules are enforced in exactly one place because there is only one copy of
 * them.
 *
 * (Not the board code, which is the same round in a thirtieth of the space. That compression
 * exists because a URL is a place a human has to paste something; a request body is not, and
 * bit-packing a payload nobody has to read aloud buys nothing and costs legibility.)
 *
 * **What is deliberately not here.** No score, no par, no rank: every one of those is the
 * server's own finding, computed from the actions and from the bank it loaded, and a field a
 * client could fill in is a field a client can lie in. The responses carry them because by then
 * they have been worked out.
 */

import type { Action } from './actions';

/**
 * The version of the wire format, in the path: `/v{API_VERSION}/…`.
 *
 * In the URL rather than a header because the one thing it has to survive is a browser holding a
 * cached copy of an older client — a deployed static site is not updated in step with the server
 * it talks to, and two versions of this game will be live against one database on any day either
 * is deployed. An old client asking an old path is a thing a server can go on answering; an old
 * client asking a new path with old assumptions is not.
 */
export const API_VERSION = 1;

/* ----------------------------------------------------------------- who is playing */

/**
 * A player, as everybody else sees them.
 *
 * `name` is null for somebody who has not registered, and the screen says "anonymous" — a
 * translated word that belongs in the catalog, never in the data. The id is a UUID minted by the
 * server, and it is public: it travels in every scoreboard, which is exactly why it cannot also
 * be the credential. See `Session`.
 */
export interface Player {
  id: string;
  name: string | null;
}

/**
 * A player and the token that proves you are them.
 *
 * The token is the secret and the id is not. Anonymous play means the server mints both on
 * first contact and the client keeps them; registering binds a username and password to the
 * *same* row, so a history built up before anybody signed up is the history the account has
 * afterwards. That is the whole reason registration takes the caller's existing token.
 */
export interface Session extends Player {
  token: string;
}

/** What registering or logging in takes. No email, so no reset — the UI has to say so. */
export interface Credentials {
  username: string;
  password: string;
}

/**
 * What a username may be, checked identically at both ends.
 *
 * The client checks so it can say what is wrong before a request is made; the server checks
 * because the client's check is a courtesy and not a control. Same constants, one definition,
 * so the two cannot come to disagree about what is allowed.
 *
 * Case-sensitive and stored exactly as typed. The alternative — unique case-insensitively —
 * avoids two names that look alike sitting next to each other on a scoreboard, and it is the
 * kind of rule that is easier to add later than to take away.
 */
export const NAME_MIN = 3;
export const NAME_MAX = 20;
const NAME_OK = /^[A-Za-z0-9_-]+$/;

/** Long enough to be worth hashing. No composition rules: they make worse passwords. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export function nameProblem(name: string): 'short' | 'long' | 'characters' | null {
  if (name.length < NAME_MIN) return 'short';
  if (name.length > NAME_MAX) return 'long';
  return NAME_OK.test(name) ? null : 'characters';
}

export function passwordProblem(password: string): 'short' | 'long' | null {
  if (password.length < PASSWORD_MIN) return 'short';
  // Bounded because the hash is deliberately slow and its cost grows with what it is fed: an
  // unbounded password field is a way to make the server do arbitrary work for one request.
  return password.length > PASSWORD_MAX ? 'long' : null;
}

/* --------------------------------------------------------------- a round, travelling */

/**
 * How many actions a submission may hold.
 *
 * Not a rule about the game — a round can be as long as somebody's patience — but a bound on
 * what one request may cost to replay, and every unbounded list in a request body is a way to
 * spend the server's afternoon. Set far above any round anybody has played: a heavy round is a
 * few dozen actions, and the fuzz's longest walks are in the low hundreds.
 */
export const MAX_ACTIONS = 4000;

/** The most tokens one guess can have named. A spelling is several pronunciations, not many. */
const MAX_WORDS = 32;

/** A round as it is sent: which puzzle, and everything that happened on it, in order. */
export interface RoundSubmission {
  /** The puzzle's id, which is what the URL of the board is. */
  puzzle: string;
  actions: Action[];
}

/**
 * A round as the server describes it back: what it worked out by replaying the actions.
 *
 * Every number here was derived, never received. `par` and `bank` come from the bank the server
 * loaded — par is a taste knob and moves week to week while a puzzle's id does not, so the bank
 * version travels with the round rather than being assumed to be the reader's.
 */
export interface RoundView {
  puzzle: string;
  player: Player;
  guesses: number;
  hints: number;
  misses: number;
  solved: boolean;
  par: number;
  /** The version of the bank the score was computed against. See the note above. */
  bank: string;
  /** When the round was last written, as an ISO instant. */
  at: string;
}

/**
 * One line of a scoreboard.
 *
 * A `RoundView` without the puzzle repeated on every row, and without the bank — the board says
 * both once. Rank is 1-based and is the server's, computed over the whole table rather than over
 * the page that was sent, so the number beside a name means what it looks like it means.
 */
export interface Score {
  rank: number;
  player: Player;
  guesses: number;
  hints: number;
  at: string;
}

/**
 * The low score screen for one puzzle.
 *
 * `you` is the caller's own row **even when it is not in `scores`**, because a board you are not
 * on is a board about other people. Null when the caller has not solved this puzzle, or asked
 * without a token at all.
 */
export interface Scoreboard {
  puzzle: string;
  par: number;
  bank: string;
  /** How many solved rounds there are in total, which is what `rank` is out of. */
  players: number;
  scores: Score[];
  you: Score | null;
}

/* ------------------------------------------------------------------------- refusals */

/**
 * Why a request was refused, as a code rather than a sentence.
 *
 * The server does not know what language the player reads, and this repo has a rule about where
 * words live — `src/i18n/messages/`, and nowhere else. So the wire carries the fact and the
 * client says it. `message` rides along for a developer reading a response in a terminal and is
 * never shown to anybody.
 */
export type Refusal =
  /** The body was not the shape this endpoint takes. */
  | 'malformed'
  /** No token, or one that names nobody. */
  | 'unauthorized'
  /** That username is taken, or this player has already registered. */
  | 'taken'
  /** The username and password do not go together. */
  | 'credentials'
  /** The username or the password is not allowed — see `nameProblem`, `passwordProblem`. */
  | 'invalid'
  /** No puzzle of that id in the bank the server loaded. */
  | 'unknown-puzzle'
  /**
   * The actions do not replay on that puzzle.
   *
   * The interesting refusal: a move the graph does not have, a word that is not there. It is
   * also what an honest client gets when it is a bank behind, which is why it is its own code
   * rather than `malformed` — the two want different things said to the player.
   */
  | 'unplayable'
  /** Too many requests, too quickly. */
  | 'slow-down'
  /** The server is not well. Nothing the caller did. */
  | 'server';

export interface Refused {
  error: Refusal;
  /** Diagnostic, English, for a log or a terminal. Never rendered. */
  message?: string;
}

const REFUSALS = new Set<string>([
  'malformed',
  'unauthorized',
  'taken',
  'credentials',
  'invalid',
  'unknown-puzzle',
  'unplayable',
  'slow-down',
  'server',
]);

/** A refusal, or null if this is not one. Used by the client to read a failed response. */
export function readRefused(value: unknown): Refused | null {
  const raw = object(value);
  if (!raw) return null;
  const error = typeof raw.error === 'string' && REFUSALS.has(raw.error) ? raw.error : null;
  if (error === null) return null;
  return { error: error as Refusal };
}

/* -------------------------------------------------------------------- reading it all */

/**
 * The readers.
 *
 * Total, in the sense `readCompletion` is total: anything that is not what it should be comes
 * back null, and nothing throws. The server runs these over request bodies from the open
 * internet and the client runs them over responses, so both directions are checked by the same
 * code and neither end has to trust the other to have been careful.
 */

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, bounded. Every string on the wire is bounded; unbounded ones are a hole. */
function text(value: unknown, most: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= most ? value : null;
}

/** Hex, which is what an id and a bank version both are. */
const HEX = /^[0-9a-f]+$/;

/**
 * A puzzle id.
 *
 * Checked for shape here so that a nonsense id is `malformed` at the edge rather than a database
 * lookup, and so nothing downstream has to wonder whether an id is safe to put in a path or a
 * query. Ids are hex digits of a digest — see graphgen's id.rs — and the length is not pinned
 * because the digest could be truncated differently one day; the alphabet is the real check.
 */
export function readPuzzleId(value: unknown): string | null {
  const id = text(value, 64);
  return id !== null && HEX.test(id) ? id : null;
}

/** One token: a word of the graph, or a run of the alphabet. Bounded, and letters only. */
const TOKEN = /^[\x21-\x7e]{1,64}$/;

function token(value: unknown): string | null {
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

/**
 * A whole number in a range. Every count on the wire has an upper bound for the same reason
 * `MAX_ACTIONS` does: a hint level of two billion is not a hint, it is a loop.
 */
function count(value: unknown, most: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > most) {
    return null;
  }
  return value;
}

/**
 * One action.
 *
 * Mirrors the `Action` union in actions.ts, and the mirroring is on purpose: a variant added
 * there and not here arrives as `malformed`, which is a refused round rather than a round
 * silently missing what somebody did. `KINDS` in actions.ts is the list to check against when
 * adding one.
 */
export function readAction(value: unknown): Action | null {
  const raw = object(value);
  if (!raw) return null;
  switch (raw.do) {
    case 'guess': {
      if (!Array.isArray(raw.words) || raw.words.length === 0 || raw.words.length > MAX_WORDS) {
        return null;
      }
      const words: string[] = [];
      for (const one of raw.words) {
        const word = token(one);
        if (word === null) return null;
        words.push(word);
      }
      return { do: 'guess', words };
    }
    case 'stand': {
      const word = token(raw.word);
      return word === null ? null : { do: 'stand', word };
    }
    case 'hint': {
      const word = token(raw.word);
      // A level is letters of a word, so the word's own length is the ceiling `restore` clamps
      // to anyway. Bounded here at something no word reaches, to keep the loop finite.
      const levels = count(raw.levels, 64);
      return word === null || levels === null ? null : { do: 'hint', word, levels };
    }
    case 'mark': {
      const word = token(raw.word);
      const to = token(raw.to);
      return word === null || to === null ? null : { do: 'mark', word, to };
    }
    case 'miss': {
      const at = count(raw.count, 100_000);
      return at === null ? null : { do: 'miss', count: at };
    }
    case 'spent': {
      const levels = count(raw.levels, 100_000);
      return levels === null ? null : { do: 'spent', levels };
    }
    default:
      return null;
  }
}

/**
 * A whole series, or null.
 *
 * **One bad action refuses the round rather than being dropped.** That is the opposite of what
 * `restore` does with a move it cannot replay, and the difference is where the data came from: a
 * snapshot in `localStorage` is this player's own history and salvaging what is readable is
 * kindness, while a request body is a claim by a stranger about what they did, and a claim that
 * is partly nonsense should not be recorded as the part that parsed.
 */
export function readActions(value: unknown): Action[] | null {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) return null;
  const actions: Action[] = [];
  for (const one of value) {
    const action = readAction(one);
    if (action === null) return null;
    actions.push(action);
  }
  return actions;
}

export function readSubmission(value: unknown): RoundSubmission | null {
  const raw = object(value);
  if (!raw) return null;
  const puzzle = readPuzzleId(raw.puzzle);
  const actions = readActions(raw.actions);
  return puzzle === null || actions === null ? null : { puzzle, actions };
}

export function readCredentials(value: unknown): Credentials | null {
  const raw = object(value);
  if (!raw) return null;
  const username = text(raw.username, NAME_MAX);
  const password = text(raw.password, PASSWORD_MAX);
  return username === null || password === null ? null : { username, password };
}

/* ------------------------------------------------ reading what came back, on the client */

function readPlayer(value: unknown): Player | null {
  const raw = object(value);
  if (!raw) return null;
  const id = text(raw.id, 64);
  if (id === null) return null;
  return { id, name: typeof raw.name === 'string' ? raw.name : null };
}

export function readSession(value: unknown): Session | null {
  const player = readPlayer(value);
  const raw = object(value);
  const token = raw ? text(raw.token, 256) : null;
  return player === null || token === null ? null : { ...player, token };
}

function readScore(value: unknown): Score | null {
  const raw = object(value);
  if (!raw) return null;
  const player = readPlayer(raw.player);
  const rank = count(raw.rank, 100_000_000);
  const guesses = count(raw.guesses, 100_000);
  const hints = count(raw.hints, 100_000);
  const at = text(raw.at, 40);
  if (player === null || rank === null || guesses === null || hints === null || at === null) {
    return null;
  }
  return { rank, player, guesses, hints, at };
}

/**
 * A scoreboard, or null.
 *
 * A row that cannot be read is dropped and the board is still shown, which is the `readCompletions`
 * rule rather than the `readActions` one: this is a display, nothing is recorded from it, and a
 * scoreboard missing a line is better than a screen that refuses to draw.
 */
export function readScoreboard(value: unknown): Scoreboard | null {
  const raw = object(value);
  if (!raw) return null;
  const puzzle = readPuzzleId(raw.puzzle);
  const par = count(raw.par, 1000);
  if (puzzle === null || par === null) return null;
  const scores = Array.isArray(raw.scores)
    ? raw.scores.map(readScore).filter((one): one is Score => one !== null)
    : [];
  return {
    puzzle,
    par,
    bank: typeof raw.bank === 'string' ? raw.bank : '',
    players: count(raw.players, 100_000_000) ?? scores.length,
    scores,
    you: readScore(raw.you),
  };
}

export function readRoundView(value: unknown): RoundView | null {
  const raw = object(value);
  if (!raw) return null;
  const puzzle = readPuzzleId(raw.puzzle);
  const player = readPlayer(raw.player);
  const guesses = count(raw.guesses, 100_000);
  const hints = count(raw.hints, 100_000);
  const par = count(raw.par, 1000);
  const at = text(raw.at, 40);
  if (puzzle === null || player === null || guesses === null) return null;
  if (hints === null || par === null || at === null) return null;
  return {
    puzzle,
    player,
    guesses,
    hints,
    misses: count(raw.misses, 100_000) ?? 0,
    solved: raw.solved === true,
    par,
    bank: typeof raw.bank === 'string' ? raw.bank : '',
    at,
  };
}
