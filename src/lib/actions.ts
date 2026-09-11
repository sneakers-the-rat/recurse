/**
 * What a player *does*, as one vocabulary shared by the screen, the game and a shared link.
 *
 * There are two words here and the difference between them is the whole module:
 *
 *   **`Command`** is a thing somebody did — typed a word, tapped a word, clicked a dot. It is
 *   what the UI hands over and what a test hands over, and it says nothing about what happened
 *   as a result. `act` is the one way to do one.
 *
 *   **`Action`** is what the game *recorded*: the tokens a typed word turned out to name, how
 *   far a word has been hinted all told, which move was marked. It is what a code in a URL
 *   holds, in order, and `boardCode.ts` only says how each one is written down in bits.
 *
 * They correspond one to one except where the game deliberately remembers less than happened,
 * and those places are worth knowing because they are the same three places every consumer
 * trips over:
 *
 *   - **A typed word can name several tokens.** One `guess` command, one `guess` action, and
 *     `words` has more than one entry — a spelling can be two pronunciations and every one that
 *     plays is played, as one guess. See `also` on `Judgement`.
 *   - **Hints collapse.** Five clicks on one word is one fact — that word is five letters in —
 *     so five commands become one action with `levels: 5`.
 *   - **A refused guess is not remembered as a word.** `GameState` keeps a tally and not the
 *     words, so a run of refusals is one `miss` action carrying the count. There is no `miss`
 *     command: it is what a `guess` command comes to when the judge says no.
 *
 * **The state is still the source of truth, and the series is a view of it.** `actionsOf` reads
 * a snapshot and says what series would rebuild it; `replayActions` goes the other way. Nothing
 * is stored as actions — `GameSnapshot` is unchanged, so no saved game had to be thrown away for
 * this. A `GameState` that kept its action log instead of deriving one is the tidier thing and
 * a much larger change: it touches storage, the plate, the stats and the tutorial. The seam is
 * here for when that is worth doing.
 *
 * **`offers` is what makes a fuzz possible.** It answers "what could be done next, of this
 * kind" for every kind there is, so a test can walk a board by drawing from the whole
 * vocabulary rather than from a list somebody wrote out — and a kind added here joins the fuzz
 * without anybody remembering to add it. `src/test/rounds.ts` is the player that does the
 * drawing, and `boardCode.test.ts` is what checks that whatever it does survives a URL.
 */

import {
  applyGuess,
  edgeKey,
  hintLevels,
  moveKey,
  newGuess,
  select,
  useHint,
  useMoveHint,
  type Drawn,
  type GameSnapshot,
  type GameState,
  type LogEntry,
} from "./game";
import { PLAIN, type Lexicon } from "./lexicon";
import type { Graph, Judgement, Puzzle } from "./types";

/** The graph a round is played on and how its tokens are written: everything `act` needs. */
export interface World {
  graph: Graph;
  lexicon?: Lexicon;
  /** What the board is drawing, for deciding where an ambiguous guess lands. See `Drawn`. */
  drawn?: Drawn | null;
}

/** Something a player did. One per thing the screen offers. */
export type Command =
  /** Typed a word and pressed guess. `typed` is a spelling, which is what a player has. */
  | { do: "guess"; typed: string }
  /** Tapped a word already reached, or the goal, to guess from there next. */
  | { do: "stand"; word: string }
  /** Clicked an unnamed word for one more letter. */
  | { do: "hint"; word: string }
  /** Clicked a word on the answer for the shape of one of its moves. */
  | { do: "mark"; word: string; to: string };

/**
 * Something the game recorded. **This is what a code in a URL holds**, in order.
 *
 * In tokens, not spellings: a token is a node of the graph and can be pointed at by position,
 * which is what keeps a code short — see boardCode.ts. What was typed is not recoverable and
 * is not wanted.
 */
export type Action =
  /** A guess, and every token it played. The first is the one the cursor ended up on. */
  | { do: "guess"; words: readonly string[] }
  | { do: "stand"; word: string }
  /** One word and how far it has been hinted all told, rather than one entry per click. */
  | { do: "hint"; word: string; levels: number }
  | { do: "mark"; word: string; to: string }
  /** How many guesses the game refused. Not about any word. */
  | { do: "miss"; count: number }
  /**
   * Hint levels bought on words the round went on to name, as one total.
   *
   * **Not something a player did, and never produced by `actionsOf`.** A game played here
   * remembers every hint against its own word; this is what a *shared link* carries instead,
   * because the figure shows nothing for a hint on a word it is now spelling out in full and a
   * code that named those words anyway was paying for something invisible. The tally is the
   * one thing that would notice, and this is what keeps it whole.
   *
   * So it is the seam for a fuller format rather than a fact about the game: `written` in
   * boardCode.ts decides what to drop, and a variant that dropped nothing would simply never
   * emit one. See `GameState.spentHints`.
   */
  | { do: "spent"; levels: number };

