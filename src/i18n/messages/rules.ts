/**
 * What one game's own rules page says.
 *
 * **Not the rules of ReCurse** — those are `howto.ts`, they are the same in every game, and
 * they are a dialog over the board because they are read once and dismissed. This is the page
 * behind the `?` on the masthead's mode marker: what is different about *this* game, for the
 * player who has understood the game and not the alphabet. See `ModeRules.tsx`.
 *
 * **One set of messages per game that needs one, and most will not.** The letters game has no
 * page here on purpose: a word is its spelling, which is what anybody assumes, and a page
 * saying so is a page saying nothing. `RULES` in `ModeRules.tsx` is the list, and a mode
 * missing from it simply has no marker on its masthead.
 *
 * **Write a long one across several lines.** `formatjs extract` collapses every run of
 * whitespace and every newline on the way into the catalog, so the indentation of a wrapped
 * template literal never ships — see the note on `no-multiple-whitespaces` in
 * `eslint.config.js`, and `i18n/messages.test.ts`, which asserts it of the built catalog. The
 * rich-text tags are `<w>`, `<add>`, `<cut>` and `<br/>`; it has to be `<br/>` or `<br></br>`
 * and never `<br>`, which ICU reads as an unclosed tag and which fails `i18n:validate` for the
 * whole catalog rather than for the one message.
 */

import { defineMessages } from 'react-intl';

export const rules = defineMessages({
  /** The masthead marker itself, which is the only part of this that is not on the page. */
  marker: {
    id: 'rules.marker',
    defaultMessage: 'Mode: {game}',
    description:
      'On the masthead under the two words: which game this board belongs to. Underlined with a squiggle and followed by a “?” that opens that game’s rules page.',
  },
  open: {
    id: 'rules.open',
    defaultMessage: 'How {game} works',
    description:
      'The “?” beside the mode marker, for a screen reader and as its tooltip. Opens the rules page for that game.',
  },
  back: {
    id: 'rules.back',
    defaultMessage: 'Back to the board',
    description:
      'Leaves the rules page for whatever was being played. Drawn as a “×” — this is the label behind it, so it has to say where shutting the page goes rather than just “close”.',
  },
  missing: {
    id: 'rules.missing',
    defaultMessage: 'There is nothing written down about this game yet.',
    description:
      'Shown when the rules page is opened for a game that has no rules of its own — a stale link, or a mode added since. Not an error: the game is playable and this page simply has nothing in it.',
  },

  /* ---- the phonemes game. Stub: headings are right, sentences are placeholders. ---- */

  phonemesTitle: {
    id: 'rules.phonemesTitle',
    defaultMessage: 'Phoneme mode - Playing by ear',
    description: 'Heading of the phonemes game’s rules page.',
  },
  phonemesIntro: {
    id: 'rules.phonemesIntro',
    defaultMessage:
      `In phoneme mode, additions and removals use the pronunciation of the word rather than its letters:
      <br></br>
      <w>car</w> -> <w>c</w> + <add>robe</add> + <w>ar</w> => <w>crowbar</w>
      <br></br>
      <w><ipa>/kɑɹ/</ipa></w> -> <w><ipa>/k/</ipa></w> + <add><ipa>/ɹoʊb/</ipa></add> + <w><ipa>/ɑɹ/</ipa></w> => <w><ipa>/kɹoʊbɑɹ/</ipa></w>
      <br></br>
      This is an experimental game mode and feedback is welcome!
      `,
    description:
      'Introduction to the game mode',
  },
  phonemesTypingTitle: {
    id: 'rules.phonemesTypingTitle',
    defaultMessage: 'Guessing',
    description: 'Heading: guesses are typed in ordinary spelling and resolved to a sound.',
  },
  phonemesTyping: {
    id: 'rules.phonemesTyping',
    defaultMessage:
      `Guesses are typed in ordinary spelling and resolved to a pronunciation.
      Each spelling resolves to one or multiple pronunciations, 
      and each node represents one pronunciation (shown as the IPA transcription beneath the spelling): 
      homophones are the same move, and the same word may have multiple nodes for its multiple pronunciations.
      `,
    description: 'How a guess is typed and what it resolves to.',
  },
  phonemesWordsTitle: {
    id: 'rules.phonemesWordsTitle',
    defaultMessage: 'Word List',
    description: 'Heading: the thinner word list in this game.',
  },
  phonemesWords: {
    id: 'rules.phonemesWords',
    defaultMessage:
      `This game mode is based off CMUdict to map words to their pronunciation.
      CMUdict is substantially smaller than the real word list, and even some common words lack pronunciation.
      Only words with a valid phonetic transcription can be guessed, which is an unfortunate limitation of the mode.
      <br></br>
      Some pronunciations are dialect and accent specific, and might not sound natural - 
      e.g. "and" has one pronunciation <ipa>/ənd/</ipa> (like "uhnd"), so it can be used to make words like
      <br></br>
      <w>and</w> -> <w>an</w> + <add>occupy</add> + <w>d</w> => <w>unoccupied</w>
      <br></br>
      <w><ipa>/ənd/</ipa></w> -> <w><ipa>/ən/</ipa></w> + <add><ipa>/ɑkjəpaɪ/</ipa></add> + <w><ipa>/d/</ipa></w> => <w><ipa>/ənɑkjəpaɪd/</ipa></w>
      <br></br>
      which is a bit counterintuitive.
      Treat pronunciations as approximate and be prepared to be surprised :)
      `,
    description:
      'Why an ordinary word is sometimes refused in this game and not in the other.',
  },
});
