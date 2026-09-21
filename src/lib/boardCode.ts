/**
 * A board, written down small enough to put in a URL.
 *
 * People want to send each other their boards, and the only way to do that used to be a
 * photograph. A link is better in every way that matters — it opens the real figure, at the
 * real size, on the phone it is read on — and it costs a second path segment:
 * `{base}{id}/{code}`, the id saying which puzzle and the code saying what happened on it.
 * See route.ts for the address and App's `show` for what opening one does.
 *
 * **This module only says how an action is written.** What a round *is* belongs to actions.ts:
 * one vocabulary shared by the screen, the game and a link, so a thing the player did, a thing
 * the game recorded and a thing a code holds are the same thing under three names. So the
 * whole of the format is four pure steps and a table:
 *
 *     actions.ts   a game    -> Action[]     `actionsOf`, and `replayActions` back
 *     this         Action[]  -> Written[]    `written`: splitting and grouping, for size only
 *     this         Written[] -> bits         `FORM`, one entry per thing the bits can hold
 *     this         bits      -> characters   six at a time, base64url
 *
 * `Written` is the one layer that is not about the game. It exists because two size tricks are
 * worth their complexity and neither is a fact about playing: a guess that named several tokens
 * is written as a guess and then an `also` apiece, so a guess that named one — nearly all of
 * them — costs nothing for the possibility; and a run of hints is written under one tag rather
 * than one tag each. `unwritten` undoes both, and it is used at **both** ends — the writer to
 * check its own work, the reader to arrive at a series — so the two translations are exercised
 * by every code that changes hands rather than by a test that has to think of the case.
 *
 * `explain` is the reader with its trace turned on, which is how an annotated dump of a real
 * code is printed — see `codeSize.test.ts`. That is the only readable form a bit-packed format
 * has, and it reads the code rather than describing it.
 *
 * **Nothing here names a word. Every field is a position in a list both ends already have**,
 * and there are three of them:
 *
 *     a guess         where it landed, among the legal moves from the word guessed from
 *     a stand         which of the words reached so far the player hopped back to
 *     a hint, a mark  which word *of the figure* it is about, and how far it was taken
 *
 * A guess is the one to understand. An index into the dictionary is eighteen bits, twenty once
 * it is written in chunks, so a round with twenty-five strays off the board would spend eighty
 * characters on dictionary indices alone. But a guess is a *move*: whatever it landed
 * on is a neighbour of the word it was made from, and both ends of a link have the same graph.
 * Five or six bits, and a word the board never drew costs exactly what a word on the answer
 * costs — which on a heavy round is the difference between a code that fits in a message and
 * one that does not. A stand is cheaper still: a hop can only be to somewhere already reached,
 * and the reader builds that list as it replays.
 *
 * Only a hint or a mark names a word rather than a move, and a word is the one thing that
 * cannot be counted from an edge. It is counted from the *figure* instead — everywhere the
 * round has reached and everything the puzzle declares, a few dozen words, so seven or eight
 * bits like everything else — with the dictionary behind one flag bit for the rest. See
 * `putWord`, which carries the measurements: this was half of every heavy code.
 *
 * # For a given puzzle id, a code works
 *
 * That is the invariant, and it is the reason the address is shaped the way it is. All three
 * lists above are things a *bank* owns, so a code is only meaningful against the build that
 * wrote it — which would be a hidden dependency, and hidden dependencies of a thing people
 * paste into chat rot silently. So the dependency is made a parent instead:
 *
 *     vocab = digest(the legal word list, the alphabet, minWord, minSub)
 *     id    = digest(mode, the pair sorted, vocab)
 *     code  = positions in the lists that vocab determines
 *
 * A hash tree, in other words, and the id is the node above the code. The legal word list and
 * those two lengths are exactly what decides which moves exist and what the dictionary holds,
 * so an id and every list a code reads against it either name the same vocabulary or the id
 * does not resolve at all. The four data files carry the same digest in their names, so a
 * browser cannot pair a fresh shard with a cached dictionary from a build ago.
 *
 * What is deliberately *not* in the tree is the other half of the argument. Par, the answer,
 * the words the board draws, every selection and taste knob, the calendar: all of them change
 * what the bank holds, none of them can change what a code means, and they move weekly. So
 * they are not in the address, and a rebuild that only touches them leaves every shared board
 * *resolving* — which is not the same as meaning the same thing. `Puzzle.board` **is** indexed
 * now, by hints and marks, and it comes out of the selection rules: so a rebuild that retunes
 * taste leaves a shared code opening the right board with its hints on the wrong words, and no
 * digest moves to say so. That is the price of a third off every code, and `putWord` is where
 * the trade is argued.
 *
 * `vocab:` in recurse.yaml is the tripwire — declare it and the build refuses to change the
 * vocabulary silently, because doing so renames every board in the mode.
 *
 * **The other invariant is direction.** A puzzle is undirected and its id is a digest of the
 * *sorted* pair, so positions are counted from the sorted pair too — see `endpoints` in
 * actions.ts. A rebuild that flips which end is `source` must not change what a code means
 * under an unchanged address.
 *
 * Which list a field indexes into depends on what came before it, so both directions walk a
 * `Cursor`: where the player is standing, where the guess being read was made from, and the
 * words reached so far. It is the one thing that advances, and `Cursor.apply` is the only place
 * that says how.
 *
 * **Where a guess was made from is usually implied.** The game moves the cursor to whatever a
 * guess lands on, so a run of guesses down a chain says nothing about where each was made
 * from. Only a player who hops — or who works back from the goal, which is somewhere to stand
 * from the first move — needs a `stand` first. Which is why the tags are prefix-free and
 * ordered by how often they happen: `1` is a guess, `01` a stand, `00` and three bits is
 * everything else. A guess costs its tag and its index and nothing besides.
 *
 * **Bits, then base64url**: 64 case-sensitive characters, every one safe in a path segment and
 * safe from a mail client's idea of where a link ends. Six bits a character. The 66 unreserved
 * URL characters would buy 0.7% more and cost arbitrary-precision arithmetic to spend.
 *
 * **Why not a general-purpose compressor?** Because it was measured, and this beats one on the
 * rounds that matter — but only once the lists above were chosen properly, and the measurement
 * is the reason they were. On one par-7 board drawing 29 words, in characters of URL, against
 * the notation this format came from:
 *
 *     round                            this   deflate+dict   deflate   brotli   zstd -22
 *     tidy: 7 guesses, 2 hints           13             19        39       38         46
 *     ordinary: 17, 10 off, 10 hints     46            127       142      156        159
 *     heavy: 29, 22 off, 30 hints        89            232       239      260        267
 *
 * The tidy row is the honest place to look, because a short round is mostly head and tail —
 * three bits of version and five of terminator — and a primed dictionary can match a whole short
 * round in a couple of tokens. It was an exact tie at 19 apiece until hints stopped paying a
 * dictionary index; the rows that decide it are still the other two, because that is what
 * people's rounds look like.
 *
 * `deflate+dict` is deflate primed with a hundred and twenty other rounds of the same shape,
 * none of them the one measured — the dictionary training this was asked to be compared
 * against, and the only compressor in the table that is ever close. Three things are going on.
 * A frame plus an entropy table is tens of bits before any content; a compressor works in
 * bytes and its output pays a third again to become base64, which this does not pay because it
 * *writes* base64; and dictionary training is a way to exploit redundancy between samples,
 * which is what indexing against the graph and the puzzle has already removed — a per-message
 * dictionary that both sides have for free, and a better one than a trained average because it
 * is this board's.
 *
 * Worth knowing what a compressor is *good* at, from the same run: the snapshot as JSON is
 * 780 bytes to 3.4KB, which is 1,000 to 4,500 characters of URL, and priming deflate with
 * twenty other snapshots takes that to 172–742. That is compression doing exactly its job on a
 * payload full of repeated keys — and still four to eight times this. The saving is in not
 * saying it, not in squeezing it.
 *
 * **The shape of the round decides all of that**, so the shapes are part of the claim: a round
 * measured as an optimal walk with two hints flatters this format by a factor of three, and
 * nobody's round looks like that. `codeSize.test.ts` is the instrument and it is where to go
 * before believing any of these numbers again.
 *
 * **And the alternative to the whole scheme was measured too**, because "index into a list the
 * bank owns" is the thing that makes an address have to pin a vocabulary. The other way to
 * satisfy *for a given puzzle id, a code works* is to depend on nothing: write a move as the
 * edit it is — kind, position, and the letters when they are new — and spell hint words out.
 * That needs no vocabulary at all, and on comparable rounds it cost 47 / 164 / 387 characters
 * against 19 / 69 / 151 here, with the best dictionary-primed compression of it at 51 / 142 /
 * 307. Two to three times, and the excess is all in spelling out words that the dictionary
 * already has a number for. Pinning the vocabulary in the address buys the same resolution for
 * a digest in a filename.
 *
 * **Refusing is a real answer.** A bad character, a version this build does not have, a missing
 * terminator and anything after one are each `null`, and the caller carries on as if the link
 * had carried no state at all — which is what a bare id does. Anything that survives goes to
 * `restore`, which has always owned whether a move can be replayed.
 *
 * There is no checksum. There was one, and it was dropped for the byte it cost: every field is
 * an index into a list, so a code somebody has mangled decodes to a *different legal round*
 * rather than to nonsense. That is a mess of the mangler's own making and it touches nobody
 * else's game — and a board whose code has gone stale is one that can be opened from the
 * player's own history and shared again.
 */

