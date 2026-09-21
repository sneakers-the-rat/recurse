/**
 * How a word gives itself up, a letter at a time.
 *
 * What a hint *is* — a count, then letters, in an order that is a function of the word — is a
 * fact about a word rather than about a board, and both games ask it. The daily game sells
 * levels one click at a time and the explore mode sells only the first, so what they share is
 * exactly this file: the levels a word has, what each one shows, and when there is nothing
 * left to sell. Who may buy one, and at what price, belongs to whoever is running the game.
 */

/**
 * The order in which a word gives its letters up.
 *
 * Scattered, not front to back. A prefix is the one part of a word this game must
 * not hand over cheaply — words live inside other words, so `car·······` names the
 * family and most of the answer with it. A letter from the middle is a clue; the
 * first three letters are the solution.
 *
 * A function of the word, not a draw from `Math.random()`, because the order has to
 * be the same every time it is asked for. Two places depend on that:
 *
 * - A reload has to redraw the board exactly. The snapshot stores a level per word
 *   and nothing else, so the positions have to be recoverable from the word.
 * - `hintLabel` is called while rendering each node, so it has to be pure. Drawing
 *   at random per call would give the same word different letters from one render to
 *   the next, and the board re-renders whenever the layout is moving.
 *
 * The alternative is to choose positions at click time and store them in the
 * snapshot, which would make two players see a word differently. It costs a storage
 * version and a longer snapshot, and buys nothing this needs.
 */
const orders = new Map<string, number[]>();

function revealOrder(word: string): number[] {
  const cached = orders.get(word);
  if (cached) return cached;

  // FNV-1a, then xorshift32: a couple of lines of arithmetic that scatter well
  // enough for this. Nothing here is a secret — the point is an order that looks
  // arbitrary and stays put, not one nobody can predict.
  let seed = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    seed = ((seed ^ word.charCodeAt(i)) * 0x01000193) >>> 0;
  }
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };

  const order = [...word].map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  orders.set(word, order);
  return order;
}

/**
 * How a word is *spelled*, for the purpose of hinting at it.
 *
 * **Hints are always about letters, in every game.** In the phonemes game a node is a
 * pronunciation, and everything else about it — the move, the graph, what a guess resolves to
 * — is phonemes; a hint is the exception, and has to be, because a hint is help naming the
 * word and nobody knows how many phonemes `thought` has or what `/θɔt/` looks like. Counting
 * five sounds at somebody is a riddle about IPA rather than a clue about the word.
 *
 * So everything below takes the *written* form, and the caller says what that is. The default
 * is the identity, which is exactly right for the letters game and is why nothing there — nor
 * any test written before this existed — has to know the seam is here at all. The phonemes
 * game passes `lexicon.label`.
 */
export type Spell = (word: string) => string;

export const ITSELF: Spell = (word) => word;

/**
 * What a hint level gives away, and so what a click buys.
 *
 * Level 1 is the letter count. Every level after that turns up one more letter, in
 * the word's own scattered order, so level `1 + n` shows `n` letters and the last
 * level shows the lot. Progressive on purpose: a letter count is often all anyone
 * needs to place a word, and someone properly stuck can keep asking until the word
 * is simply there.
 *
 * **Takes the written form**, not the token — see `Spell`. The scattered order is a function
 * of the string it is given, so it scatters the *letters* and stays put across reloads for the
 * same reason it always did.
 */
export function hintLabel(word: string, level: number): string | null {
  if (level <= 0) return null;
  if (level === 1) return String(word.length);
  const shown = new Set(revealOrder(word).slice(0, Math.min(level - 1, word.length)));
  return [...word].map((letter, i) => (shown.has(i) ? letter : '·')).join('');
}

/**
 * Levels a word has to give: the count, then one per letter.
 *
 * Of the *written* form, which in the phonemes game is longer or shorter than the token it is
 * drawn for — `thought` is seven letters and three phonemes. Every cap on a level goes through
 * here, so the tally and what the board draws cannot disagree about when a word is spent.
 */
export function hintLevels(word: string, spell: Spell = ITSELF): number {
  return 1 + spell(word).length;
}

/** Has this word been spelled out completely? */
export function fullyHinted(word: string, level: number, spell: Spell = ITSELF): boolean {
  return level >= hintLevels(word, spell);
}
