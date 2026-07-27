/**
 * The plate: every move worth knowing about, drawn as one figure.
 *
 * Visual grammar, quietest to loudest:
 *
 *   unrevealed     a small ash dot — a word that exists here and is unnamed
 *   on the route   the same dot in gilt — this one lies on a shortest path
 *   hinted         ring showing the letter count
 *   revealed       full circle, filled and labelled, ringed in the move's colour
 *   source/target  bone, double ring, named from the start
 *   selected       gilt outer ring, where the next guess comes from
 *
 * Size tracks *knowledge*, never structure. A named word is a full circle; an
 * unnamed one is a dot. That is the fix for a board of ninety identical rings, in
 * which the two words the puzzle is about were impossible to find and every
 * alternative shouted as loudly as the route. It leaks nothing — every unnamed
 * word is the same size as every other, whatever its degree.
 *
 * Subword labels appear only on edges actually traversed, and the fan of moves
 * leading off the board only on words the player has named, so the figure fills
 * in as a record of what they did rather than a spoiler of what they could do.
 */

import { useMemo } from 'react';
import type { GameState } from '../lib/game';
import type { PlateEdge } from '../lib/plate';
import type { Point } from '../lib/types';

interface Props {
  state: GameState;
  /** Every node to draw: routes on the board, plus anything found off it. */
  nodes: readonly string[];
  edges: readonly PlateEdge[];
  positions: ReadonlyMap<string, Point>;
  /** Nodes on some shortest source→target path. */
  routeNodes: ReadonlySet<string>;
  /** Legal moves from each node that lead off the board. */
  spurCount: ReadonlyMap<string, number>;
  /** Reveal the route's shape as gilt rings. */
  showRoute: boolean;
  /** The player's route beat par, so the trail is drawn as the secret it is. */
  beatPar?: boolean;
  /**
   * Dev mode: a tapped word is named outright instead of giving its letter count.
   * Judging whether a puzzle is any good means reading the words around the
   * answer, and counting letters is not reading.
   */
  namesWords?: boolean;
  /** Natural bounds from the layout; the SVG scales these to fit. */
  extent: { x: number; y: number; width: number; height: number };
  onSelect: (word: string) => void;
  onHint: (word: string) => void;
}

/** A word the player has named. */
const NODE_R = 14;
/** A word that is on the board but unnamed: present, not competing. */
const DOT_R = 4.5;
/** Longest tick drawn for a move that leads off the board. */
const SPUR_LEN = 9;
/** Widest fan drawn, however many moves lead away. */
const SPUR_SHOWN_MAX = 8;

/**
 * Moves that lead off the board, drawn as a small fan of ticks.
 *
 * A word's unexplored moves are worth knowing about — they are what makes it a
 * hub — but as full nodes they swamped the routes they hang off, four to one. As
 * ticks they cost almost no space and still read at a glance as "lots of options
 * here". The fan is aimed away from the board's centre line so it does not
 * collide with the edges already drawn.
 *
 * Ticks count doublings, not moves. The range is enormous — four moves off one
 * word, a hundred and ten off another — so one tick each is impossible and a
 * printed number beside the node was just a stray digit on the plate. A fan that
 * grows by one tick per doubling stays a picture, and the comparison it invites
 * (this word branches more than that one) is the true one.
 */
function SpurFan({ count, awayFrom }: { count: number; awayFrom: number }) {
  if (count <= 0) return null;
  const shown = Math.min(Math.round(Math.log2(count)) + 1, SPUR_SHOWN_MAX);
  // Widen the fan as there are more of them, but never past a quadrant either
  // side: the fan has to stay clear of the label above the node.
  const spread = Math.min(0.34 + shown * 0.17, 1.5);
  const ticks = [];
  for (let i = 0; i < shown; i++) {
    const t = shown === 1 ? 0.5 : i / (shown - 1);
    const angle = awayFrom - spread / 2 + t * spread;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ticks.push(
      <line
        key={i}
        x1={cos * (NODE_R + 2)}
        y1={sin * (NODE_R + 2)}
        x2={cos * (NODE_R + 2 + SPUR_LEN)}
        y2={sin * (NODE_R + 2 + SPUR_LEN)}
        stroke="var(--color-ash)"
        strokeWidth="1"
        strokeLinecap="round"
      />,
    );
  }
  return (
    <g aria-hidden opacity="0.9">
      {ticks}
    </g>
  );
}