import { actionsOf, endpoints, replayActions, type Action } from "./actions";
import type { GameSnapshot } from "./game";
import type { Graph, Puzzle } from "./types";

/** Base64url. Case-sensitive on purpose: it is what makes a character worth six bits. */
const DIGITS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const VALUE = new Map([...DIGITS].map((digit, at) => [digit, at] as const));
const DIGIT_BITS = 6;

/**
 * Which format this is, at the head of every code.
 *
 * Three bits, because the alternative to spending them is a change to the operations one day
 * silently decoding an old link into a board nobody played. A version this does not know is
 * refused outright.
 *
 * **This is the guard on a change to how a list is *read*.** The order a neighbour row comes
 * out in is decided by code, in the builder's row writer and in `decodeRows`, and a change to
 * either reinterprets every code ever shared while nothing else moves. Nothing can detect
 * that; bumping this is the only thing that turns it from a wrong board into a refused one,
 * and it has to be done by hand. What it does *not* guard is the word list moving — that is
 * `STAMP_BITS` below, and the two are different questions.
 */
const VERSION = 3;
const VERSION_BITS = 3;

/**
 * Which word list this code was written against, as twelve bits of that mode's vocabulary
 * digest, immediately after the version.
 *
 * **The whole of what the puzzle id used to carry, moved to where it is needed.** A code is a
 * list of positions — the third legal move from here, dictionary word 3187 — so it means
 * something only against the exact word list it was written against. The first answer to that
 * was to hash the word list into every puzzle's *address*, which made the dependency a parent
 * of the thing depending on it and worked exactly as designed: curating a hundred spellings
 * nobody would call words renamed the entire bank and killed every link ever sent. See id.rs.
 *
 * Twelve bits is two characters of the code and a one-in-4,096 chance that two word lists
 * stamp alike. What that buys is the difference between a sentence a player can act on —
 * *this was shared before the word list changed; ask for a fresh link* — and a round that
 * quietly names different words, which is the failure nobody can see.
 *
 * **Taken from the digest rather than counted**, because a counter is a thing to forget. The
 * builder writes the vocabulary into `graph.params`, the graph is the word list, and a code is
 * always read against a graph — so there is nowhere for the two to come apart.
 */
