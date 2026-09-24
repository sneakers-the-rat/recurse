/**
 * The word a move added or removed, written on the line.
 *
 * Separate from `PlateEdge` so a board can choose its layer: the daily board draws it inside the
 * edge's group, the map in a layer after the words so no mark covers it.
 */

import { memo } from 'react';
import { moveSign } from '../marks';
import type { Lexicon } from '../../lib/lexicon';
import { labelAlong } from '../../lib/sizes';
import type { Point } from '../../lib/types';

/** Where on the line the word goes. Also used by the map to move the label between renders. */
export function labelSpot(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  ar = 0,
  br = 0,
): Point {
  const dx = bx - ax;
  const dy = by - ay;
  const span = Math.hypot(dx, dy) || 1;
  const along = labelAlong(span, ar, br);
  // Raised a little so the line does not strike through the word.
  return { x: ax + (dx / span) * along, y: ay + (dy / span) * along - 5 };
}

export const EdgeLabel = memo(function EdgeLabel({
  ax,
  ay,
  bx,
  by,
  ar = 0,
  br = 0,
  kind,
  sub,
  lexicon,
}: {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** How much room the word at each end takes. See `labelAlong` in lib/sizes.ts. */
  ar?: number;
  br?: number;
  /** Which way the letters went, or `made` for a board that does not tell them apart. */
  kind: 'add' | 'remove' | 'made';
  /** The run of letters itself, as a token. */
  sub: string;
  lexicon: Lexicon;
}) {
  const at = labelSpot(ax, ay, bx, by, ar, br);
  return (
    <text
      x={at.x}
      y={at.y}
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
      {lexicon.knows(sub) ? (
        lexicon.label(sub)
      ) : (
        // A run that is not a word has no spelling, so it is shown as IPA.
        <tspan className="ipa">{lexicon.transcribe(sub)}</tspan>
      )}
    </text>
  );
});
