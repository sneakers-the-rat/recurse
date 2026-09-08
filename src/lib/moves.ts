/**
 * Judging a typed guess, and explaining it when it fails.
 *
 * Legality is decided by the edge list (see graph.ts). Everything here beyond
 * that lookup exists to turn a rejection into a sentence the player can act on
 * — especially the case the original build silently swallowed, where letters
 * arrive in two separate places so no single word was ever inserted.
 *
 * **It names the message rather than writing the sentence.** A refusal comes back as a
 * `Phrase` — which message, and what to put in it — and whoever is drawing says it. This
 * module is tested in node and imported by the e2e fixtures outside a bundler, so it has
 * no business holding a `useIntl`; and English written down here would be English below
 * the layer that knows what language the player reads.
 */

import { guess as says } from '../i18n/messages/guess';
import { PLAIN, type Lexicon } from './lexicon';
import type { EditShape, Graph, InsertionSpot, Judgement, Move } from './types';

/**
 * Every way a contiguous run could be inserted into `shorter` to give `longer`.
 *
 * Brute force over positions rather than a prefix/suffix trick: words are ~20
 * letters, and repeated letters mean there can genuinely be several readings
 * (`all` -> `ball` could insert "b" at 0; `see` -> `seen` vs `sseen`...).
 * Enumerating them lets the caller pick the spot that is a real word, and lets
 * error messages name the run the player probably meant.
 */
export function insertionSpots(shorter: string, longer: string): InsertionSpot[] {
  const k = longer.length - shorter.length;
  if (k <= 0) return [];
  const spots: InsertionSpot[] = [];
  for (let i = 0; i + k <= longer.length; i++) {
    if (longer.slice(0, i) + longer.slice(i + k) === shorter) {
      spots.push({ pos: i, sub: longer.slice(i, i + k) });
    }
  }
  return spots;
}

/**
 * The shape of the edit from `from` to `to`, ignoring legality.
 *
 * - `add` / `remove` — one contiguous run differs; `spots` says where it could be.
 * - `scattered` — letters differ in more than one place, so no single word was
 *   inserted or deleted. This is the case that most needs explaining.
 * - `swap` — same length, different letters: a replacement move. Those belong to
 *   a separate (not yet built) mode, so they are worth their own message rather
 *   than being lumped in with illegal edits.
 */
export function analyzeEdit(from: string, to: string): EditShape {
  if (from === to) return { shape: 'identical' };
  if (to.length > from.length) {
    const spots = insertionSpots(from, to);
    const length = to.length - from.length;
    return spots.length
      ? { shape: 'add', spots, length }
      : { shape: 'scattered', direction: 'add', length };
  }
  if (to.length < from.length) {
    // Deleting a run from `from` is the same relation as inserting it into `to`.
    const spots = insertionSpots(to, from);
    const length = from.length - to.length;
    return spots.length
      ? { shape: 'remove', spots, length }
      : { shape: 'scattered', direction: 'remove', length };
  }
  return { shape: 'swap' };
}

/** Readings long enough to be a legal move, longest first, then leftmost. */
function legalReadings(spots: readonly InsertionSpot[], minSub: number): InsertionSpot[] {
  return [...spots]
    .sort((a, b) => b.sub.length - a.sub.length || a.pos - b.pos)
    .filter((s) => s.sub.length >= minSub);
}

/**
 * The reading of an ambiguous edit that names a real word, if there is one.
 *
 * This is the whole of the game's generosity about ambiguity, in one place.
 * `lifetime` → `lime` can be read as dropping `ifet` or `feti`; the move counts
 * if *any* reading names a word, so every consumer has to ask the same question
 * — judging the guess, drawing the edge, and describing an edge in the shipped
 * list. Each of those asked it separately once, and they disagreed about which
 * moves existed.
 */
export function wordReading(
  spots: readonly InsertionSpot[],
  minSub: number,
  isWord: ((word: string) => boolean) | null,
): InsertionSpot | undefined {
  if (!isWord) return undefined;
  return legalReadings(spots, minSub).find((s) => isWord(s.sub));
}

