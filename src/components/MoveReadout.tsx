/**
 * What this guess would do, shown while it is still being typed.
 *
 * One rule keeps it readable: the changed run is always marked inside the
 * *longer* of the two words, and the arrow says which way it goes.
 *
 *     adding    base  →  base⟨ball⟩        run in gilt, arriving
 *     removing  base⟨ball⟩  →  base        run in blood, struck through
 *
 * When the edit is not one clean run there is nothing honest to mark, so the
 * readout says so plainly instead of inventing a highlight.
 *
 * In a translated alphabet the two sides come apart: what is typed is a spelling, what is
 * marked is a pronunciation. So the typed word is resolved to a token first and the readout
 * is drawn in transcription — which works because `transcribe` is a per-character map, so
 * the three pieces either side of the run can each be transcribed and still line up.
 */

import { memo } from 'react';
import { FormattedMessage } from 'react-intl';

import { guess as says } from '../i18n/messages/guess';
import { PLAIN, type Lexicon } from '../lib/lexicon';
import { analyzeEdit, bestReading, judgeGuess } from '../lib/moves';
import type { Graph } from '../lib/types';
import { Diamond, MoveSign, Said, Space } from './marks';

interface Props {
  from: string;
  typed: string;
  /** Consulted so the highlight matches what the game will actually accept. */
  graph: Graph;
  /** The full word list, once loaded; sharpens which reading is shown. */
  isWord?: ((word: string) => boolean) | null;
  /** How a typed word becomes a token, and how a token is read back. See lib/lexicon.ts. */
  lexicon?: Lexicon;
  /** Dim the whole readout once the guess has been rejected. */
  muted?: boolean;
}

function Marked({
  word,
  pos,
  length,
  tone,
  struck,
  read,
  face,
}: {
  word: string;
  pos: number;
  length: number;
  tone: 'gilt' | 'blood';
  struck?: boolean;
  /** Turns one piece of a token into something readable. Identity in the letters game. */
  read: (piece: string) => string;
  /** `ipa` in the phonemes game, where every piece of this is a transcription. */
  face: string;
}) {
  const colour = tone === 'gilt' ? 'text-gilt' : 'text-blood-lit';
  return (
    <span className={`word ${face}`}>
      <span>{read(word.slice(0, pos))}</span>
      <span className={`${colour} ${struck ? 'line-through decoration-1' : ''}`}>
        {read(word.slice(pos, pos + length))}
      </span>
      <span>{read(word.slice(pos + length))}</span>
    </span>
  );
}

/** The same ornament the statement sets between the two words, in the readout's ink. */
function Arrow() {
  return <Diamond className="text-ash-lit mx-2 shrink-0 text-xs tracking-widest" />;
}