/**
 * The two endpoints, in the order everything counts positions from: sorted.
 *
 * **A puzzle is undirected and its address says so**, so the series has to as well. A move is
 * an insertion or a removal and the two are inverses, so `carts → heartens` is the same puzzle
 * as `heartens → carts` — and which of them the builder writes as `source` is a finding of the
 * rules, which moves when a rule moves. A puzzle id is a digest of the *sorted* pair (see
 * id.rs), so a `stand` counts from the sorted pair too; otherwise a rebuild that flipped the
 * two ends would leave the address alone and change what every code means.
 *
 * The consequence to know: a round that begins at the end which sorts second opens with an
 * explicit `stand`, because "the player starts on the source" is then a fact the series has to
 * carry rather than one both ends can assume.
 */
export function endpoints(puzzle: Puzzle): [string, string] {
  const { source, target } = puzzle;
  return source <= target ? [source, target] : [target, source];
}

/** Every kind of action there is, so anything walking the vocabulary can be complete. */
export const KINDS: readonly Action["do"][] = [
  "guess",
  "stand",
  "hint",
  "mark",
  "miss",
  "spent",
];

/** Every kind of command there is. `miss` is missing on purpose — see the header. */
export const COMMANDS: readonly Command["do"][] = [
  "guess",
  "stand",
  "hint",
  "mark",
];

/** What `act` did, for a caller that has something to say about it. */
export interface Done {
  state: GameState;
  /** The verdict on a typed word, when the command was a guess. */
  judgement?: Extract<Judgement, { ok: false }> | undefined;
  /** The token the cursor ended up on, when a guess moved it. */
  landed?: string | undefined;
  /** Whether anything changed. A tap on where you already are, a hint on a spent word. */
  moved: boolean;
}

/**
 * Do one thing to a game.
 *
 * The one entry point, so that what the screen does and what a test does are the same code
 * path. Every branch here is a call into game.ts, which still owns the rules; what this adds
 * is that there is one door.
 */
export function act(state: GameState, world: World, command: Command): Done {
  const { graph, lexicon = PLAIN, drawn = null } = world;
  switch (command.do) {
    case "guess": {
      const out = applyGuess(
        state,
        graph,
        command.typed,
        graph.isWord,
        lexicon,
        drawn,
      );
      return {
        state: out.state,
        judgement: out.kind === "rejected" ? out.judgement : undefined,
        landed: out.kind === "rejected" ? undefined : out.word,
        moved: out.kind === "revealed",
      };
    }
    case "stand": {
      const next = select(state, command.word);
      return { state: next, moved: next !== state };
    }
    case "hint": {
      const next = useHint(state, command.word, lexicon.label);
      return { state: next, moved: next !== state };
    }
    case "mark": {
      // The one edge the command names, rather than "the next unbought one": an action has to
      // say which move it bought, because that is what gets written down and read back.
      const next = useMoveHint(state, command.word, [command.to]);
      return { state: next, moved: next !== state };
    }
  }
}

/**
 * What could be done next, of this kind: every command of that kind this board would accept.
 *
 * Complete rather than clever — the point is that a caller can draw from it without knowing
 * anything about the kind it asked for. Two of the lists take a view of what is *drawn*,
 * because hinting is about words on the figure and the figure grows: `drawn` defaults to the
 * words the puzzle declares plus wherever the player has got to, which is what a board holds
 * before it grows.
 *
 * A guess is offered as a *spelling*, because that is what a player types — so in a translated
 * alphabet the offers are the words on the screen and the ambiguity is real. Words that would
 * be refused are not offered; a fuzz that wants a refusal types nonsense of its own, which is
 * the honest way to get one.
 */
export function offers(
  state: GameState,
  world: World,
  kind: Command["do"],
  drawn?: ReadonlySet<string>,
): Command[] {
  const { graph, lexicon = PLAIN } = world;
  const { puzzle } = state;
  const figure =
    drawn ??
    new Set([...puzzle.board, ...state.revealed.keys(), puzzle.target]);
  /** Somewhere to stand: everywhere reached, and the goal. */
  const fronts = () => [...state.revealed.keys(), puzzle.target];
  /** A word on the figure nobody is standing on: what a hint or a mark is for. */
  const unnamed = () =>
    [...figure].filter(
      (word) =>
        !state.revealed.has(word) &&
        word !== puzzle.target &&
        word !== puzzle.source,
    );

  switch (kind) {
    case "guess":
      // Every legal move from where the player is standing, written the way they would type
      // it. Deduped, since two tokens can share a spelling and typing it once plays both.
      return [
        ...new Set(
          graph.neighbors(state.selected).map((token) => lexicon.label(token)),
        ),
      ].map((typed) => ({ do: "guess", typed }));
    case "stand":
      return fronts()
        .filter((word) => word !== state.selected)
        .map((word) => ({ do: "stand", word }));
    case "hint":
      return unnamed()
        .filter(
          (word) =>
            (state.hints.get(word) ?? 0) < hintLevels(word, lexicon.label),
        )
        .map((word) => ({ do: "hint", word }));
    case "mark":
      return unnamed().flatMap((word) =>
        graph
          .commonNeighbors(word)
          .filter(
            (to) =>
              !state.edgeHints.has(moveKey(word, to)) &&
              !state.edgeHints.has(moveKey(to, word)),
          )
          .map((to) => ({ do: "mark", word, to }) as Command),
      );
  }
}

