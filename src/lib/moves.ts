/**
 * Judging a typed guess, and explaining it when it fails.
 *
 * Legality is decided by the edge list (see graph.ts). Everything here beyond
 * that lookup exists to turn a rejection into a sentence the player can act on
 * — especially the case the original build silently swallowed, where letters
 * arrive in two separate places so no single word was ever inserted.
 */

import type { EditShape, Graph, InsertionSpot, Judgement } from './types';

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
 */
export function judgeGuess(
  graph: Graph,
  from: string,
  raw: string,
  isWord: ((word: string) => boolean) | null = null,
): Judgement {
  const word = String(raw ?? '').trim().toLowerCase();

  if (!word) return { ok: false, code: 'empty', message: 'Type a word.' };
  if (!/^[a-z]+$/.test(word)) {
    return {
      ok: false,
      code: 'not-letters',
      message: 'Letters only — no spaces, digits or punctuation.',
    };
  }
  if (word === from) {
    return {
      ok: false,
      code: 'identical',
      message: `That’s still ${from}. Add or remove a word to change it.`,
    };
  }

  // Fast path: a move between two common words, with its subword already known.
  const move = graph.findMove(from, word);
  if (move) return { ok: true, move, word };

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
      };
    }
  }

  // Everything below is explanation only.

  if (edit.shape === 'swap') {
    return {
      ok: false,
      code: 'swap',
      message:
        `${word} is the same length as ${from}. Each turn you add a whole word ` +
        `or remove one — you can’t swap letters.`,
    };
  }

  if (edit.shape === 'scattered') {
    const verb = edit.direction === 'add' ? 'added' : 'removed';
    const inf = edit.direction === 'add' ? 'add' : 'remove';
    return {
      ok: false,
      code: 'scattered',
      message:
        `Those letters would be ${verb} in more than one place. The word you ` +
        `${inf} has to be a single unbroken run.`,
    };
  }

  if (edit.shape === 'identical') {
    // Unreachable given the equality check above, but keeps the union exhaustive.
    return { ok: false, code: 'identical', message: `That’s still ${from}.` };
  }

  // Contiguous, so name the run and say what is wrong with it.
  const adding = edit.shape === 'add';
  // Non-empty: `spots.length > 0` is what distinguishes add/remove from scattered.
  const subs = edit.spots.map((s) => s.sub) as [string, ...string[]];

  if (subs.every((s) => s.length < minSub)) {
    return {
      ok: false,
      code: 'sub-too-short',
      message:
        `“${subs[0]}” is too short — the word you add or remove needs at least ` +
        `${minSub} letters.`,
    };
  }

  if (word.length < minWord) {
    return {
      ok: false,
      code: 'too-short',
      message: `Words in this puzzle are at least ${minWord} letters.`,
    };
  }

  if (isWord && !isWord(word)) {
    return { ok: false, code: 'not-a-word', message: `${word} isn’t in the word list.` };
  }

  // `word` is real (or unverifiable) and the edit is one clean run, so the run
  // itself is the problem. Name the reading the player most likely intended.
  const named = bestReading(edit.spots, minSub, isWord).sub;
  if (!isWord || !isWord(named)) {
    return {
      ok: false,
      code: 'sub-not-word',
      message: `That would ${adding ? 'add' : 'remove'} “${named}”, which isn’t a word.`,
    };
  }

  return {
    ok: false,
    code: 'no-move',
    message: `No legal move gets from ${from} to ${word}.`,
  };
}