/**
 * Pick which reading to show the player.
 *
 * A word if one can be found, since that is the move the game would accept;
 * otherwise the longest legal-length run, which is the one they probably meant.
 * Used for a guess that is *not* a legal move, where there is nothing to agree
 * with and the job is only to name what they appear to have tried.
 */
export function bestReading(
  spots: readonly InsertionSpot[],
  minSub: number,
  isWord: ((word: string) => boolean) | null,
): InsertionSpot {
  const legal = legalReadings(spots, minSub);
  return (
    wordReading(spots, minSub, isWord) ??
    legal[0] ??
    [...spots].sort((a, b) => b.sub.length - a.sub.length || a.pos - b.pos)[0]!
  );
}

/**
 * Judge a guess made from the word `from`.
 *
 * Legality has two sources, and they are not the same thing:
 *
 *  - the shipped edge list, which carries the exact subword and position for
 *    every move it knows about.
 *  - `isWord`, the full ~189k dictionary. Any real word is a legal guess, so a
 *    move it accepts is legal even where the pair has no stored edge.
 *
 * The edge list is tried first because it is cheaper and already knows the answer.
 * Without `isWord`, wording avoids asserting anything it cannot check.
 *
 * **What the player types is not necessarily what the graph is indexed by.** In the phonemes
 * mode a node is a pronunciation, so the typed spelling is resolved through the lexicon
 * first — and a word said more than one way gives more than one token. **Every one that makes
 * a move comes back**, in `also`, which is the same generosity `wordReading` shows one level
 * down about which run a move removed: the game does not pick a reading and hope. If none
 * makes a move, the refusal explains the most familiar one, because that is the one the
 * player meant.
 */
export function judgeGuess(
  graph: Graph,
  from: string,
  raw: string,
  isWord: ((word: string) => boolean) | null = null,
  lexicon: Lexicon = PLAIN,
): Judgement {
  const typed = String(raw ?? '').trim().toLowerCase();

  if (!typed) return { ok: false, code: 'empty', reason: { message: says.empty } };
  if (!/^[a-z]+$/.test(typed)) {
    return { ok: false, code: 'not-letters', reason: { message: says.notLetters } };
  }

  const candidates = lexicon.parse(typed);
  if (!candidates.length) {
    // Only reachable in a translated alphabet, where a word can be perfectly real and still
    // have no pronunciation in the corpus. That is a gap in the data rather than a verdict on
    // the word, and saying "not in the word list" would be a lie about it.
    return {
      ok: false,
      code: 'unknown-sound',
      reason: { message: says.unknownSound, values: { word: typed } },
    };
  }

  /*
    **Every reading that works, not the first one that does.**

    A spelling can name several tokens — `dissenters` is `/dɪsɛntɚz/` and `/dɪsɛnɚz/` — and
    more than one of them can be a legal move from where the player is standing. Stopping at
    the first was a bug you could lose a game to: on `does → dissenters` the reading that came
    up first was the one that is *not* the goal, so typing the goal's own name walked to a
    second node beside it and the round could not be finished at all.

    So they all come back, and `applyGuess` puts all of them on the board as one guess. Which
    one is `word` — the one the guess bar reports and the cursor moves to — is decided there
    too, since it depends on the puzzle and this only knows the graph.

    A rejection is still the *first* reading's, because a player who typed a word that no
    reading can play wants one sentence about it and the readings mostly fail the same way.
  */
  let first: Judgement | null = null;
  const made: { word: string; move: Move }[] = [];
  for (const word of candidates) {
    const verdict = judgeToken(graph, from, word, typed, isWord, lexicon);
    if (verdict.ok) made.push({ word: verdict.word, move: verdict.move });
    else first ??= verdict;
  }
  const [head, ...rest] = made;
  if (head) return { ok: true, word: head.word, move: head.move, also: rest };
  return first ?? { ok: false, code: 'no-move', reason: { message: says.empty } };
}

/**
 * One reading of a guess: a token that is definitely in this alphabet, judged against the
 * token being stood on.
 *
 * `typed` is what the player actually wrote, and is what every message quotes — nobody wants
 * to be told that `bFe` is not a word. Subwords are the other way round: they are runs of the
 * alphabet with no spelling of their own, so they are quoted through `transcribe`.
 */
