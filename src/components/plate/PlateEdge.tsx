/**
 * One move on a plate, drawn as a line.
 *
 * Memoised, with the endpoints passed as four numbers so the memo holds while nothing moves.
 * A walked move is gilt if letters were added and blood if removed, with its subword written on
 * it; an unwalked move is a faint hairline. The other flags are emphasis a board may ask for.
 *
 * Faintness is `stroke-opacity`, never `opacity`: `opacity` makes each line its own compositing
 * layer, which is expensive on a map with thousands of moves.
 */

import { memo } from 'react';
import { EdgeLabel } from './EdgeLabel';
import type { Lexicon } from '../../lib/lexicon';

/** Stroke opacity of a `quiet` move. */
const GROUND = 0.3;

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
   * Which way the letters went on a move that was made, or null for one merely available.
   * `made` is a made move with no direction shown, as the open map draws them.
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
   * The line draws itself in, starting after `delay` and taking `draw` ms, both from
   * `sprout.ts`. The animation is `.tendril .reach` in index.css.
   */
  sprouting?: boolean;
  delay?: number;
  draw?: number;
  /**
   * The subword, as a token, written on a made move only (on an unmade one it would be a free
   * hint). A token rather than markup so the memo holds.
   */
  sub?: string | null;
  /** Absent on a board that draws its labels in a layer of its own; see `EdgeLabel`. */
  lexicon?: Lexicon | undefined;
  /** Handed the event so `held` in usePointing can ignore a pointer with a button down. */
  onEnter: (at: React.PointerEvent) => void;
  onLeave: (at: React.PointerEvent) => void;
}) {
  const stroke = walked
    ? walked === 'remove'
      ? 'var(--color-blood-lit)'
      : 'var(--color-gilt)'
    : bothKnown
      ? 'var(--color-ash-lit)'
      : 'var(--color-rule)';

  // The map draws thousands of made moves, so they are dimmed until pointed at.
  const quiet = walked === 'made' && !lifted;

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
          strokeOpacity="0.18"
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
          strokeOpacity="0.22"
        />
      )}
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        // Only this line is animated; the hit area below is live from the start.
        {...(sprouting ? { className: 'reach', pathLength: 1 } : {})}
        stroke={
          golden
            ? 'var(--color-gilt)'
            : ahead && !walked
              ? 'var(--color-gilt)'
              : lifted && !walked
                ? 'var(--color-bone-dim)'
                : quiet
                  ? 'var(--color-gilt-dim)'
                  : stroke
        }
        strokeWidth={walked ? (golden ? 2 : quiet ? 1 : 1.6) : ahead ? 1.8 : lifted ? 1.8 : 1}
        strokeOpacity={
          quiet
            ? GROUND
            : ahead || lifted
              ? 1
              : walked
                ? 1
                : bothKnown
                  ? 0.9
                  : live
                    ? 0.85
                    : 0.6
        }
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

  // Wrapped only while sprouting, to carry the animation's class and timing.
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
