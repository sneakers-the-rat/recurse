/**
 * The plate: every move worth knowing about, drawn as one figure.
 *
 * Visual grammar, quietest to loudest:
 *
 *   unrevealed     a small ash dot — a word that exists here and is unnamed
 *   on the route   the same dot in gilt — this one lies on a shortest path
 *   hinted once    ring holding the letter count
 *   hinted more    the letters asked for, dim, with a dot per letter still unknown
 *   revealed       full circle, filled and labelled, ringed gilt on the route and bone off it
 *   source/target  bone, double ring, named from the start
 *   selected       gilt outer ring, where the next guess comes from
 *
 * **A node's colour is about the route, never about the move that reached it.** Gilt means
 * on a shortest way through; bone means not. The moves keep their own grammar on the
 * *edges*, where adding is gilt and removing is blood, because an edge is a move and a
 * word is only a word — see the note on `ring` below for what colouring nodes by move
 * kind actually looked like.
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
 *
 * Hovering lifts edges out of that background: a word brightens every move from it,
 * an edge brightens itself. Geometry only — the subword stays hidden, or pointing at
 * a line would be a free hint.
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { fullyHinted, hintLabel, moveHint, type GameState } from '../lib/game';
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
  /**
   * The wheel belongs to the board rather than to the page, because a pointer has come
   * to rest here. Shown as the cursor, alongside the lit border App draws: a wheel that
   * has stopped scrolling the page needs to say why. See DWELL_MS in usePanZoom.
   */
  engaged?: boolean;
  onSelect: (word: string) => void;
  onHint: (word: string) => void;
  /** Dev mode: spell this word out. */
  onSpell?: (word: string) => void;
}

/** A word the player has named. */
const NODE_R = 14;
/** A word that is on the board but unnamed: present, not competing. */
const DOT_R = 4.5;
/**
 * How far from a word's mark still counts as pointing at it.
 *
 * Wider than the mark, because a dot is four units across and a thumb is not, and a sparse
 * board should not have to be aimed at. Which means the reaches *overlap* wherever two words
 * are close, and that is what `nearest` is for: an SVG gives the event to whichever shape was
 * drawn last, so on a crowded board the word that lit up was the later one in the node list
 * and not the one under the pointer. The reach stays generous; the nearest word wins it.
 */
const REACH = NODE_R + 8;
/** Longest tick drawn for a move that leads off the board. */
const SPUR_LEN = 9;

/** Widest fan drawn, however many moves lead away. */
const SPUR_SHOWN_MAX = 8;

/** How far off the line a move's given-away sign sits. Perpendicular — see `beside`. */
const MARK_OFF = 8;

/** Where a pointer event happened, which is all of one that any of this needs. */
type At = { clientX: number; clientY: number; currentTarget: Element };

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

/**
 * Everything about one word except where it is.
 *
 * Split out and memoised because of what a settle costs. The layout redraws the plate on
 * every frame it moves, and on each of those frames the only thing that has changed
 * about a word is its position — yet the whole mark was being rebuilt: five booleans, a
 * ladder of colours, a hint label, a sentence of accessible text, ten elements. Ninety
 * words of that, sixty times a second, was the single largest cost in the game.
 *
 * So position lives on the group *outside* this, which is the one attribute a frame
 * touches, and everything in here is given as plain values that a frame does not change.
 * React then compares props, finds them equal, and leaves the whole subtree alone.
 *
 * Which is also why the fan's angle is passed as zero for a word that is not showing one
 * (see `spurAngle` in the parent): it is the one prop derived from live positions, and
 * letting it through for words that never draw a fan would defeat the comparison for
 * every word on the board.
 */
