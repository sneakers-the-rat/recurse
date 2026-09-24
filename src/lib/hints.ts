/**
 * How a word gives itself up as hints: a letter count, then one letter at a time.
 *
 * Shared by both games. Who may buy a hint, and for what, is the game's business.
 */

/**
 * The order a word gives its letters up in. Scattered, because a prefix names most of the
 * answer. Derived from the word so it is the same on every render and after a reload, since a
 * snapshot stores only a level per word.
 */
const orders = new Map<string, number[]>();

function revealOrder(word: string): number[] {
  const cached = orders.get(word);
  if (cached) return cached;

  // FNV-1a seeding xorshift32. Stable, not secret.
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
 * A token's written form. Hints are letters in every game, so the phonemes game passes
 * `lexicon.label`; the default is the identity.
 */
export type Spell = (word: string) => string;

export const ITSELF: Spell = (word) => word;

/**
 * What a hint level shows, given the written form. Level 1 is the letter count; level `1 + n`
 * shows `n` letters in `revealOrder`.
 */
export function hintLabel(word: string, level: number): string | null {
  if (level <= 0) return null;
  if (level === 1) return String(word.length);
  const shown = new Set(revealOrder(word).slice(0, Math.min(level - 1, word.length)));
  return [...word].map((letter, i) => (shown.has(i) ? letter : '·')).join('');
}

/** Levels a word has: the count, then one per letter of its written form. */
export function hintLevels(word: string, spell: Spell = ITSELF): number {
  return 1 + spell(word).length;
}

export function fullyHinted(word: string, level: number, spell: Spell = ITSELF): boolean {
  return level >= hintLevels(word, spell);
}
