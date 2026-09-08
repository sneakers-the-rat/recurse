/**
 * The client's half of the lexicon contract.
 *
 * The shapes here are written by `write_lexicon` in the builder's main.rs, and the two have to
 * agree about three things: that a line's *position* is its token's dictionary index, that
 * fields within a line are tab separated, and that a token is one character per phoneme. Each
 * of those is asserted below, because none of them is checked by a type and all of them fail
 * silently — a board of `undefined`, or a word drawn as its codes.
 */

import { describe, expect, it } from 'vitest';
import { buildLexicon, PLAIN, type RawLexicon } from './lexicon';

/** Enough of the table to spell the words below. */
const PHONEMES = [
  { code: 'b', ipa: 'ɹ', name: 'R' },
  { code: 'F', ipa: 'aɪ', name: 'AY' },
  { code: 'e', ipa: 't', name: 'T' },
  { code: 'K', ipa: 'ɛ', name: 'EH' },
  { code: 'I', ipa: 'd', name: 'D' },
  { code: 'R', ipa: 'i', name: 'IY' },
  { code: 'C', ipa: 'ə', name: 'AH' },
  // The stressed reading of the same phoneme. Same length, different character: this is what
  // a *display* token uses, and what stops every STRUT vowel printing as a schwa.
  { code: 'n', ipa: 'ʌ', name: 'AH1' },
];

// Four tokens. `bFe` is said by four spellings; `read` says two of them; `bCe` is nobody's
// primary reading — the way `/kən/` is `can`'s second pronunciation and nothing's first.
const WORDS = ['bCe', 'bFe', 'bKI', 'bRI'];

const RAW: RawLexicon = {
  phonemes: PHONEMES,
  nodes: [
    '0\trut\troot',
    '1\tright\trite\twright\twrite',
    '1\tread\tred',
    '1\tread\treed',
  ].join('\n'),
  guesses: [
    'read\t2\t3',
    'red\t2',
    'reed\t3',
    'right\t1',
    'rite\t1',
    'root\t0',
    'rut\t0',
    'wright\t1',
    'write\t1',
  ].join('\n'),
};

describe('buildLexicon', () => {
  const lex = buildLexicon(RAW, WORDS);

  it('draws a token as the first spelling on its line', () => {
    // Position is the whole index: line 0 is token 0. The builder writes them in dictionary
    // order for exactly this reason, and getting it wrong shifts every label by one.
    expect(lex.label('bFe')).toBe('right');
    expect(lex.label('bKI')).toBe('read');
    expect(lex.labels('bFe')).toEqual(['right', 'rite', 'wright', 'write']);
  });

  it('shows every word when the sound is nobody\'s ordinary reading', () => {
    // `/kən/` is the second pronunciation of `can` and of `con` and of a dozen more, and the
    // first of none of them. Drawing it as any one word shows something that does not sound
    // like the board, so it is drawn as the set.
    expect(lex.label('bCe')).toBe('rut/root');
  });

  it('reads the two vowels whose digit is a sound as two sounds', () => {
    // `/ɹət/` and `/ɹʌt/` are different words said differently, so they are different tokens
    // and read differently. There is no second string to reconcile: the token is what a
    // dictionary would print.
    expect(lex.transcribe('bCe')).toBe('ɹət');
    expect(lex.transcribe('bne')).toBe('ɹʌt');
  });

  it('reads a token one character per phoneme', () => {
    expect(lex.transcribe('bFe')).toBe('ɹaɪt');
    // A digraph is one code and two characters out, which is the reason the codes exist: byte
    // arithmetic on the IPA would cut `aɪ` in half.
    expect(lex.transcribe('bFe').length).toBeGreaterThan('bFe'.length);
  });

  it('passes through anything that is not a phoneme', () => {
    // What a partial hint looks like: `hintLabel` dots out the sounds not yet bought, and the
    // dots have to survive being read. `transcribe` is a per-character map with a fallback,
    // which is what makes that work without a second code path.
    expect(lex.transcribe('·F·')).toBe('·aɪ·');
  });

  it('resolves a spelling to every token it could be', () => {
    // `read` is said two ways, and both are real nodes. A guess is legal if either makes a
    // move, which is why this is a list rather than a best guess.
    expect(lex.parse('read')).toEqual(['bKI', 'bRI']);
    // Homophones resolve to the one node they share.
    expect(lex.parse('write')).toEqual(['bFe']);
    expect(lex.parse('rite')).toEqual(['bFe']);
  });

  it('says whether a run of sounds is a word with a spelling of its own', () => {
    // What the edge label and the guess readout ask before naming a subword: a move adds a
    // *word* and says which, but the reading a refused guess most likely meant is often not
    // one, and it has only its transcription.
    expect(lex.knows('bFe')).toBe(true);
    expect(lex.knows('bF')).toBe(false);
    expect(PLAIN.knows('anything')).toBe(true);
  });

  it('gives nothing back for a word it has no pronunciation for', () => {
    // Not the same as "not a word" — see the `unknown-sound` refusal in moves.ts.
    expect(lex.parse('abaciscus')).toEqual([]);
  });

  it('ignores an index the dictionary does not have', () => {
    // The two files disagreeing is a broken build, and the symptom of trusting it is
    // `undefined` on the board. Dropped rather than carried.
    const broken = buildLexicon({ ...RAW, guesses: 'ghost\t99' }, WORDS);
    expect(broken.parse('ghost')).toEqual([]);
  });
});

describe('PLAIN', () => {
  it('is the identity, so nothing above it has to know an alphabet exists', () => {
    expect(PLAIN.translated).toBe(false);
    expect(PLAIN.label('baseball')).toBe('baseball');
    expect(PLAIN.labels('baseball')).toEqual(['baseball']);
    expect(PLAIN.parse('baseball')).toEqual(['baseball']);
    // Nothing to say twice: the plate draws one line in the letters game.
    expect(PLAIN.transcribe('baseball')).toBe('');
  });
});