function judgeToken(
  graph: Graph,
  from: string,
  word: string,
  typed: string,
  isWord: ((word: string) => boolean) | null,
  lexicon: Lexicon,
): Judgement {
  /** A run of the alphabet, as something a player can read. */
  const say = (sub: string) => (lexicon.translated ? lexicon.transcribe(sub) : sub);
  /** Whether the messages should talk about sounds rather than letters. */
  const phonemes = String(lexicon.translated);

  if (word === from) {
    return {
      ok: false,
      code: 'identical',
      reason: { message: says.identical, values: { from: lexicon.label(from) } },
    };
  }

  // Fast path: a move between two common words, with its subword already known.
  const move = graph.findMove(from, word);
  if (move) return { ok: true, move, word, also: [] };

  const { minWord, minSub } = graph.params;
  const edit = analyzeEdit(from, word);

  // Slow path: any real word is a legal guess, so check the full dictionary.
  //
  // Generous about ambiguity by design. `lifetime` → `lime` could be dropping
  // `ifet` or `feti`; if *any* reading names a real word the move stands, so
  // every reading is tried rather than just the longest or the leftmost.
  if (isWord && (edit.shape === 'add' || edit.shape === 'remove') && word.length >= minWord) {
    const chosen = isWord(word) ? wordReading(edit.spots, minSub, isWord) : undefined;
    if (chosen) {
      return {
        ok: true,
        word,
        move: { to: word, sub: chosen.sub, pos: chosen.pos, kind: edit.shape },
        // One reading of one token. Which *tokens* a spelling names is `judgeGuess`'s
        // question, and it is the one that fills this in.
        also: [],
      };
    }
  }

  // Everything below is explanation only.

  if (edit.shape === 'swap') {
    return {
      ok: false,
      code: 'swap',
      reason: {
        message: says.swap,
        values: { word: typed, from: lexicon.label(from), phonemes },
      },
    };
  }

  if (edit.shape === 'scattered') {
    // Both halves of the sentence turn on the direction, so it is one message with a
    // `select` rather than two verbs spliced into a frame — a frame with a verb slot in
    // it is a sentence only English can be written in.
    return {
      ok: false,
      code: 'scattered',
      reason: {
        message: says.scattered,
        values: { adding: String(edit.direction === 'add'), phonemes },
      },
    };
  }

  if (edit.shape === 'identical') {
    // Unreachable given the equality check above, but keeps the union exhaustive.
    return {
      ok: false,
      code: 'identical',
      reason: { message: says.identicalShort, values: { from: lexicon.label(from) } },
    };
  }

  // Contiguous, so name the run and say what is wrong with it.
  const adding = edit.shape === 'add';
  // Non-empty: `spots.length > 0` is what distinguishes add/remove from scattered.
  const subs = edit.spots.map((s) => s.sub) as [string, ...string[]];

  if (subs.every((s) => s.length < minSub)) {
    return {
      ok: false,
      code: 'sub-too-short',
      reason: {
        message: says.subTooShort,
        values: { sub: say(subs[0]), min: minSub, phonemes },
      },
    };
  }

  if (word.length < minWord) {
    return {
      ok: false,
      code: 'too-short',
      reason: { message: says.tooShort, values: { min: minWord, phonemes } },
    };
  }

  if (isWord && !isWord(word)) {
    return {
      ok: false,
      code: 'not-a-word',
      reason: { message: says.notAWord, values: { word: typed } },
    };
  }

  // `word` is real (or unverifiable) and the edit is one clean run, so the run
  // itself is the problem. Name the reading the player most likely intended.
  const named = bestReading(edit.spots, minSub, isWord).sub;
  if (!isWord || !isWord(named)) {
    return {
      ok: false,
      code: 'sub-not-word',
      reason: {
        message: says.subNotWord,
        values: { adding: String(adding), sub: say(named), phonemes },
      },
    };
  }

  return {
    ok: false,
    code: 'no-move',
    reason: { message: says.noMove, values: { from: lexicon.label(from), word: typed } },
  };
}