const PlateNode = memo(function PlateNode({
  word,
  isRevealed,
  isSource,
  isTarget,
  isSelected,
  onRoute,
  level,
  inspected,
  spurs,
  spurAngle,
  onSecret,
  refused,
  onHover,
  onUnhover,
  onActivate,
  onInspect,
}: {
  word: string;
  isRevealed: boolean;
  isSource: boolean;
  isTarget: boolean;
  isSelected: boolean;
  /**
   * The word is on a shortest route: gilt, and its *letters* are not for sale — a click buys
   * the shape of one of its moves instead, drawn on the edge. See App's `hintWord`.
   */
  onRoute: boolean;
  level: number;
  inspected: boolean;
  spurs: number;
  spurAngle: number;
  onSecret: boolean;
  refused: boolean;
  onHover: (word: string, at: At | null) => void;
  onUnhover: (word: string, at: At | null) => void;
  onActivate: (word: string, at: At | null) => void;
  onInspect: ((word: string, at: At) => void) | undefined;
}) {
  const isEndpoint = isSource || isTarget;
  const hinted = level > 0;
  // Named words, and the two you are given, are drawn as circles; the rest
  // of the board is dots. Hinting a word promotes it halfway, because a
  // letter count needs somewhere to sit.
  //
  // Past the first hint the label is letters rather than a digit, so it
  // needs a word's worth of room and a word's legibility — set above the
  // node, like a named word, but dim, because it was given not found. A word
  // dev mode has spelled out is drawn the same way, for the same reason.
  const spelled = level >= 2 || inspected;
  const named = isRevealed || isEndpoint || spelled;

  // The whole visual grammar for one node, decided in one place. Left as
  // nested ternaries inside the JSX it was four separate ladders over the
  // same five booleans, and no two of them read the same way.
  const r = isRevealed || isEndpoint ? NODE_R : hinted ? NODE_R - 3 : DOT_R;
  /**
   * A word is gilt because it lies on a shortest route, and bone because it does not.
   * That is the whole of what a node's colour says.
   *
   * It used to say how the word had been *reached* — gilt for one arrived at by adding
   * letters, blood for one arrived at by taking them away — which borrows the edges'
   * grammar for something it does not describe. An edge *is* a move, and a move genuinely
   * does add or remove; a word is only a word. So half of a perfectly played answer came
   * out blood red, including words sitting on the gilt route, and a correct move to a
   * shorter word was drawn in the colour this palette otherwise keeps for something being
   * lost. The move is still recorded, in the place that means it: the edge, in its colour,
   * with the subword on it.
   */
  const ring = isEndpoint
    ? 'var(--color-bone)'
    : onRoute
      ? 'var(--color-gilt)'
      : isRevealed
        ? 'var(--color-bone)'
        : 'var(--color-ash-lit)';
  // A word on a found shortcut, still to be named: gilt, and otherwise exactly what it was.
  // Size says how much is *known* about a word and nothing else on the board breaks that
  // rule, so this does not either — the shortcut is said in colour, and in the weight of the
  // line between one word and the next.
  const secret = onSecret && !named;
  const fill = secret
    ? 'var(--color-gilt)'
    : named
      ? 'var(--color-noir-3)'
      : hinted
        ? 'var(--color-noir-2)'
        : onRoute
          ? 'var(--color-gilt-dim)'
          : 'var(--color-ash)';
  const weight = named ? 1.4 : hinted ? 1 : 0.8;
  const presence = named || secret ? 1 : onRoute ? 0.95 : 0.7;
  // A word named by dev mode, rather than earned, is set dim: it is an
  // inspection of the board, not a move on it.
  const ink =
    spelled && !isRevealed
      ? 'var(--color-bone-dim)'
      : named
        ? 'var(--color-bone)'
        : 'var(--color-bone-dim)';

  // The target is named from the start — it is the goal, not a secret. A word on the answer
  // shows nothing: its hints are on its edges, and a level stored by a version that sold its
  // letters must not surface them now.
  const label =
    isRevealed || isTarget || inspected ? word : onRoute ? null : hintLabel(word, level);

  return (
    <>
      {/*
        The reveal animation lives on its own group, inside the one that
        positions the node. Sharing a group meant the CSS transform of
        the animation replaced the SVG transform attribute that placed
        it, so every word being named flew in from the corner of the
        board instead of surfacing where it belongs.
      */}
      <g className={isRevealed && !isSource ? 'surface' : undefined}>
        {/* Only where the player stands: a hub is news once you are on it. */}
        {isRevealed && <SpurFan count={spurs} awayFrom={spurAngle} />}

        {isSelected && (
          <circle
            r={NODE_R + 5}
            fill="none"
            stroke="var(--color-gilt)"
            strokeWidth="1"
            opacity="0.75"
          />
        )}

        <circle
          r={r}
          fill={fill}
          stroke={secret ? 'var(--color-gilt)' : ring}
          strokeWidth={secret ? 1.2 : weight}
          opacity={presence}
        />

        {/*
          A hint refused. Drawn over the mark rather than instead of it, and fading out on its
          own, so the word says no and then goes back to being what it was — a shortcut still
          waiting to be found — without the board moving or the mark changing size.
        */}
        {refused && (
          <g className="crossed" aria-hidden>
            <path
              d={`M${-r - 2} ${-r - 2}L${r + 2} ${r + 2}M${r + 2} ${-r - 2}L${-r - 2} ${r + 2}`}
              stroke="var(--color-blood-lit)"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </g>
        )}

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
            : // The goal is named from the start, so nothing about it is unnamed — but the
              // moves into it are still worth asking about.
              isTarget
              ? `${word}, the goal. Show which way a move into it goes.`
              : onRoute
                ? 'Unnamed word on the best route. Show which way one of its moves goes.'
                : !hinted
              ? 'Unnamed word. Reveal how many letters it has.'
              : fullyHinted(word, level)
                ? `Unnamed word, spelled ${word}. Nothing left to hint.`
                : // What the next click buys, since that is the decision.
                  `Unnamed word, ${word.length} letters${
                    level >= 2 ? `, showing ${hintLabel(word, level)}` : ''
                  }. Reveal another letter.`
        }
        // Hovering a word lifts every move from it out of the background, so
        // the question "what connects here" can be answered by pointing. Focus
        // does the same, since the board is usable from the keyboard.
        //
        // Every one of these hands the event on, because which word is being
        // pointed at is a question about distance and only the plate can answer
        // it — see `nearest`. `pointermove` as well as `pointerenter`, since two
        // words' reaches overlap and crossing from one to the other need not
        // leave the circle that is receiving the events.
        onPointerEnter={(e) => onHover(word, e)}
        onPointerMove={(e) => onHover(word, e)}
        onPointerLeave={(e) => onUnhover(word, e)}
        onFocus={() => onHover(word, null)}
        onBlur={() => onUnhover(word, null)}
        onClick={(e) => onActivate(word, e)}
        // Dev mode only: read the word without paying a hint for it.
        // Judging whether a puzzle is any good means reading the words around
        // the answer, and a right-click keeps that entirely out of the game —
        // spending hint levels to do it made the tally meaningless.
        onContextMenu={
          onInspect
            ? (e) => {
                e.preventDefault();
                onInspect(word, e);
              }
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(word, null);
          }
        }}
      />
    </>
  );
});

