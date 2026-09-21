/**
 * The word a move added or removed, written on the line.
 *
 * Its own component because **which layer it belongs in is the board's decision, not the
 * move's**. On the daily board it sits inside its edge's group: there are a handful of walked
 * moves, the words are far apart, and keeping the label with the line it belongs to is what
 * keeps the group readable as one thing. On a map there are thousands of moves and marks up to
 * seventy units across, and a label drawn with its line goes *under* the next word along — so
 * the map draws every one of them in a layer above the nodes, where nothing can cover them.
 *
 * SVG paints in document order and has no other notion of depth, so "above" means "later", and
 * that means the label has to be separable from the line. Hence this.
 */

import { memo } from 'react';
import { moveSign } from '../marks';
import type { Lexicon } from '../../lib/lexicon';

export const EdgeLabel = memo(function EdgeLabel({
  ax,
  ay,
  bx,
  by,
  kind,
  sub,
  lexicon,
}: {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Which way the letters went, or `made` for a board that does not tell them apart. */
  kind: 'add' | 'remove' | 'made';
  /** The run of letters itself, as a token. */
  sub: string;
  lexicon: Lexicon;
}) {
  return (
    /*
      At the middle of the move, which clears the word it leads to: a name hangs about 25 units
      above its own mark, and at ROW_HEIGHT the midpoint of a spine edge is 40 above, so the two
      miss each other by a comfortable margin. Biasing this toward the upper end was tried, to
      open that margin further, and was worse in the round: two moves out of the same word then
      wrote their subwords on top of *each other*. What is left is the harder case — a diagonal
      edge whose middle happens to fall across some unrelated word's label — and that is a real
      collision in two dimensions, not something a fraction along the line can answer.
    */
    <text
      x={(ax + bx) / 2}
      y={(ay + by) / 2 - 5}
      textAnchor="middle"
      pointerEvents="none"
      className="word"
      fontSize="10"
      fill={kind === 'remove' ? 'var(--color-blood-lit)' : 'var(--color-gilt)'}
      paintOrder="stroke"
      stroke="var(--color-noir)"
      strokeWidth="3"
      strokeLinejoin="round"
    >
      {kind !== 'made' && moveSign(kind)}
      {/*
        The word the move added or removed, spelled.

        A move is a *word* going in or coming out, and the edge is where the game says which —
        so it says it the way the player would write it, not as the run of sounds it is made of.
        A run that is somehow not a word has no spelling and falls back to its transcription; on
        a walked edge that cannot happen, since the move was judged legal to get here.
      */}
      {lexicon.knows(sub) ? (
        lexicon.label(sub)
      ) : (
        // A run that is not a word has no spelling, so this is IPA and wants the face that has
        // the symbols. See `--font-ipa`.
        <tspan className="ipa">{lexicon.transcribe(sub)}</tspan>
      )}
    </text>
  );
});