export function GraphPlate({
  state,
  nodes,
  edges,
  positions,
  routeNodes,
  spurCount,
  showRoute,
  beatPar = false,
  namesWords = false,
  extent,
  onSelect,
  onHint,
}: Props) {
  const { revealed, selected, puzzle } = state;

  /**
   * Direction to aim each node's spur fan: away from the mean direction of its
   * drawn edges, so ticks point into empty space rather than over the routes.
   */
  const spurAngle = useMemo(() => {
    const sum = new Map<string, { x: number; y: number }>();
    for (const { a, b } of edges) {
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) continue;
      const add = (key: string, dx: number, dy: number) => {
        const acc = sum.get(key) ?? { x: 0, y: 0 };
        const len = Math.hypot(dx, dy) || 1;
        acc.x += dx / len;
        acc.y += dy / len;
        sum.set(key, acc);
      };
      add(a, pb.x - pa.x, pb.y - pa.y);
      add(b, pa.x - pb.x, pa.y - pb.y);
    }
    const angles = new Map<string, number>();
    for (const word of nodes) {
      const acc = sum.get(word);
      const p = positions.get(word);
      // No edges, or edges cancelling out: fan away from the spine.
      const wanted =
        !acc || (Math.abs(acc.x) < 1e-6 && Math.abs(acc.y) < 1e-6)
          ? (p?.x ?? 0) >= 0
            ? 0
            : Math.PI
          : Math.atan2(-acc.y, -acc.x);
      // Held in the lower half, because the word's own label is above it and a
      // fan drawn through the label reads as a scribble. Taking the absolute
      // angle reflects an upward fan downward while keeping the side the edges
      // left free; the clamp stops it from lying flat along the label's baseline.
      angles.set(word, Math.min(Math.max(Math.abs(wanted), 0.2 * Math.PI), 0.8 * Math.PI));
    }
    return angles;
  }, [nodes, edges, positions]);

  /** Edges the player walked, keyed both ways, with the subword used. */
  const walked = useMemo(() => {
    const map = new Map<string, { sub: string; kind: 'add' | 'remove' }>();
    for (const entry of revealed.values()) {
      if (entry.via && entry.move) {
        const mark = { sub: entry.move.sub, kind: entry.move.kind };
        map.set(`${entry.via} ${entry.word}`, mark);
        map.set(`${entry.word} ${entry.via}`, mark);
      }
    }
    return map;
  }, [revealed]);

  return (
    <svg
      viewBox={`${extent.x} ${extent.y} ${extent.width} ${extent.height}`}
      className="h-full w-full touch-none select-none"
      role="img"
      aria-label={
        `Map of moves between ${puzzle.source} and ${puzzle.target}. ` +
        `${revealed.size} of ${nodes.length} words named.`
      }
    >
      <g>
        {edges.map(({ a, b }) => {
          const pa = positions.get(a);
          const pb = positions.get(b);
          if (!pa || !pb) return null;

          const trail = walked.get(`${a} ${b}`);
          const bothKnown = revealed.has(a) && revealed.has(b);
          // A move available right now, from where the player stands.
          const live = !trail && (a === selected || b === selected);

          const stroke = trail
            ? trail.kind === 'add'
              ? 'var(--color-gilt)'
              : 'var(--color-blood-lit)'
            : bothKnown
              ? 'var(--color-ash-lit)'
              : 'var(--color-rule)';

          // A route that beat par glows along its whole length: what the player
          // found is the line, not any one move on it.
          const golden = trail !== undefined && beatPar;

          return (
            <g key={`${a} ${b}`}>
              {golden && (
                <line
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke="var(--color-gilt)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  opacity="0.22"
                />
              )}
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke={golden ? 'var(--color-gilt)' : stroke}
                strokeWidth={trail ? (golden ? 2 : 1.6) : 1}
                strokeDasharray={live ? '2 4' : undefined}
                opacity={trail ? 1 : bothKnown ? 0.9 : live ? 0.85 : 0.6}
              />
              {trail && (
                <text
                  x={(pa.x + pb.x) / 2}
                  y={(pa.y + pb.y) / 2 - 5}
                  textAnchor="middle"
                  className="word"
                  fontSize="10"
                  fill={trail.kind === 'add' ? 'var(--color-gilt)' : 'var(--color-blood-lit)'}
                  paintOrder="stroke"
                  stroke="var(--color-noir)"
                  strokeWidth="3"
                  strokeLinejoin="round"
                >
                  {trail.kind === 'add' ? '+' : '−'}
                  {trail.sub}
                </text>
              )}
            </g>
          );
        })}
      </g>

      <g>
        {nodes.map((word) => {
          const p = positions.get(word);
          if (!p) return null;

          const entry = revealed.get(word);
          const isRevealed = entry !== undefined;
          const isSource = word === puzzle.source;
          const isTarget = word === puzzle.target;
          const isEndpoint = isSource || isTarget;
          const isSelected = word === selected;
          const onRoute = showRoute && routeNodes.has(word);
          const hinted = state.hinted.has(word);
          // Named words, and the two you are given, are drawn as circles; the rest
          // of the board is dots. Hinting a word promotes it halfway, because a
          // letter count needs somewhere to sit.
          // In dev mode a hint gives the whole word, so it needs a word's worth of
          // room and a word's legibility.
          const spelled = hinted && namesWords;
          const named = isRevealed || isEndpoint || spelled;

          // The whole visual grammar for one node, decided in one place. Left as
          // nested ternaries inside the JSX it was four separate ladders over the
          // same five booleans, and no two of them read the same way.
          const r = isRevealed || isEndpoint ? NODE_R : hinted ? NODE_R - 3 : DOT_R;
          const ring = isEndpoint
            ? 'var(--color-bone)'
            : isRevealed
              ? entry.move?.kind === 'add'
                ? 'var(--color-gilt)'
                : 'var(--color-blood-lit)'
              : onRoute
                ? 'var(--color-gilt)'
                : 'var(--color-ash-lit)';
          const fill = named
            ? 'var(--color-noir-3)'
            : hinted
              ? 'var(--color-noir-2)'
              : onRoute
                ? 'var(--color-gilt-dim)'
                : 'var(--color-ash)';
          const weight = named ? 1.4 : hinted ? 1 : 0.8;
          const presence = named ? 1 : onRoute ? 0.95 : 0.7;
          // A word named by dev mode, rather than earned, is set dim: it is an
          // inspection of the board, not a move on it.
          const ink =
            spelled && !isRevealed
              ? 'var(--color-bone-dim)'
              : named
                ? 'var(--color-bone)'
                : 'var(--color-bone-dim)';

          // The target is named from the start — it is the goal, not a secret.
          const label =
            isRevealed || isTarget ? word : hinted ? (namesWords ? word : String(word.length)) : null;

          return (
            <g key={word} transform={`translate(${p.x} ${p.y})`}>
              {/*
                The reveal animation lives on its own group, inside the one that
                positions the node. Sharing a group meant the CSS transform of
                the animation replaced the SVG transform attribute that placed
                it, so every word being named flew in from the corner of the
                board instead of surfacing where it belongs.
              */}
              <g className={isRevealed && !isSource ? 'surface' : undefined}>
                {/* Only where the player stands: a hub is news once you are on it. */}
                {isRevealed && (
                  <SpurFan
                    count={spurCount.get(word) ?? 0}
                    awayFrom={spurAngle.get(word) ?? 0}
                  />
                )}

                {isSelected && (
                  <circle
                    r={NODE_R + 5}
                    fill="none"
                    stroke="var(--color-gilt)"
                    strokeWidth="1"
                    opacity="0.75"
                  />
                )}

                <circle r={r} fill={fill} stroke={ring} strokeWidth={weight} opacity={presence} />

                {/* Deco double ring marks the two words you are given. */}
                {isEndpoint && (
                  <circle
                    r={NODE_R - 3.5}
                    fill="none"
                    stroke={isRevealed ? 'var(--color-bone-dim)' : 'var(--color-bone)'}
                    strokeWidth="0.6"
                    opacity="0.8"
                  />
                )}

                {/* The goal, still unreached: the same lozenge as the header. */}
                {isTarget && !isRevealed && (
                  <rect
                    x={-3.2}
                    y={-3.2}
                    width={6.4}
                    height={6.4}
                    transform="rotate(45)"
                    fill="var(--color-gilt)"
                  />
                )}

                {label !== null && (
                  <text
                    y={named ? -NODE_R - 8 : 3.5}
                    textAnchor="middle"
                    className="word"
                    fontSize={named ? 12.5 : 10}
                    fontWeight={isEndpoint ? 600 : 400}
                    fill={ink}
                    paintOrder="stroke"
                    stroke="var(--color-noir)"
                    strokeWidth="3.5"
                    strokeLinejoin="round"
                  >
                    {label}
                  </text>
                )}
              </g>

              {/* Hit area sized for thumbs, larger than the drawn mark. */}
              <circle
                r={NODE_R + 8}
                fill="transparent"
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={
                  isRevealed
                    ? `${word}${isSelected ? ', selected' : ''}. Guess from here.`
                    : hinted
                      ? `Unnamed word, ${word.length} letters.`
                      : 'Unnamed word. Reveal how many letters it has.'
                }
                onClick={() => (isRevealed ? onSelect(word) : onHint(word))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (isRevealed) onSelect(word);
                    else onHint(word);
                  }
                }}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