export const MoveReadout = memo(function MoveReadout({
  from,
  typed,
  graph,
  isWord = null,
  muted = false,
  lexicon = PLAIN,
}: Props) {
  const read = (piece: string) => (lexicon.translated ? lexicon.transcribe(piece) : piece);
  /*
    Everything this readout draws is a *token* — the word stood on, the word typed, the piece
    between them — and in the phonemes game a token is drawn as its transcription. Which means
    all of it wants the IPA face, and none of it does in the letters game, where `read` is the
    identity and these are ordinary spellings. See `--font-ipa`.
  */
  const face = lexicon.translated ? 'ipa' : '';
  const raw = typed.trim().toLowerCase();

  /*
    Which reading of the typed spelling to describe — and **the judge decides, not this.**

    A word said two ways gives two tokens and only one of them is usually a move. Picking the
    first and describing that is how the readout came to say "not one run" underneath a word
    that plays perfectly well: from `bears` the first reading of `barons` is `/bæɹənz/`, which
    is not a move, while `/bɛɹənz/` is, and the guess would have been accepted the moment it
    was submitted. A readout that contradicts the game is worse than no readout — it is read
    as the answer.

    So the whole question goes to `judgeGuess`, which is the one thing that knows what would
    be accepted, and the accepted reading is what gets drawn. Only when nothing plays does the
    readout fall back to the most familiar one and explain *that* — which is the reading the
    player most likely meant, and the one a refusal will quote too.
  */
  const verdict = judgeGuess(graph, from, raw, isWord, lexicon);
  const word = (verdict.ok ? verdict.word : lexicon.parse(raw)[0]) ?? '';

  if (!raw || word === from) {
    return (
      <p className="label" aria-live="polite">
        <FormattedMessage {...(word === from && raw ? says.unchanged : says.prompt)} />
      </p>
    );
  }

  // Not a word in this alphabet yet, so there is no move to describe.
  if (!word) {
    return (
      <p className="label" aria-live="polite">
        <FormattedMessage {...says.prompt} />
      </p>
    );
  }

  const edit = analyzeEdit(from, word);
  const dim = muted ? 'opacity-55' : '';

  if (edit.shape === 'add' || edit.shape === 'remove') {
    // Exactly the reading the game accepted, which is the move the judge already worked out —
    // including one it found the slow way, through the full dictionary, where asking the
    // common graph would have come back empty and sent this to `bestReading` to guess at.
    // Only when nothing plays is there an intent to guess at.
    const { pos, sub } = verdict.ok
      ? verdict.move
      : bestReading(edit.spots, graph.params.minSub, isWord);
    const adding = edit.shape === 'add';
    const longer = adding ? word : from;
    const shorter = adding ? from : word;

    return (
      <p
        className={`flex flex-wrap items-baseline text-lg sm:text-xl ${dim}`}
        aria-live="polite"
      >
        {adding ? (
          <>
            <span className={`word ${face} text-bone-dim`}>{read(shorter)}</span>
            <Arrow />
            <Marked word={longer} pos={pos} length={sub.length} tone="gilt" read={read} face={face} />
          </>
        ) : (
          <>
            <Marked
              word={longer}
              pos={pos}
              length={sub.length}
              tone="blood"
              struck
              read={read}
              face={face}
            />
            <Arrow />
            <span className={`word ${face} text-bone`}>{read(shorter)}</span>
          </>
        )}
        {/*
          The piece, named the way the player would have to type it and then said.

          A move adds or removes a *word*, and in the phonemes game that word has a spelling of
          its own — `+ stern /stɚn/`. Showing only the transcription left the one part of the
          move that is a word looking like the one part that is not. A run that is *not* a word
          — the reading a refused guess most likely meant — has no spelling to give, and falls
          back to the transcription alone.
        */}
        <span className={`label ml-3 ${adding ? 'text-gilt' : 'text-blood-lit'}`}>
          <MoveSign kind={adding ? 'add' : 'remove'} />
          {lexicon.translated && lexicon.knows(sub) ? (
            <>
              {lexicon.label(sub)}
              <Space />
              {/*
                `.ipa` sets the face that has the symbols and, just as importantly, turns off
                the uppercasing `.label` puts on everything around it: IPA is case-significant,
                and `/ən/` came out `/ƏN/` — a schwa nobody writes and a capital N that is not
                a symbol at all. The spelling beside it is a label and is right in caps.
              */}
              <span className="text-ash-lit ipa">
                <Said>{read(sub)}</Said>
              </span>
            </>
          ) : (
            <span className="ipa">{read(sub)}</span>
          )}
        </span>
      </p>
    );
  }

  if (edit.shape === 'swap') {
    return (
      <p className={`text-bone-dim text-lg sm:text-xl ${dim}`} aria-live="polite">
        <span className={`word ${face}`}>{read(from)}</span>
        <Arrow />
        <span className={`word ${face}`}>{read(word)}</span>
        <span className="label text-blood-lit ml-3">
          <FormattedMessage {...says.sameLength} />
        </span>
      </p>
    );
  }

  // Scattered: the letters would change in more than one place.
  return (
    <p className={`text-bone-dim text-lg sm:text-xl ${dim}`} aria-live="polite">
      <span className={`word ${face}`}>{read(from)}</span>
      <Arrow />
      <span className={`word ${face}`}>{read(word)}</span>
      <span className="label text-blood-lit ml-3">
        <FormattedMessage {...says.notOneRun} />
      </span>
    </p>
  );
});