const STAMP_BITS = 12;

/** How much of the digest twelve bits is: three hex digits. */
const STAMP_DIGITS = 3;

/**
 * The stamp of the word list this graph *is*.
 *
 * Zero for data built before the vocabulary was written into the graph, which cannot be paired
 * with a code that has a stamp — those are older than `VERSION` 3 and refused on that instead.
 */
export function stampOf(graph: Graph): number {
  const vocab = graph.params.vocab ?? '';
  return Number.parseInt(vocab.slice(0, STAMP_DIGITS), 16) || 0;
}

/** Chunk width for a counted thing: a tally, a level, how many of something follows. */
const COUNT_CHUNK = 4;

/**
 * How many chunks a counted value may run to before the code is simply wrong.
 *
 * The reader's limit, and only the reader's: what the writer emits is a dictionary index or a
 * small tally, and `known` has already refused a word the dictionary does not have, so nothing
 * it can be handed needs more than three. This is what stops a corrupt code asking the reader
 * to walk a stream of continuation bits.
 */
const MAX_CHUNKS = 5;

/**
 * Chunk width for a dictionary index, which is what a hint or a mark names its word by.
 *
 * Nine rather than seven because these indices are never small: a dictionary of 189,000 words
 * needs eighteen bits, and only 9% of it fits in two seven-bit chunks. At nine, two chunks
 * cover everything either game has — twenty bits against twenty-four — which is about a tenth
 * off a round with thirty hints on it.
 */
const WORD_CHUNK = 9;

/**
 * What the bits can hold: an action, or a piece of one. Exported only so the instrument that
 * prints this stage can name it — see `writtenOf`.
 *
 * Not a game vocabulary — that is `Action` — but the shape the format writes, which differs
 * in exactly two places and both of them buy size. A guess that named several tokens becomes
 * a `guess` and an `also` apiece; a run of hints or of marks becomes one `hints` or `marks`,
 * so their tag is paid once. `written` and `unwritten` are the two translations.
 */
export type Written =
  | { w: "guess"; to: string }
  | { w: "also"; to: string }
  | { w: "stand"; at: string }
  | { w: "hints"; on: (readonly [string, number])[] }
  | { w: "marks"; on: (readonly [string, string])[] }
  | { w: "miss"; count: number }
  | { w: "spent"; levels: number };

/** One field of a code as read: where it started, how wide it was, and what it named. */
export interface Field {
  at: number;
  bits: string;
  name: string;
  says: string;
}

/** Bits needed to hold any position in a list of this length. Zero for a list of one. */
function bitsFor(size: number): number {
  let bits = 0;
  while (1 << bits < size) bits += 1;
  return bits;
}

/**
 * Where a word sits in the dictionary, or -1.
 *
 * A binary search, because the dictionary is sorted — it is the index the graph rows and the
 * common list are written against, so its order is the one thing about it that is
 * load-bearing (see `Graph.words`). Every hint and every mark comes through here, twice for a
 * mark, and nothing else does.
 */
