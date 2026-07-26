/**
 * Judging a typed guess, and explaining it when it fails.
 *
 * Legality is decided by the edge list (see graph.ts). Everything here beyond
 * that lookup exists to turn a rejection into a sentence the player can act on
 * — especially the case the original build silently swallowed, where letters
 * arrive in two separate places so no single word was ever inserted.
 */

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

/**
 * Pick which reading of an ambiguous edit to show the player.
 *
 * Removing letters is often ambiguous: `lifetime` → `lime` could be dropping
 * `ifet` or `feti`. The game is generous — if *any* reading is a legal word the
 * move counts — so the display has to agree with that rather than showing an
 * arbitrary slice. Preference order: a reading that is actually a word, then a
 * legal-length one, then the longest.
 */
export function bestReading(
  spots: readonly InsertionSpot[],
  minSub: number,
  isWord: ((word: string) => boolean) | null,
): InsertionSpot {
  const longest = [...spots].sort((a, b) => b.sub.length - a.sub.length || a.pos - b.pos);
  const legal = longest.filter((s) => s.sub.length >= minSub);
  if (isWord) {
    const real = legal.find((s) => isWord(s.sub));
    if (real) return real;
  }
  return legal[0] ?? longest[0]!;
}

export interface MoveSegments {
  kind: 'add' | 'remove';
  shorter: string;
  longer: string;
  before: string;
  sub: string;
  after: string;
}

/**
 * Split the longer word around the subword, so the UI can render
 * `base[ball]` with the arriving or departing letters marked.
 */
export function moveSegments(from: string, to: string, move: Move): MoveSegments {
  const longer = move.kind === 'add' ? to : from;
  const shorter = move.kind === 'add' ? from : to;
  return {
    kind: move.kind,
    shorter,
    longer,
    before: longer.slice(0, move.pos),
    sub: longer.slice(move.pos, move.pos + move.sub.length),
    after: longer.slice(move.pos + move.sub.length),
  };
}

/**
 * Judge a guess made from the word `from`.
 *
 * Legality has two sources, and they are not the same thing:
 *
 *  - the shipped edge list, covering the ~20k common words puzzles are built
 *    from. Available immediately, and it carries the exact subword and position.
 *  - `isWord`, the full ~189k dictionary. Any real word is a legal guess, so a
 *    move it accepts is legal even though it never appears on the board.
 *    Ordinary words like `lifespan` live here, outside the common corpus.
 *
 * The edge list is tried first because it is loaded first and is cheaper. Until
 * the dictionary arrives, wording avoids asserting anything it cannot check.
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
    if (isWord(word)) {
      const valid = edit.spots.filter((s) => s.sub.length >= minSub && isWord(s.sub));
      const chosen = valid.sort((a, b) => b.sub.length - a.sub.length || a.pos - b.pos)[0];
      if (chosen) {
        return {
          ok: true,
          word,
          move: { to: word, sub: chosen.sub, pos: chosen.pos, kind: edit.shape },
        };
      }
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
      detail: edit,
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
      detail: edit,
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
      detail: { ...edit, sub: subs[0] },
    };
  }

  if (word.length < minWord) {
    return {
      ok: false,
      code: 'too-short',
      message: `Words in this puzzle are at least ${minWord} letters.`,
      detail: edit,
    };
  }

  if (isWord && !isWord(word)) {
    return { ok: false, code: 'not-a-word', message: `${word} isn’t in the word list.`, detail: edit };
  }

  // `word` is real (or unverifiable) and the edit is one clean run, so the run
  // itself is the problem. Name the reading the player most likely intended.
  const named = bestReading(edit.spots, minSub, isWord).sub;
  if (!isWord || !isWord(named)) {
    return {
      ok: false,
      code: 'sub-not-word',
      message: `That would ${adding ? 'add' : 'remove'} “${named}”, which isn’t a word.`,
      detail: { ...edit, sub: named },
    };
  }

  return {
    ok: false,
    code: 'no-move',
    message: `No legal move gets from ${from} to ${word}.`,
    detail: edit,
  };
}