/**
 * A game as the series of actions that would rebuild it.
 *
 * **Takes the snapshot**, not the live game: the snapshot is the form a board is written down
 * in — see `GameSnapshot` — so this is the translation between the two ways a round can be
 * stored, and neither of them is derived from the other twice. A caller holding a `GameState`
 * has `snapshot()`.
 *
 * **The grouping is `newGuess`**, which is the one definition of what a guess is and is shared
 * with `restore` and `guessedWords`. One typed word can be several moves, and a series that
 * made two guesses of it would restore a worse score than was played.
 *
 * A `stand` is emitted only where it is needed — before a guess made from somewhere other than
 * where the last one landed, and once at the end if the cursor was left somewhere else. A tap
 * costs nothing and leaves no trace in the log, so that is the only record there is of one.
 *
 * Hints, marks and the refusal tally come after the moves. The game does not record *when* a
 * hint was asked for — `GameState.hints` is a level per word — so nothing here can pretend to.
 */
export function actionsOf(game: GameSnapshot, puzzle: Puzzle): Action[] {
  const out: Action[] = [];
  let stand = endpoints(puzzle)[0];
  let group: { do: "guess"; words: string[] } | null = null;

  for (const [at, entry] of game.log.entries()) {
    const fresh = newGuess(entry, game.log[at - 1]);
    if (!fresh && group) {
      group.words.push(entry.to);
      continue;
    }
    if (entry.from !== stand) {
      out.push({ do: "stand", word: entry.from });
      stand = entry.from;
    }
    group = { do: "guess", words: [entry.to] };
    out.push(group);
    stand = entry.to;
  }

  if (game.selected !== stand) out.push({ do: "stand", word: game.selected });
  if (game.misses > 0) out.push({ do: "miss", count: game.misses });
  for (const [word, levels] of game.hints) {
    if (levels > 0) out.push({ do: "hint", word, levels });
  }
  for (const key of game.edgeHints ?? []) {
    const [word, to] = key.split(" ");
    if (word && to && word !== to) out.push({ do: "mark", word, to });
  }
  /*
    A total this snapshot already carried, passed straight through.

    Nothing *here* ever drops a hint — a game played in this browser has every level against its
    own word — so this is only ever set on a snapshot that came back from a shared link, where
    the code dropped the words the round had named. Handing it on is what keeps the round trip
    settled: re-encoding what a code restored has to give the same characters, and a total that
    evaporated on the way back through would make the second code shorter than the first. Last,
    which is where `written` puts it.
  */
  if (game.spentHints !== undefined && game.spentHints > 0) {
    out.push({ do: "spent", levels: game.spentHints });
  }
  return out;
}

/**
 * A series as a snapshot, ready for `restore`.
 *
 * A snapshot rather than a `GameState` so that a series arriving from a URL takes the same path
 * a reload takes: `restore` is what decides a move is replayable, clamps a hint level to what
 * the word can give, and renumbers the guesses. Nothing here repeats it.
 *
 * A guess names tokens rather than a spelling, so this walks the graph directly instead of
 * asking the judge: the tokens *are* the answer a judge would have given, and re-deriving them
 * from a spelling would not be faithful — one token's spelling can name tokens the player's
 * spelling did not.
 */
export function replayActions(
  actions: readonly Action[],
  puzzle: Puzzle,
  graph: Graph,
): GameSnapshot {
  const log: LogEntry[] = [];
  const hints: [string, number][] = [];
  const edgeHints: string[] = [];
  const made = new Set<string>();
  let misses = 0;
  let spentHints = 0;
  // Where positions are counted from, which is the sorted pair and not `source` — see
  // `endpoints`. A round that began at the other end says so with a `stand`.
  let stand = endpoints(puzzle)[0];
  let selected = stand;
  let order = 0;

  for (const action of actions) {
    switch (action.do) {
      case "guess": {
        order += 1;
        const [landed] = action.words;
        for (const word of action.words) {
          const move = graph.findMove(stand, word);
          // A pair the graph does not join is not a move anybody made, and a move already made
          // is free — the same two rules `restore` applies, applied early so the tally here
          // matches the tally there.
          if (!move || made.has(edgeKey(stand, word))) continue;
          made.add(edgeKey(stand, word));
          log.push({ from: stand, to: word, move, order });
        }
        if (landed !== undefined) {
          stand = landed;
          selected = landed;
        }
        break;
      }
      case "stand":
        stand = action.word;
        selected = action.word;
        break;
      case "hint":
        hints.push([action.word, action.levels]);
        break;
      case "mark":
        edgeHints.push(moveKey(action.word, action.to));
        break;
      case "miss":
        misses = action.count;
        break;
      case "spent":
        spentHints += action.levels;
        break;
    }
  }

  return {
    log,
    selected,
    misses,
    hints,
    ...(spentHints > 0 ? { spentHints } : {}),
    edgeHints,
  };
}