function dictionaryIndex(words: readonly string[], word: string): number {
  let low = 0;
  let high = words.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const at = words[mid]!;
    if (at === word) return mid;
    if (at < word) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/**
 * What a field is read or written *against*.
 *
 * Every index in a code is a position in one of three lists, and which list — and so how many
 * bits the index takes — depends on what came before it. This is that state, and `apply` is
 * the only account of how it advances.
 */
interface Cursor {
  /** Where the player is standing: what a guess is a move from. */
  readonly stand: string;
  /** Where the guess being read was made from: what its other readings are moves from. */
  readonly from: string;
  /** The words reached so far, in order: what a `stand` indexes into. */
  readonly reached: readonly string[];
  /**
   * The words on the figure: what a hint or a mark indexes into.
   *
   * Everywhere the round has reached, then the words the puzzle declares. That is the set a
   * player can click, so it is the set a hint can be about — and it is a few dozen words rather
   * than a hundred and eighty thousand, which is the whole of why this exists: **half of a
   * heavy code was dictionary indices.**
   *
   * **Both ends build it the same way, and the order is the point.** `reached` first, in the
   * order the code itself establishes, then `board` in the order the bank wrote it. Hints and
   * marks are written after every move (see `written`), so by the time one is read the reached
   * list has stopped growing and the two sides cannot disagree about what position 7 means.
   */
  readonly drawn: readonly string[];
  apply(one: Written): void;
}

function cursor(puzzle: Puzzle): Cursor {
  // Both endpoints, because both are somewhere to stand before a single move is made — see
  // `isFront` in game.ts — and **sorted**, because the address is: see `endpoints` in
  // actions.ts for why a flipped pair must not change what a position means.
  const reached: string[] = endpoints(puzzle);
  let stand = reached[0]!;
  let from = stand;
  const arrive = (word: string) => {
    if (!reached.includes(word)) reached.push(word);
  };
  return {
    get stand() {
      return stand;
    },
    get from() {
      return from;
    },
    get reached() {
      return reached;
    },
    get drawn() {
      const out = [...reached];
      const seen = new Set(out);
      for (const word of puzzle.board) {
        if (!seen.has(word)) {
          seen.add(word);
          out.push(word);
        }
      }
      return out;
    },
    apply(one) {
      if (one.w === "guess") {
        from = stand;
        stand = one.to;
        arrive(one.to);
      } else if (one.w === "also") {
        arrive(one.to);
      } else if (one.w === "stand") {
        stand = one.at;
      }
    },
  };
}

/** Bits out, six at a time, as base64url. */
interface Out {
  put(value: number, width: number): void;
  /**
   * A number in chunks of `width` bits, most significant first, each behind a bit saying
   * whether another follows. Small values cost one chunk, and nothing has to know in advance
   * how large a value can be.
   */
  count(value: number, width: number): void;
}

function writer() {
  let out = "";
  let acc = 0;
  let held = 0;

  const put = (value: number, width: number) => {
    for (let at = width - 1; at >= 0; at--) {
      acc = (acc << 1) | ((value >>> at) & 1);
      held += 1;
      if (held < DIGIT_BITS) continue;
      out += DIGITS[acc];
      acc = 0;
      held = 0;
    }
  };

  const count = (value: number, width: number) => {
    const chunks: number[] = [];
    let left = value;
    do {
      chunks.unshift(left & ((1 << width) - 1));
      left >>>= width;
    } while (left > 0);
    for (const [at, chunk] of chunks.entries()) {
      put(at === chunks.length - 1 ? 0 : 1, 1);
      put(chunk, width);
    }
  };

  return {
    io: { put, count } satisfies Out,
    // Padded with zeroes, which a reader meets as the terminator.
    done: () => (held === 0 ? out : out + DIGITS[acc << (DIGIT_BITS - held)]),
  };
}

/**
 * Bits in. `null` from either method means the stream is spent, which is how a code ends —
 * and, past the point where a terminator was due, how a truncated one is caught.
 *
 * `name` and `says` are for the annotated dump and cost nothing when nobody is watching:
 * `says` is a function, so the sentence is only built when a trace is being recorded.
 */
interface In {
  take(
    width: number,
    name: string,
    says?: (value: number) => string,
  ): number | null;
  count(
    width: number,
    name: string,
    says?: (value: number) => string,
  ): number | null;
  /** Is the rest of the stream the zero padding to a character boundary, and nothing else? */
  spent(): boolean;
}

function reader(code: string, trace?: Field[]) {
  const bits = code.length * DIGIT_BITS;
  let at = 0;

  const slice = (from: number, width: number) => {
    let out = "";
    for (let i = 0; i < width; i++) {
      const digit = VALUE.get(code[Math.floor((from + i) / DIGIT_BITS)]!)!;
      out += (digit >>> (DIGIT_BITS - 1 - ((from + i) % DIGIT_BITS))) & 1;
    }
    return out;
  };

  const note = (
    from: number,
    width: number,
    name: string,
    value: number,
    says?: (value: number) => string,
  ) => {
    if (!trace) return;
    trace.push({
      at: from,
      bits: width === 0 ? "·" : slice(from, width),
      name,
      says: says ? says(value) : String(value),
    });
  };

  const take: In["take"] = (width, name, says) => {
    if (at + width > bits) return null;
    const from = at;
    let out = 0;
    for (let i = 0; i < width; i++, at++) {
      const digit = VALUE.get(code[Math.floor(at / DIGIT_BITS)]!)!;
      out = (out << 1) | ((digit >>> (DIGIT_BITS - 1 - (at % DIGIT_BITS))) & 1);
    }
    note(from, width, name, out, says);
    return out;
  };

  const count: In["count"] = (width, name, says) => {
    const from = at;
    let out = 0;
    for (let chunks = 0; chunks < MAX_CHUNKS; chunks++) {
      const more = take(1, name);
      const chunk = take(width, name);
      if (more === null || chunk === null) return null;
      // Multiplied rather than shifted: `<<` is 32-bit, and five chunks of nine is forty-five
      // — so a corrupt code could produce a *negative* index, which is a different kind of
      // wrong from a large one.
      out = out * (1 << width) + chunk;
      if (more === 0) {
        // One field for the whole run of chunks rather than two rows per chunk: what a reader
        // of the dump wants is the number and what it cost.
        if (trace) trace.length -= 2 * (chunks + 1);
        note(from, (chunks + 1) * (width + 1), name, out, says);
        return out;
      }
    }
    return null;
  };

  const spent = () => {
    for (let i = at; i < bits; i++) {
      const digit = VALUE.get(code[Math.floor(i / DIGIT_BITS)]!)!;
      if ((digit >>> (DIGIT_BITS - 1 - (i % DIGIT_BITS))) & 1) return false;
    }
    // Padding is under one character; more than that is another character of something.
    return bits - at < DIGIT_BITS;
  };

  return { io: { take, count, spent } satisfies In };
}

/**
 * A word a hint or a mark is about: a place on the figure, or failing that in the dictionary.
 *
 * **The two fields that name a word rather than a move, and they were half the format.**
 * Measured over real rounds of four shapes, dictionary indices were 50% of every bit in a heavy
 * code and 47% in an ordinary one — twenty bits apiece, against seven or eight for a guess,
 * because a guess is a *move* and can be counted against the handful of edges from where the
 * player stood while a hint names a word out of a hundred and eighty thousand.
 *
 * But a hint is a word you clicked, so it is a word that was on the screen — and the figure is
 * a few dozen words. Measured the same way, **every hinted word in every round was either
 * reached or declared by the puzzle**, and the widest board was seventy words: seven bits. So
 * the index is against `Cursor.drawn` and the dictionary is the fallback, behind one bit saying
 * which. The fallback is not dead weight — 37% of *mark* targets are neither reached nor
 * declared, being ordinary neighbours the plate drew around the answer.
 *
 * **This is a reversal.** It was the dictionary before, because `Puzzle.board` comes out of the
 * selection rules — the taste knobs, which move weekly and are outside the hash tree — so a
 * rebuild that retunes taste changes what an old code's hints name. That was worth a third of
 * every code, and it is not worth much: a stale link is one somebody can replace from their own
 * history, and nothing it does reaches anybody else's game.
 */
function putWord(
  io: Out,
  word: string,
  graph: Graph,
  drawn: readonly string[],
): void {
  const local = drawn.indexOf(word);
  io.put(local >= 0 ? 1 : 0, 1);
  if (local >= 0) io.put(local, bitsFor(drawn.length));
  else io.count(dictionaryIndex(graph.words, word), WORD_CHUNK);
}

function takeWord(
  io: In,
  graph: Graph,
  name: string,
  drawn: readonly string[],
): string | null {
  const near = io.take(1, "where", (value) =>
    value === 1 ? "on the figure" : "in the dictionary",
  );
  if (near === null) return null;
  if (near === 1) {
    const at = io.take(bitsFor(drawn.length), name, (value) => {
      return `${value} of ${drawn.length} drawn → ${drawn[value]}`;
    });
    return at === null ? null : (drawn[at] ?? null);
  }
  const at = io.count(
    WORD_CHUNK,
    name,
    (value) => `${value} → ${graph.words[value]}`,
  );
  return at === null ? null : (graph.words[at] ?? null);
}

/**
 * Can this word be written at all? A hint on a word from nowhere is dropped, not guessed at.
 *
 * On the figure counts as well as in the dictionary, though in practice a drawn word is always
 * both — the figure is drawn out of the graph.
 */
function known(word: string, graph: Graph, drawn: readonly string[]): boolean {
  return drawn.includes(word) || dictionaryIndex(graph.words, word) >= 0;
}

/**
 * What each thing the bits hold looks like: its tag, and both directions of its fields.
 *
 * One entry per kind, so adding one is one entry rather than a change to a writer and a
 * matching change to a reader. The tags themselves are in `writeWritten`/`readWritten`,
 * because they are prefix-free and shared: `1` a guess, `01` a stand, `00` and this table's
 * `code`.
 *
 * A move's index is into the graph's own list of moves from a word — `stand` for a guess,
 * `from` for the other readings of one — which is why every entry takes the cursor.
 */
interface Form {
  /** The three-bit code, for the kinds that need one. Negative for the two with short tags. */
  code: number;
  write(one: Written, io: Out, at: Cursor, graph: Graph): void;
  read(io: In, at: Cursor, graph: Graph): Written | null;
}

/** How a move's index reads, given the list it indexes into. */
const move = (io: In, near: readonly string[], from: string, note: string) => {
  const at = io.take(bitsFor(near.length), "move", (value) => {
    return `${value} of ${near.length} moves from ${from} → ${near[value]}${note}`;
  });
  return at === null ? null : (near[at] ?? null);
};

const FORM: Record<Written["w"], Form> = {
  guess: {
    code: -1,
    write(one, io, at, graph) {
      const near = graph.neighbors(at.stand);
      io.put(near.indexOf((one as { to: string }).to), bitsFor(near.length));
    },
    read(io, at, graph) {
      const to = move(io, graph.neighbors(at.stand), at.stand, "");
      return to === null ? null : { w: "guess", to };
    },
  },
  stand: {
    code: -1,
    write(one, io, at) {
      io.put(
        at.reached.indexOf((one as { at: string }).at),
        bitsFor(at.reached.length),
      );
    },
    read(io, at) {
      const which = io.take(bitsFor(at.reached.length), "stand", (value) => {
        return `${value} of ${at.reached.length} reached → ${at.reached[value]}`;
      });
      if (which === null) return null;
      const word = at.reached[which];
      return word === undefined ? null : { w: "stand", at: word };
    },
  },
  also: {
    code: 1,
    write(one, io, at, graph) {
      const near = graph.neighbors(at.from);
      io.put(near.indexOf((one as { to: string }).to), bitsFor(near.length));
    },
    read(io, at, graph) {
      const to = move(io, graph.neighbors(at.from), at.from, " — same guess");
      return to === null ? null : { w: "also", to };
    },
  },
  hints: {
    code: 2,
    write(one, io, at, graph) {
      const { on } = one as { on: (readonly [string, number])[] };
      const drawn = at.drawn;
      io.count(on.length, COUNT_CHUNK);
      for (const [word, level] of on) {
        putWord(io, word, graph, drawn);
        io.count(level, COUNT_CHUNK);
      }
    },
    read(io, at, graph) {
      const drawn = at.drawn;
      const many = io.count(
        COUNT_CHUNK,
        "how many",
        (value) => `${value} word${value === 1 ? "" : "s"} hinted`,
      );
      if (many === null) return null;
      const on: (readonly [string, number])[] = [];
      for (let one = 0; one < many; one++) {
        const word = takeWord(io, graph, "word", drawn);
        const level =
          word === null
            ? null
            : io.count(COUNT_CHUNK, "level", (v) => `level ${v}`);
        if (word === null || level === null) return null;
        on.push([word, level]);
      }
      return { w: "hints", on };
    },
  },
  marks: {
    code: 3,
    write(one, io, at, graph) {
      const { on } = one as { on: (readonly [string, string])[] };
      const drawn = at.drawn;
      io.count(on.length, COUNT_CHUNK);
      for (const [word, other] of on) {
        putWord(io, word, graph, drawn);
        putWord(io, other, graph, drawn);
      }
    },
    read(io, at, graph) {
      const drawn = at.drawn;
      const many = io.count(
        COUNT_CHUNK,
        "how many",
        (value) => `${value} move${value === 1 ? "" : "s"} marked`,
      );
      if (many === null) return null;
      const on: (readonly [string, string])[] = [];
      for (let one = 0; one < many; one++) {
        const word = takeWord(io, graph, "word", drawn);
        const other = word === null ? null : takeWord(io, graph, "to", drawn);
        if (word === null || other === null) return null;
        on.push([word, other]);
      }
      return { w: "marks", on };
    },
  },
  spent: {
    code: 5,
    write(one, io) {
      io.count((one as { levels: number }).levels, COUNT_CHUNK);
    },
    read(io) {
      const levels = io.count(
        COUNT_CHUNK,
        "spent",
        (value) =>
          `${value} hint${value === 1 ? "" : "s"} on words since named`,
      );
      return levels === null ? null : { w: "spent", levels };
    },
  },
  miss: {
    code: 4,
    write(one, io) {
      io.count((one as { count: number }).count, COUNT_CHUNK);
    },
    read(io) {
      const count = io.count(
        COUNT_CHUNK,
        "refused",
        (value) => `${value} guess${value === 1 ? "" : "es"} refused`,
      );
      return count === null ? null : { w: "miss", count };
    },
  },
};

/** The terminator, which is written: what follows it is the digest. */
const END = 0;

/** Which kind a three-bit code names. */
const BY_CODE = new Map<number, Written["w"]>(
  (Object.keys(FORM) as Written["w"][])
    .filter((one) => FORM[one].code >= 0)
    .map((one) => [FORM[one].code, one]),
);

/**
 * Actions as the things the bits hold: splitting a guess that named several tokens, grouping
 * runs of hints and of marks.
 *
 * Exported for `codeSize.test.ts`, which prints this stage: it is the one layer between a game
 * and its characters that nothing else can show. Not part of how a board is shared — that is
 * `encodeBoard` and `decodeBoard`.
 *
 * Also where anything unwritable is dropped, which is the only reason this needs the graph: a
 * move is written as a position in the list of moves from the word it was made from, so a pair
 * the graph does not join cannot be written at all, and a hint on a word neither the puzzle nor
 * the dictionary knows cannot either. Nothing a game can reach is such a thing — a logged move
 * is an edge and its ends are graph nodes — but a snapshot is a string out of a browser.
 */
export function writtenOf(
  actions: readonly Action[],
  puzzle: Puzzle,
  graph: Graph,
): Written[] {
  const at = cursor(puzzle);
  const out: Written[] = [];
  /** Hint levels on words the round named, which go out as one number. See the `hint` case. */
  let spent = 0;
  const add = (one: Written) => {
    out.push(one);
    at.apply(one);
  };

  for (const action of actions) {
    switch (action.do) {
      case "guess": {
        const [landed, ...rest] = action.words;
        if (landed === undefined || !graph.neighbors(at.stand).includes(landed))
          continue;
        add({ w: "guess", to: landed });
        for (const word of rest) {
          if (graph.neighbors(at.from).includes(word))
            add({ w: "also", to: word });
        }
        break;
      }
      case "stand":
        // Nowhere the player could have been standing. `restore` would drop a move from there
        // for the same reason, so the code says nothing about it either.
        if (at.reached.includes(action.word) && action.word !== at.stand) {
          add({ w: "stand", at: action.word });
        }
        break;
      case "hint": {
        if (action.levels <= 0 || !known(action.word, graph, at.drawn)) break;
        /*
          **A hint on a word the round went on to name is written as a number, not as a word.**

          The figure shows nothing for it: that word is spelled out in full, and the letters it
          was bought a few at a time are all there. So what a share link owes is the *tally* and
          not the word, and carrying the word cost a flag, an index and a level — about twelve
          bits apiece, for something nobody can see.

          This is the one place the format is deliberately lossy, and it is lossy about the
          right thing: a shared board is for looking at, and what it has to reconstruct is what
          somebody sees. A full-fidelity variant is the same format with this branch removed —
          see `Action` in actions.ts, which carries `spent` for exactly that reason.
        */
        if (at.reached.includes(action.word)) {
          spent += action.levels;
          break;
        }
        const last = out[out.length - 1];
        // Folded into the run before it when there is one, so the tag is paid once.
        if (last?.w === "hints") last.on.push([action.word, action.levels]);
        else add({ w: "hints", on: [[action.word, action.levels]] });
        break;
      }
      // Already a total, which is what a code that has been round-tripped hands back. Added
      // to whatever this pass drops, so re-encoding what came back gives the same characters.
      case "spent":
        spent += action.levels;
        break;
      case "mark": {
        if (
          action.word === action.to ||
          !known(action.word, graph, at.drawn) ||
          !known(action.to, graph, at.drawn)
        ) {
          break;
        }
        const last = out[out.length - 1];
        if (last?.w === "marks") last.on.push([action.word, action.to]);
        else add({ w: "marks", on: [[action.word, action.to]] });
        break;
      }
      case "miss":
        if (action.count > 0) add({ w: "miss", count: action.count });
        break;
    }
  }
  // Last, and once: it is a total rather than a thing that happened, so it has no place in
  // the order and there is nothing to gain by writing it anywhere else.
  if (spent > 0) add({ w: "spent", levels: spent });
  return out;
}

/**
 * And back: an `also` folds into the guess before it, a run of hints or marks spreads out
 * again.
 *
 * Used at **both** ends — the writer digests `unwritten(writtenOf(actions))` and the reader
 * digests `unwritten(ops)` — so the two translations are checked against each other by every
 * code that changes hands, rather than by a test that has to think of the case.
 */
function unwritten(ops: readonly Written[]): Action[] {
  const out: Action[] = [];
  for (const one of ops) {
    switch (one.w) {
      case "guess":
        out.push({ do: "guess", words: [one.to] });
        break;
      case "also": {
        const last = out[out.length - 1];
        // An `also` with no guess before it is not a thing the writer can produce; a code from
        // somewhere else could claim one, and dropping it is the same answer `restore` gives a
        // move from nowhere.
        if (last?.do === "guess") (last.words as string[]).push(one.to);
        break;
      }
      case "stand":
        out.push({ do: "stand", word: one.at });
        break;
      case "hints":
        for (const [word, levels] of one.on)
          out.push({ do: "hint", word, levels });
        break;
      case "marks":
        for (const [word, to] of one.on) out.push({ do: "mark", word, to });
        break;
      case "miss":
        out.push({ do: "miss", count: one.count });
        break;
      case "spent":
        out.push({ do: "spent", levels: one.levels });
        break;
    }
  }
  return out;
}

/** The things the bits hold, as characters: the tags, each one's fields, the terminator, the
 * digest of what it all means. */
function writeWritten(
  ops: readonly Written[],
  puzzle: Puzzle,
  graph: Graph,
): string {
  const { io, done } = writer();
  const at = cursor(puzzle);

  io.put(VERSION, VERSION_BITS);
  io.put(stampOf(graph), STAMP_BITS);
  for (const one of ops) {
    if (one.w === "guess") io.put(1, 1);
    else if (one.w === "stand") {
      io.put(0, 1);
      io.put(1, 1);
    } else {
      io.put(0, 2);
      io.put(FORM[one.w].code, 3);
    }
    FORM[one.w].write(one, io, at, graph);
    at.apply(one);
  }
  // Both, always: it is the terminator that says the code arrived whole.
  io.put(0, 2);
  io.put(END, 3);
  return done();
}

/** A series of actions, as a code. */
export function writeActions(
  actions: readonly Action[],
  puzzle: Puzzle,
  graph: Graph,
): string {
  return writeWritten(writtenOf(actions, puzzle, graph), puzzle, graph);
}

/**
 * A code, as the series of actions it holds, or `null` for anything that is not a whole,
 * intact code for this puzzle.
 *
 * `trace` is the annotated dump: pass an array and every field read is appended to it, in
 * order, with what it named. Nothing is built when it is left off.
 */
function read(
  code: string,
  puzzle: Puzzle,
  graph: Graph,
  trace?: Field[],
): { ops: Written[]; actions: Action[] } | null {
  if (!isBoardCode(code)) return null;
  const { io } = reader(code, trace);
  if (
    io.take(VERSION_BITS, "version", (value) => `format ${value}`) !== VERSION
  )
    return null;
  /*
    **Read and not compared, but it does have to be *there*.**

    Not compared, because a stamp that disagrees with this word list means the positions below
    may name other words than the sharer's — and the bit stream is still this format and still
    decodes, so a round shown beside "ask for a fresh link" is worth more to the two people
    involved than a blank board. `staleCode` is what the screen asks.

    There, because a code cut short in the middle of the header would otherwise leave the
    cursor where it was and read the *stamp's own bits* as the first operation. Two characters
    of a five-character code duly came back as a complete empty round, which is the one thing
    the reader must never do with a fragment: half a board looks like somebody's round rather
    than like a broken link.
  */
  if (
    io.take(STAMP_BITS, "vocabulary", (value) => `word list ${value.toString(16)}`) === null
  )
    return null;

  const at = cursor(puzzle);
  const ops: Written[] = [];

  for (;;) {
    const tag = io.take(1, "tag", (value) =>
      value === 1 ? "a guess" : "not a guess",
    );
    if (tag === null) return null;

    let kind: Written["w"] | null = null;
    if (tag === 1) kind = "guess";
    else {
      const second = io.take(1, "tag", (value) =>
        value === 1 ? "a stand" : "an operation",
      );
      if (second === null) return null;
      if (second === 1) kind = "stand";
      else {
        const code3 = io.take(3, "op", (value) =>
          value === END ? "end" : (BY_CODE.get(value) ?? "?"),
        );
        if (code3 === null) return null;
        if (code3 === END) break;
        kind = BY_CODE.get(code3) ?? null;
        // Something this version does not have. Nothing after it can be placed, since its own
        // width is unknown.
        if (kind === null) return null;
      }
    }

    const one = FORM[kind].read(io, at, graph);
    if (one === null) return null;
    ops.push(one);
    at.apply(one);
  }

  const actions = unwritten(ops);
  // Nothing after the terminator but the zeroes that pad to a character boundary, so that a
  // code is
  // *canonical*: one board, one string. A chat client or an autolinker that swallowed a
  // neighbouring character would otherwise hand back the right board under a second name.
  if (!io.spent()) return null;
  return { ops, actions };
}

/** Is this even a code? Base64url and nothing else, so a stray character is an early no. */
export function isBoardCode(code: string): boolean {
  return code.length > 0 && [...code].every((digit) => VALUE.has(digit));
}

/**
 * Was this code written against some other word list than the one in front of it?
 *
 * **The question the screen asks, and the only one it can act on.** A board code is positions
 * into lists the word list determines, so a curation of that list does not make a code
 * *invalid* — it makes it mean something else, quietly, which is why it has to be asked rather
 * than discovered. What comes back is a sentence for the player: this was shared before the
 * words moved, so ask whoever sent it for a fresh link.
 *
 * True for a code of an older format too. The stamp cannot be read out of one — the bits are
 * not in the same places — but a code this build cannot read is certainly not one this build
 * wrote, and "ask for a fresh link" is the same answer and the same remedy.
 *
 * Cheap on purpose: fifteen bits off the front, no puzzle, no replay. A board with no code,
 * or a string that is not one at all, is not stale — it is nothing, which the caller already
 * handles.
 */
export function staleCode(code: string, graph: Graph): boolean {
  if (!isBoardCode(code)) return false;
  const { io } = reader(code);
  if (io.take(VERSION_BITS, "version") !== VERSION) return true;
  return io.take(STAMP_BITS, "vocabulary") !== stampOf(graph);
}

/**
 * Write a board down.
 *
 * Takes the snapshot rather than the live game, for the same reason share.ts takes plain data:
 * a code is about what was played and not about what is on screen, and a test should not have
 * to build a `GameState` to ask what one looks like.
 */
export function encodeBoard(
  game: GameSnapshot,
  puzzle: Puzzle,
  graph: Graph,
): string {
  return writeActions(actionsOf(game, puzzle), puzzle, graph);
}

/**
 * Read a board back, as the snapshot `restore` takes. `null` if the code is not a whole,
 * intact one for this puzzle.
 *
 * A snapshot rather than a `GameState`, so a shared board takes the same path a reload takes:
 * `restore` is what decides a move is replayable, clamps a hint level to what the word can
 * give, and renumbers the guesses. Nothing here repeats it.
 */
export function decodeBoard(
  code: string,
  puzzle: Puzzle,
  graph: Graph,
): GameSnapshot | null {
  const out = read(code, puzzle, graph);
  return out === null ? null : replayActions(out.actions, puzzle, graph);
}

/**
 * A code taken apart: what it holds at each of the three layers the reader passes through.
 *
 * Named because three places spell it — `explain` returns it, App hands it to the chrome, and
 * the dev bar's inspector draws it — and a shape written out at each of them is a shape they
 * can come to disagree about.
 */
export interface Reading {
  ops: Written[];
  actions: Action[];
  fields: Field[];
}

/** What one kind of field cost a code: how many there were, and the bits between them. */
export interface Spend {
  name: string;
  count: number;
  bits: number;
}

/**
 * Where a code's length went, by kind of field, dearest first.
 *
 * The question anybody looking at a long code actually has. A field-by-field dump answers it
 * only by being added up, and a heavy round is two hundred fields — so the adding up is done
 * here, once, rather than by eye or by a second walk in whatever is drawing it.
 *
 * It is the *names the reader used*, not a fixed list, so a field added to `FORM` appears here
 * without anything being told about it. The head and the tail — `version`, the last `op`, the
 * `digest` — show up as their own rows and are the floor a short code cannot go below, which
 * is worth seeing beside the rest rather than subtracted out.
 */
export function spending(fields: readonly Field[]): Spend[] {
  const by = new Map<string, Spend>();
  for (const field of fields) {
    const spend = by.get(field.name) ?? { name: field.name, count: 0, bits: 0 };
    spend.count += 1;
    // The padding dots in a field's bits are the characters it did not fill, not bits it
    // spent — see the dump in `codeSize.test.ts`, which strips them to rebuild the stream.
    spend.bits += [...field.bits].filter(
      (bit) => bit === "0" || bit === "1",
    ).length;
    by.set(field.name, spend);
  }
  return [...by.values()].sort(
    (a, b) => b.bits - a.bits || a.name.localeCompare(b.name),
  );
}

/**
 * A code, field by field, for reading rather than for running.
 *
 * The whole of the annotated dump: the reader with its trace turned on, so what is printed is
 * the actual code and not a description of one. `codeSize.test.ts` formats it, and the dev
 * bar's inspector draws it — see `spending` for the summary that goes above it.
 */
export function explain(
  code: string,
  puzzle: Puzzle,
  graph: Graph,
): Reading | null {
  const fields: Field[] = [];
  const out = read(code, puzzle, graph, fields);
  return out === null ? null : { ...out, fields };
}