export function GraphPlate({
  state,
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
  const { revealed, selected, puzzle } = state;

  /**
   * What the pointer is over: a word, or one particular move.
   *
   * An unwalked edge is drawn at one unit in the faintest ink the palette has, which
   * is right for a background of possibilities and wrong the moment you want to
   * follow one. Hovering a word lifts every move from it; hovering a move lifts that
   * one. Nothing else changes — in particular the subword is *not* named, because
   * that label is the record of a move made, and giving it away on hover would turn
   * the board into a free hint.
   */
  const [overWord, setOverWord] = useState<string | null>(null);
  const [overEdge, setOverEdge] = useState<string | null>(null);

  /**
   * Everything the pointer arithmetic below needs, in a ref rather than closed over.
   *
   * The callbacks it feeds are handed to every word on the board, so they have to keep their
   * identity: a memoised node given a fresh arrow function is a node that redraws on every
   * frame anyway. Positions and the camera change on every one of those frames, and which
   * words are named changes with every guess, so closing over any of it would mean a new
   * callback — and a full redraw of ninety words — each time.
   */
  const live = useRef({ nodes, positions, view, revealed, onSelect, onHint, onSpell });
  live.current = { nodes, positions, view, revealed, onSelect, onHint, onSpell };

  /**
   * The word the pointer is really on: the nearest one within reach, or none.
   *
   * See REACH. The pointer's position is turned into graph units the same way the viewBox
   * turns graph units into pixels — the view always has the plate's own aspect (camera.ts),
   * so the two axes scale alike and there is no letterboxing to allow for.
   */
  const nearest = useCallback((at: At) => {
    const svg = (at.currentTarget as SVGElement).ownerSVGElement;
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    const { nodes: drawn, positions: where, view: shot } = live.current;
    const x = shot.x + ((at.clientX - box.left) / box.width) * shot.width;
    const y = shot.y + ((at.clientY - box.top) / box.height) * shot.height;

    let best: string | null = null;
    let nearby = REACH * REACH;
    for (const word of drawn) {
      const p = where.get(word);
      if (!p) continue;
      const away = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (away > nearby) continue;
      nearby = away;
      best = word;
    }
    return best;
  }, []);

  /**
   * Which word is lit, kept as a ref beside the state.
   *
   * Because hover is now answered on `pointermove` as well as on entering a circle, and a
   * `setState` to the value it already holds still costs this component a render — which is
   * the whole board's worth of edges and nodes rebuilt, sixty times a second, to arrive at
   * the same figure.
   */
  const lit = useRef<string | null>(null);
  const lift = useCallback((word: string | null) => {
    if (lit.current === word) return;
    lit.current = word;
    setOverWord(word);
  }, []);

  const hover = useCallback(
    (word: string, at: At | null) => lift(at ? (nearest(at) ?? word) : word),
    [lift, nearest],
  );
  /**
   * Leaving one word's reach is not leaving the board: the pointer may well be inside a
   * neighbour's, in which case that neighbour is what is being pointed at now. So this asks
   * the same question as `hover` and simply accepts the answer, including none.
   */
  const unhover = useCallback(
    (word: string, at: At | null) => lift(at ? nearest(at) : lit.current === word ? null : lit.current),
    [lift, nearest],
  );

  /** A tap or a click: the same nearest-word question, then hint it or stand on it. */
  const activate = useCallback(
    (word: string, at: At | null) => {
      const { revealed: named, onSelect: select, onHint: hint } = live.current;
      const on = (at ? nearest(at) : null) ?? word;
      if (named.has(on)) select(on);
      else hint(on);
    },
    [nearest],
  );

  /** Dev mode's read-aloud, resolved the same way. */
  const inspect = useCallback(
    (word: string, at: At) => live.current.onSpell?.(nearest(at) ?? word),
    [nearest],
  );
  const canInspect = namesWords && onSpell !== undefined;

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
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      // `touch-none` is what makes dragging the board possible at all: without it a
      // finger on the plate scrolls the page instead.
      className={`h-full w-full touch-none select-none active:cursor-grabbing ${
        engaged ? 'cursor-zoom-in' : 'cursor-grab'
      }`}
      role="img"
      {...gestures}
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

          const key = `${a} ${b}`;
          const lifted = overEdge === key || a === overWord || b === overWord;
          // On the way from the hovered word to the target: the answer to "does this
          // get me anywhere", drawn as the route it is.
          const ahead = onward.has(key);
          // A move on the shortcut the player has found. Loud on purpose — see the note on
          // `secretEdges` — and under the walked trail rather than over it, so a move they
          // have actually made still reads as theirs and keeps its subword.
          const shortcut = secretEdges?.has(key) ?? false;
          // A move given away, drawn **beside the word it is about** — the one that was asked
          // — saying whether you arrive there by adding letters or by taking them away. See
          // `moveHint`: a sign in the middle of a line is a claim with no direction in it.
          const marked = moveHint(state, a, b);
          const beside = marked
            ? (() => {
                const at = marked.at === a ? pa : pb;
                const away = marked.at === a ? pb : pa;
                const span = Math.hypot(away.x - at.x, away.y - at.y) || 1;
                const along = { x: (away.x - at.x) / span, y: (away.y - at.y) / span };
                // Clear of its own word's mark, and never past the middle of the move: beyond
                // that it starts reading as a label on the other word.
                const down = Math.min(span / 2, 26);
                // Then off the line *perpendicular*, not upward. Upward is beside the line on a
                // diagonal move and directly on top of it on a vertical one — which is every
                // move along the spine.
                return {
                  x: at.x + along.x * down + along.y * MARK_OFF,
                  y: at.y + along.y * down - along.x * MARK_OFF,
                };
              })()
            : null;

          return (
            <g key={key}>
              {shortcut && (
                <line
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke="var(--color-gilt)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              )}
              {ahead && !trail && (
                <line
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke="var(--color-gilt)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  opacity="0.18"
                />
              )}
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
                stroke={
                  golden
                    ? 'var(--color-gilt)'
                    : ahead && !trail
                      ? 'var(--color-gilt)'
                      : lifted && !trail
                        ? 'var(--color-bone-dim)'
                        : stroke
                }
                strokeWidth={trail ? (golden ? 2 : 1.6) : ahead ? 1.8 : lifted ? 1.8 : 1}
                strokeDasharray={live ? '2 4' : undefined}
                opacity={ahead || lifted ? 1 : trail ? 1 : bothKnown ? 0.9 : live ? 0.85 : 0.6}
              />
              {/*
                A grabbable edge. The drawn line is one unit wide, which no pointer
                can reliably land on, so the thing that answers the mouse is a fat
                transparent line on top of it. Stroke rather than fill, because a line
                has no interior to hit.
              */}
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                stroke="transparent"
                strokeWidth="11"
                onPointerEnter={() => setOverEdge(key)}
                onPointerLeave={() => setOverEdge((at) => (at === key ? null : at))}
              />
              {marked && beside && !trail && (
                <text
                  x={beside.x}
                  y={beside.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="word"
                  fontSize="12"
                  fontWeight={600}
                  fill={marked.kind === 'add' ? 'var(--color-gilt)' : 'var(--color-blood-lit)'}
                  paintOrder="stroke"
                  stroke="var(--color-noir)"
                  strokeWidth="3"
                  strokeLinejoin="round"
                >
                  {marked.kind === 'add' ? '+' : '−'}
                </text>
              )}
              {trail && (
                /*
                  At the middle of the move, which clears the word it leads to: a name
                  hangs about 25 units above its own mark, and at ROW_HEIGHT the midpoint
                  of a spine edge is 40 above, so the two miss each other by a comfortable
                  margin. Biasing this toward the upper end was tried, to open that margin
                  further, and was worse in the round: two moves out of the same word then
                  wrote their subwords on top of *each other*. What is left is the harder
                  case — a diagonal edge whose middle happens to fall across some
                  unrelated word's label — and that is a real collision in two dimensions,
                  not something a fraction along the line can answer.
                */
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
          return (
            // The group carries the position and nothing else, so a frame of the
            // layout moving touches one attribute per word. Everything else is in
            // PlateNode, which is memoised on values a frame does not change.
            <g key={word} transform={`translate(${p.x} ${p.y})`}>
              <PlateNode
                word={word}
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
                onHover={hover}
                onUnhover={unhover}
                onActivate={activate}
                onInspect={canInspect ? inspect : undefined}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
