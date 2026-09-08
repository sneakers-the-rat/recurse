/**
 * How a mode's tokens are read and written.
 *
 * A **token** is a node of the graph and the thing every other module here handles: what
 * `graph.ts` indexes, what `plate.ts` draws, what `game.ts` hints at, what `storage.ts` keys
 * by. In the letters mode a token is a spelling and this whole module is the identity
 * function. In the phonemes mode a token is a pronunciation — one character per phoneme, see
 * the builder's phonetic.rs — and the two directions come apart:
 *
 * - `label` and `transcribe` turn a token into something to draw. Several spellings can name
 *   one token (`right`, `rite`, `write`), so one of them is chosen and the rest are still
 *   accepted as guesses.
 * - `parse` turns what somebody typed into the tokens it could be. A spelling with more than
 *   one pronunciation gives more than one, and a guess is legal if **any** of them makes a
 *   move — which is the same generosity `wordReading` already shows about which run of
 *   letters a move removed, one level up.
 *
 * Keeping both directions here is what lets everything else stay alphabet-blind. The one
 * place that cannot be is a message quoting a subword back to the player, which is why
 * `transcribe` is exported rather than only used internally: `/st/` means something to read
 * and `ce` does not.
 */

/** One phoneme, as the builder's `PHONEMES` table ships it. */
export interface Phoneme {
  /** The character a token spells it with. */
  code: string;
  /** How a dictionary would print it. */
  ipa: string;
  /** CMUdict's name for it, for the survey and for anyone reading the data. */
  name: string;
}

export interface Lexicon {
  /**
   * Whether a token needs translating at all. `false` for the letters mode, and the flag
   * every caller should branch on rather than testing the mode's name.
   */
  translated: boolean;
  /** What to draw a token as: a spelling in the phonemes mode, itself in the letters one. */
  label(token: string): string;
  /**
   * How a token is said, as IPA without slashes. Empty when there is nothing to add — the
   * letters mode, or a token the lexicon does not have.
   */
  transcribe(token: string): string;
  /** Every spelling that names this token, most familiar first. */
  labels(token: string): readonly string[];
  /**
   * Does this token have a spelling of its own?
   *
   * False for a run of the alphabet that is not a word — the piece a *refused* guess would have
   * added, say. Callers that want to name a subword ask this first, because `label` falls back
   * to the token and a row of phoneme codes is worse than a transcription.
   */
  knows(token: string): boolean;
  /**
   * The tokens a typed word could be, most familiar first. Empty when the word is not in
   * this alphabet at all, which the caller reports as its own kind of refusal — "we do not
   * know how that is said" is not the same as "that is not a word".
   */
  parse(typed: string): readonly string[];
}

/**
 * The letters mode: a token is a spelling and nothing is translated.
 *
 * Shared rather than constructed per call, because it holds nothing and is compared by
 * identity in a few memo dependency lists.
 */
export const PLAIN: Lexicon = {
  translated: false,
  label: (token) => token,
  transcribe: () => '',
  labels: (token) => [token],
  // A token is its own spelling here, so there is always one to show.
  knows: () => true,
  parse: (typed) => [typed],
};

/** `lexicon.json`, as the builder writes it. See `write_lexicon`. */
export interface RawLexicon {
  /** One row per character a token can hold. The stress distinction is already in them. */
  phonemes: Phoneme[];
  /**
   * One line per dictionary token, in dictionary order: `1` or `0` for whether this is some
   * word's primary pronunciation, then the spellings that name it, best first.
   */
  nodes: string;
  /** One line per spelling, sorted; the token ids it may be said as, tab separated. */
  guesses: string;
}

/**
 * A translated alphabet, from the shipped file and the mode's own dictionary.
 *
 * `words` is the token list — the same array the graph is indexed by — because both halves
 * of the file address tokens by their dictionary position rather than repeating them. That
 * is the same trade the graph rows make, and it means the lexicon costs its spellings and
 * nothing else.
 */
export function buildLexicon(raw: RawLexicon, words: readonly string[]): Lexicon {
  const ipa = new Map<string, string>();
  for (const phoneme of raw.phonemes) ipa.set(phoneme.code, phoneme.ipa);

  // Per token: whether any word says it this way first, and the spellings that say it.
  const primary: boolean[] = [];
  const drawn: string[][] = [];
  for (const line of raw.nodes.split('\n')) {
    const parts = line.split('\t');
    primary.push(parts[0] === '1');
    drawn.push(parts.slice(1));
  }

  const said = new Map<string, string[]>();
  for (const line of raw.guesses.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const spelling = parts[0]!;
    const tokens: string[] = [];
    for (const at of parts.slice(1)) {
      const token = words[Number(at)];
      if (token !== undefined) tokens.push(token);
    }
    if (tokens.length) said.set(spelling, tokens);
  }

  const at = new Map<string, number>();
  for (let i = 0; i < words.length; i++) at.set(words[i]!, i);

  const labelsOf = (token: string): string[] => {
    const found = at.get(token);
    return (found === undefined ? undefined : drawn[found]) ?? [];
  };

  return {
    translated: true,
    /*
      One word if one word honestly says it, otherwise all of them.

      A node that is some spelling's *primary* pronunciation is drawn as that spelling, and
      the homophones are accepted silently — `right`, `rite`, `wright` and `write` are one
      sound and `right` stands for it. A node that is nobody's primary reading has no such
      word: `/kən/` is the second pronunciation of `can`, whose ordinary reading is `/kæn/`,
      so drawing that node as `can` shows a word that does not sound like the board. Those
      are drawn as the whole set — "one of these, said this way" — which is the true answer.

      A token with no line at all is drawn as itself. That is a fragment rather than a node,
      and showing the codes is at least obviously not a word.
    */
    label: (token) => {
      const found = at.get(token);
      if (found === undefined) return token;
      const words = drawn[found] ?? [];
      if (!words.length) return token;
      return primary[found] ? words[0]! : words.join('/');
    },
    // One character in, one symbol out, and no special case: a token *is* the transcription,
    // because the two vowels whose CMUdict digit marks a different sound rather than only
    // emphasis get different characters. So a subword reads as correctly as a whole word,
    // and a partial hint's dots pass straight through.
    transcribe: (token) => {
      let out = '';
      for (const code of token) out += ipa.get(code) ?? code;
      return out;
    },
    labels: (token) => {
      const found = labelsOf(token);
      return found.length ? found : [token];
    },
    knows: (token) => labelsOf(token).length > 0,
    parse: (typed) => said.get(typed) ?? [],
  };
}
