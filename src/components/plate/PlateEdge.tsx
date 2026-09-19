/**
 * One move on a plate, drawn as a line.
 *
 * Memoised for the same reason `PlateNode` is, and more urgently: a board has more edges than
 * words, each of them is three to seven elements, and both were being rebuilt in full on every
 * frame of a settle and every frame of a pan. Unlike a node, an edge's geometry *is* its
 * position, so there is no outer group to hoist it onto — what is passed instead is the two
 * endpoints as four numbers, which compare by value and so hold the memo while nothing moves.
 *
 * **The grammar is the move's.** Gilt means letters arriving, blood means letters leaving, and
 * a line the player has walked says which by its colour and writes the word on itself. An
 * unwalked move is a hairline in the faintest ink there is: a background of possibilities.
 * Everything else here is emphasis a particular board asks for, and every one of them is
 * optional — an open board passes none of them and gets the two states above.
 */

import { memo } from 'react';
import { EdgeLabel } from './EdgeLabel';
import type { Lexicon } from '../../lib/lexicon';

export const PlateEdge = memo(function PlateEdge({
  ax,
  ay,
  bx,
  by,
  walked,
  bothKnown,
  live = false,
  lifted = false,
  ahead = false,
  golden = false,
  shortcut = false,
  sprouting = false,
  delay = 0,
  draw = 0,
  sub = null,
  lexicon,
  onEnter,
  onLeave,
}: {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /**
   * The move was made, and which way the letters went. Null for one merely available.
   *
   * **`made` is the third answer, for a board that does not ask.** Gilt means letters arriving
   * and blood means letters leaving, and that grammar is worth its ink on a daily board, where
   * a round is a handful of moves and which way each one went is half of what was played. An
   * open map is thousands of them and the direction of any one says nothing about the map — so
   * it draws every move it has walked in one colour, and writes the word without a sign in
   * front of it. The word is the discovery; whether it went in or came out is arithmetic.
   */
  walked: 'add' | 'remove' | 'made' | null;
  /** Both ends named, so this is a move between two things the player has. */
  bothKnown: boolean;
  /** A move available right now, from where the player is standing. */
  live?: boolean;
  /** The pointer is on this move, or on a word it touches. */
  lifted?: boolean;
  /** On the way from the hovered word to the goal. */
  ahead?: boolean;
  /** Part of a route that beat par: the whole line glows, not any one move on it. */
  golden?: boolean;
  /** A move on a shortcut the player has found an end of. */
  shortcut?: boolean;
  /**
   * This move is reaching out from a word that has just arrived.
   *
   * The line draws itself from one end to the other rather than appearing. `delay` is when it
   * starts — which is not until the word at its far end is most of the way to where it is going,
   * or the line reads as having been there first with the word sliding down it — and `draw` is
   * how long it takes. Both per edge, from `sprout.ts`. The animation is entirely `index.css`'s,
   * which is also where `prefers-reduced-motion` turns it off.
   */
  sprouting?: boolean;
  delay?: number;
  draw?: number;
  /**
   * The run of letters the move added or removed. Written on the line, for a move that was
   * made and for no other — the label is the record of a move, and naming a subword on a move
   * nobody has played would be a free hint.
   *
   * Passed as the token rather than as finished markup, which is not fussiness: a label built
   * by the caller is a fresh element every render, and a fresh prop is an edge that redraws on
   * every frame — which is the whole thing this memo exists to stop.
   */
  sub?: string | null;
  /**
   * How a token is written. A stable object per mode, so the memo above still holds.
   *
   * Absent on a board that draws its labels in a layer of its own — see `EdgeLabel`, and the
   * layer above the nodes in `AtlasPlate`.
   */
  lexicon?: Lexicon | undefined;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const stroke = walked
    ? walked === 'remove'
      ? 'var(--color-blood-lit)'
      : 'var(--color-gilt)'
    : bothKnown
      ? 'var(--color-ash-lit)'
      : 'var(--color-rule)';

  const lines = (
    <>
      {shortcut && (
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="var(--color-gilt)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      )}
      {ahead && !walked && (
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="var(--color-gilt)"
          strokeWidth="5"
          strokeLinecap="round"
          opacity="0.18"
        />
      )}
      {golden && (
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="var(--color-gilt)"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.22"
        />
      )}
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        // The one line the sprout animation draws; see `.tendril .reach` in index.css. The
        // overlays above it and the hit area below are left alone — a hit area that arrived
        // late would be a move you could see and not point at.
        {...(sprouting ? { className: 'reach', pathLength: 1 } : {})}
        stroke={
          golden
            ? 'var(--color-gilt)'
            : ahead && !walked
              ? 'var(--color-gilt)'
              : lifted && !walked
                ? 'var(--color-bone-dim)'
                : stroke
        }
        strokeWidth={walked ? (golden ? 2 : 1.6) : ahead ? 1.8 : lifted ? 1.8 : 1}
        opacity={ahead || lifted ? 1 : walked ? 1 : bothKnown ? 0.9 : live ? 0.85 : 0.6}
      />
      {/*
        A grabbable edge. The drawn line is one unit wide, which no pointer
        can reliably land on, so the thing that answers the mouse is a fat
        transparent line on top of it. Stroke rather than fill, because a line
        has no interior to hit.
      */}
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke="transparent"
        strokeWidth="11"
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
      />
      {sub !== null && walked !== null && lexicon !== undefined && (
        <EdgeLabel ax={ax} ay={ay} bx={bx} by={by} kind={walked} sub={sub} lexicon={lexicon} />
      )}
    </>
  );

  /*
    A group **only when there is something to hang on it.**

    The sprout animation needs an element to carry its class and its delay, and a board that is
    not sprouting needs no such element — so wrapping unconditionally would put an extra node
    under every edge of every board, including the daily one, which has more edges than words
    and redraws them on every frame of a settle. Measured against the board before this
    existed, that was 27 extra elements on a par-3 figure and 43 on a par-8.
  */
  return sprouting ? (
    <g
      className="tendril"
      style={
        {
          '--delay': `${Math.round(delay)}ms`,
          ...(draw > 0 ? { '--draw': `${Math.round(draw)}ms` } : {}),
        } as React.CSSProperties
      }
    >
      {lines}
    </g>
  ) : (
    lines
  );
});
