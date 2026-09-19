/**
 * The daily board: every move worth knowing about, drawn as one figure.
 *
 * What a word looks like and what a move looks like are `plate/PlateNode` and
 * `plate/PlateEdge` — that grammar belongs to the game rather than to one board of it. What is
 * here is the daily puzzle's own emphasis on top of it: the answer route in gilt, the two words
 * you were given, the fan of unexplored moves off a word you have reached, a shortcut you have
 * found an end of, and the signs for moves you have bought.
 *
 * Subword labels appear only on edges actually traversed, and the fan of moves leading off the
 * board only on words the player has named, so the figure fills in as a record of what they did
 * rather than a spoiler of what they could do.
 *
 * Hovering lifts edges out of that background: a word brightens every move from it, an edge
 * brightens itself. Geometry only — the subword stays hidden, or pointing at a line would be a
 * free hint.
 */

import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import { board as says } from '../i18n/messages/board';
import { moveSign } from './marks';
import { Plate } from './plate/Plate';
import { PlateEdge } from './plate/PlateEdge';
import { PlateNode } from './plate/PlateNode';
import { MARK_ALONG } from './plate/sizes';
import { usePointing } from './plate/usePointing';
import { isFront, moveHint, type GameState } from '../lib/game';
import type { Lexicon } from '../lib/lexicon';
import type { PlateEdge as Edge } from '../lib/plate';
import type { Point } from '../lib/types';

interface Props {
  state: GameState;
  /**
   * How a token is written and said — see lib/lexicon.ts.
   *
   * The plate draws *tokens*, which in the phonemes game are pronunciations rather than words.
   * This is the only thing here that knows the difference: it turns a token into the spelling
   * on the mark and the transcription under it, and it is what makes a subword on an edge
   * readable. Everything else on this plate handles tokens without reading them.
   */
  lexicon: Lexicon;
  /** Every node to draw: routes on the board, plus anything found off it. */
  nodes: readonly string[];
  edges: readonly Edge[];
  positions: ReadonlyMap<string, Point>;
  /** Nodes on some shortest source→target path. */
  routeNodes: ReadonlySet<string>;
  /** Moves from each drawn word to the target, for tracing a route from one. */
  distToTarget: ReadonlyMap<string, number>;
  /** Legal moves from each node that lead off the board. */
  spurCount: ReadonlyMap<string, number>;
  /**
   * A shortcut the player has found an end of: the words on it, and the moves between them.
   *
   * Only the route they landed on — App narrows the whole set of shortcuts to that (see its
   * `trail`), because drawing all of them for finding one hands over the ones they never
   * touched.
   *
   * Said in gilt and in the weight of the line, and in nothing else: the words are left
   * *unnamed*, and the marks keep the size every other word of the same standing has, because
   * on this board size means how much is known about a word. The discovery is that a shorter
   * way runs through here — the words themselves are still the puzzle, so they are not spelled
   * out and cannot be hinted (see `onHint` and App).
   */
  secretNodes?: ReadonlySet<string> | undefined;
  secretEdges?: ReadonlySet<string> | undefined;
  /**
   * A word a hint was just refused on, if any: a cross, briefly, over the mark. Only ever a
   * word on a shortcut, which is the one thing hints are not sold for.
   */
  refused?: string | null;
  /** The player's route beat par, so the trail is drawn as the secret it is. */
  beatPar?: boolean;
  /**
   * Dev mode: right-clicking a word spells it out. Nothing to do with hints — see
   * `spelled` — and only offered when this is on.
   */
  namesWords?: boolean;
  /**
   * Words dev mode has spelled out. An inspection of the board, not progress on it:
   * it costs no hint, is not part of the game state, and is not written down.
   */
  spelled?: ReadonlySet<string>;
  /**
   * The window onto the board, in graph units — a camera, not the figure's extent.
   * See camera.ts: words are a fixed size and the surplus board runs off the edges.
   */
  view: { x: number; y: number; width: number; height: number };
  /** Drag, pinch and wheel, from usePanZoom. Spread onto the SVG. */
  gestures?: Record<string, unknown>;
  /** The wheel belongs to the board rather than to the page. See DWELL_MS in usePanZoom. */
  engaged?: boolean;
  onSelect: (word: string) => void;
  onHint: (word: string) => void;
  /** Dev mode: spell this word out. */
  onSpell?: (word: string) => void;
}

export function GraphPlate({
  state,
  lexicon,
  nodes,
  edges,
  positions,
  routeNodes,
  distToTarget,
  spurCount,
  secretNodes,
  secretEdges,
  refused = null,
  beatPar = false,
  namesWords = false,
  spelled: spelledOut,
  view,
  gestures,
  engaged = false,
  onSelect,
  onHint,
  onSpell,
}: Props) {
  const intl = useIntl();
  const { revealed, selected, puzzle } = state;

  const canInspect = namesWords && onSpell !== undefined;
  const { overWord, overEdge, edgeHandlers, onHover, onUnhover, onActivate, onInspect } =
    usePointing({
      nodes,
      positions,
      view,
      canStand: (word) => isFront(state, word),
      onSelect,
      onAsk: onHint,
      onSpell,
    });

  /**
   * A way on from the word under the pointer: the shortest route from it to the target,
   * drawn in gilt.
   *
   * The question a player is actually asking when they point at a word is "does this
   * get me anywhere", and the board could show it without being asked because it
   * already knows every word's distance to the target. Walked over the *drawn* board
   * rather than the graph, so what lights up is a route on the figure in front of them
   * and not a line through words that are not there.
   *
   * Greedy, and exact for the same reason the answer's own route is: every step is to a
   * neighbour one move closer, so it cannot paint itself into a corner.
   */
  const onward = useMemo(() => {
    const trail = new Set<string>();
    if (!overWord) return trail;

    const drawn = new Set(nodes);
    const near = new Map<string, string[]>();
    for (const { a, b } of edges) {
      if (!drawn.has(a) || !drawn.has(b)) continue;
      (near.get(a) ?? near.set(a, []).get(a)!).push(b);
      (near.get(b) ?? near.set(b, []).get(b)!).push(a);
    }

    let at = overWord;
    let left = distToTarget.get(at);
    while (left !== undefined && left > 0) {
      const step = (near.get(at) ?? []).find((word) => distToTarget.get(word) === left! - 1);
      if (step === undefined) break;
      trail.add(`${at} ${step}`);
      trail.add(`${step} ${at}`);
      at = step;
      left -= 1;
    }
    return trail;
  }, [overWord, nodes, edges, distToTarget]);

  /**
   * Direction to aim each node's spur fan: away from the mean direction of its
   * drawn edges, so ticks point into empty space rather than over the routes.
   *
   * Only for the words that draw a fan, which is the ones the player has named — a
   * handful against a board of ninety. It used to be computed for every word on the
   * board, over every edge on it, and recomputed on every frame of a settle, because
   * positions are a new map each frame. Almost all of that was an angle nothing asked
   * for.
   */
  const spurAngle = useMemo(() => {
    const sum = new Map<string, { x: number; y: number }>();
    const add = (key: string, dx: number, dy: number) => {
      if (!revealed.has(key)) return;
      const acc = sum.get(key) ?? { x: 0, y: 0 };
      const len = Math.hypot(dx, dy) || 1;
      acc.x += dx / len;
      acc.y += dy / len;
      sum.set(key, acc);
    };
    for (const { a, b } of edges) {
      if (!revealed.has(a) && !revealed.has(b)) continue;
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) continue;
      add(a, pb.x - pa.x, pb.y - pa.y);
      add(b, pa.x - pb.x, pa.y - pb.y);
    }
    const angles = new Map<string, number>();
    for (const word of revealed.keys()) {
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

  /**
   * Edges the player walked, keyed both ways, with the subword used.
   *
   * Read off the **log**, not off how each word arrived. A word carries one arrival and a
   * player can reach it more than one way, so arrivals are a subset of the moves made — and
   * the move it leaves out is the one that joins a game played from both ends, which is the
   * move that won the round.
   */
  const walked = useMemo(() => {
    const map = new Map<string, { sub: string; kind: 'add' | 'remove' }>();
    for (const { from, to, move } of state.log) {
      const mark = { sub: move.sub, kind: move.kind };
      map.set(`${from} ${to}`, mark);
      map.set(`${to} ${from}`, mark);
    }
    return map;
  }, [state.log]);

  return (
    <Plate
      view={view}
      gestures={gestures}
      engaged={engaged}
      label={intl.formatMessage(says.plate, {
        source: puzzle.source,
        target: puzzle.target,
        named: revealed.size,
        total: nodes.length,
      })}
    >
      <g>
        {edges.map(({ a, b }) => {
          const pa = positions.get(a);
          const pb = positions.get(b);
          if (!pa || !pb) return null;

          const trail = walked.get(`${a} ${b}`);
          const key = `${a} ${b}`;

          return (
            // `data-edge` is how the tutorial points at one move; see selectorFor in
            // tutorial.ts. Alphabetical, which is the order plate.ts emits pairs in, so
            // either way of naming a move finds the same line.
            <g key={key} data-edge={key}>
              <PlateEdge
                ax={pa.x}
                ay={pa.y}
                bx={pb.x}
                by={pb.y}
                walked={trail?.kind ?? null}
                bothKnown={revealed.has(a) && revealed.has(b)}
                // A move available right now, from where the player stands.
                live={!trail && (a === selected || b === selected)}
                lifted={overEdge === key || a === overWord || b === overWord}
                // On the way from the hovered word to the target: the answer to "does this
                // get me anywhere", drawn as the route it is.
                ahead={onward.has(key)}
                // A route that beat par glows along its whole length: what the player
                // found is the line, not any one move on it.
                golden={trail !== undefined && beatPar}
                // A move on the shortcut the player has found. Loud on purpose — see the note
                // on `secretEdges` — and under the walked trail rather than over it, so a move
                // they have actually made still reads as theirs and keeps its subword.
                shortcut={secretEdges?.has(key) ?? false}
                sub={trail?.sub ?? null}
                lexicon={lexicon}
                {...edgeHandlers(key)}
              />
            </g>
          );
        })}
      </g>

      {/*
        The moves given away, in a layer of their own: above every line and below every word.

        Above the lines because a sign drawn inside its own edge's group is only above *that*
        line — the next edge in the list draws straight over it, and on a crowded board the
        sign a player just paid for came out with a stroke through it. Below the words because
        a sign is about a move; nothing about an edge may cover a name.
      */}
      <g>
        {edges.map(({ a, b }) => {
          const pa = positions.get(a);
          const pb = positions.get(b);
          if (!pa || !pb) return null;
          // A move already made says what it was in full, and that reading wins: there is
          // nothing left for a sign to give away.
          if (walked.has(`${a} ${b}`)) return null;
          const marked = moveHint(state, a, b);
          if (!marked) return null;

          const at = marked.at === a ? pa : pb;
          const away = marked.at === a ? pb : pa;
          const span = Math.hypot(away.x - at.x, away.y - at.y) || 1;
          const along = { x: (away.x - at.x) / span, y: (away.y - at.y) / span };
          // Never past the middle of a short move: beyond that the sign starts reading as a
          // label on the word at the other end.
          const down = Math.min(span / 2, MARK_ALONG);

          return (
            <text
              key={`${a} ${b}`}
              // The sign a step can point at, once it has been bought — until then this
              // element does not exist and the spotlight has nothing to find.
              data-mark={`${a} ${b}`}
              x={at.x + along.x * down}
              y={at.y + along.y * down}
              textAnchor="middle"
              dominantBaseline="central"
              className="word"
              fontSize="12"
              fontWeight={600}
              fill={marked.kind === 'add' ? 'var(--color-gilt)' : 'var(--color-blood-lit)'}
              // The halo is what makes a sign sitting *on* a line legible: it punches the
              // line out from under the glyph, so the two read as one mark rather than as a
              // character with a rule through it.
              paintOrder="stroke"
              stroke="var(--color-noir)"
              strokeWidth="3.5"
              strokeLinejoin="round"
            >
              {moveSign(marked.kind)}
            </text>
          );
        })}
      </g>

      <g>
        {nodes.map((word) => {
          const p = positions.get(word);
          if (!p) return null;
          const entry = revealed.get(word);
          const isRevealed = entry !== undefined;
          return (
            // The group carries the position and nothing else, so a frame of the
            // layout moving touches one attribute per word. Everything else is in
            // PlateNode, which is memoised on values a frame does not change.
            //
            // `data-word` rides along because it is the only stable handle a word has:
            // the tutorial points at words, and a word's position is exactly what will
            // not hold still. It is constant per word, so it costs the memoisation
            // nothing.
            <g key={word} data-word={word} transform={`translate(${p.x} ${p.y})`}>
              <PlateNode
                word={word}
                lexicon={lexicon}
                isRevealed={isRevealed}
                isSource={word === puzzle.source}
                isTarget={word === puzzle.target}
                isSelected={word === selected}
                onRoute={routeNodes.has(word)}
                level={state.hints.get(word) ?? 0}
                inspected={spelledOut?.has(word) ?? false}
                spurs={isRevealed ? (spurCount.get(word) ?? 0) : 0}
                // Zero unless a fan is actually drawn: this is the one prop that
                // follows live positions, and passing it for the eighty-odd words
                // that never show one would re-render all of them every frame.
                spurAngle={isRevealed ? (spurAngle.get(word) ?? 0) : 0}
                onSecret={secretNodes?.has(word) ?? false}
                refused={refused === word}
                onHover={onHover}
                onUnhover={onUnhover}
                onActivate={onActivate}
                onInspect={canInspect ? onInspect : undefined}
              />
            </g>
          );
        })}
      </g>
    </Plate>
  );
}
