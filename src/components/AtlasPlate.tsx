/**
 * The open map's SVG figure, built from the same `PlateNode` and `PlateEdge` as the daily board,
 * with each territory drawn behind its words.
 *
 * A word is found (mark and name), hinted (mark and letter count) or rim (a dot). Subwords are
 * written only for what the pointer is on.
 *
 * Each territory is a `<g>` translated to the region's position, with its words and inner moves
 * at their offsets inside it (see atlasLayout.ts), so a region moving is one attribute change.
 * Moves between regions go in a separate layer in board coordinates. Every layer is memoised,
 * keyed on `Territory.shape`, so a pan, a zoom or a region sliding re-renders nothing inside.
 */

import { memo, useCallback, useMemo, useRef } from 'react';
import { useIntl } from 'react-intl';
import { explore as says } from '../i18n/messages/explore';
import { EdgeLabel, labelSpot } from './plate/EdgeLabel';
import { Plate } from './plate/Plate';
import { PlateEdge } from './plate/PlateEdge';
import { PlateNode, type At as PointerAt } from './plate/PlateNode';
import { usePointing, type Pointing } from './plate/usePointing';
import { usePainting, type Painting } from './plate/usePainting';
import { roomFor, type Sizes, type Territory } from '../lib/atlasLayout';
import { reachOf } from '../lib/forces';
import { ringPath } from '../lib/hull';
import type { LogEntry } from '../lib/found';
import type { Lexicon } from '../lib/lexicon';
import type { PlateEdge as Edge, Figure } from '../lib/plate';
import { showsName } from '../lib/sizes';
import { NO_ENTRANCE, type Entrances } from '../lib/sprout';
import type { Point } from '../lib/types';

/**
 * What the plate asks the layout: a word's board position, its offset in its region, and which
 * region (slot) holds it. Must keep its identity while the board moves, or every memo here misses.
 */
export interface PlateLayout extends Painting {
  place(word: string): Point | undefined;
  offset(word: string): Point | undefined;
  homeOf(word: string): number;
}

interface Props {
  figure: Figure;
  sizes: Sizes;
  layout: PlateLayout;
  territories: readonly Territory[];
  /** Found words. Anything else drawn is rim. */
  revealed: ReadonlySet<string>;
  /** Where the next guess is made from. */
  selected: string;
  /** Words whose letter count was bought. */
  hints: ReadonlyMap<string, number>;
  /** Every move made, for the subwords. */
  log: readonly LogEntry[];
  lexicon: Lexicon;
  /** The arrival animation now playing. See sprout.ts. */
  arrivals?: Entrances;
  /** The visible window, in graph units. */
  view: { x: number; y: number; width: number; height: number };
  /** The window the surface is drawn for. See `Plate`. */
  frame: { x: number; y: number; width: number; height: number };
  overhang?: number | undefined;
  nudge?: { x: number; y: number } | undefined;
  /** Pixels per graph unit, which decides which names are drawn. See `showsName` in sizes.ts. */
  zoom?: number | undefined;
  gestures?: Record<string, unknown>;
  engaged?: boolean;
  onSelect: (word: string) => void;
  /** Ask about a rim word, which costs a point. */
  onAsk: (word: string) => void;
}

/**
 * A territory's outline and fill (see hull.ts), in region coordinates. Faint and unlabelled so
 * it does not compete with the words.
 */
const Ground = memo(function Ground({ ring }: { ring: readonly Point[] }) {
  const path = useMemo(() => ringPath(ring), [ring]);
  if (path === '') return null;
  return (
    <path
      aria-hidden
      d={path}
      fill="var(--color-noir-2)"
      stroke="var(--color-rule)"
      strokeWidth="1"
      opacity="0.7"
    />
  );
});

/** Fewest words a territory needs before its outline is drawn. */
const WORTH_DRAWING = 3;

interface Lit {
  overWord: string | null;
  overEdge: string | null;
}

const NOTHING_LIT: Lit = { overWord: null, overEdge: null };

/** A list of moves, in the coordinates of the group around them. */
const Moves = memo(function Moves({
  edges,
  at,
  walked,
  revealed,
  selected,
  lit,
  arrivals,
  edgeHandlers,
}: {
  edges: readonly Edge[];
  at: ReadonlyMap<string, Point>;
  walked: ReadonlyMap<string, { sub: string; kind: 'add' | 'remove' }>;
  revealed: ReadonlySet<string>;
  selected: string;
  lit: Lit;
  arrivals: Entrances;
  edgeHandlers: Pointing['edgeHandlers'];
}) {
  return (
    <g>
      {edges.map((edge: Edge) => {
        const pa = at.get(edge.a);
        const pb = at.get(edge.b);
        if (!pa || !pb) return null;
        const key = `${edge.a} ${edge.b}`;
        const trail = walked.get(key);
        const entrance = arrivals.edges.get(key);
        // A move between two found words is drawn as made, typed or not (there is no par here).
        // Only moves in the log get a subword.
        const known = revealed.has(edge.a) && revealed.has(edge.b);
        return (
          <g key={key} data-edge={key}>
            <PlateEdge
              ax={pa.x}
              ay={pa.y}
              bx={pb.x}
              by={pb.y}
              walked={trail || known ? 'made' : null}
              bothKnown={known}
              live={!trail && !known && (edge.a === selected || edge.b === selected)}
              lifted={lit.overEdge === key || edge.a === lit.overWord || edge.b === lit.overWord}
              sprouting={entrance !== undefined}
              delay={entrance?.delay ?? 0}
              draw={entrance?.duration ?? 0}
              // Subwords are drawn in the labels layer, above every mark.
              sub={null}
              {...edgeHandlers(key)}
            />
          </g>
        );
      })}
    </g>
  );
});

/**
 * A list of words, arriving ones drawn first so they are painted under the settled word they
 * start on top of (see atlasLayout.ts) and come out from beneath it. Takes nothing about the
 * pointer, so hovering does not re-render the marks.
 */
const Words = memo(function Words({
  words,
  at,
  sizes,
  revealed,
  selected,
  hints,
  lexicon,
  arrivals,
  zoom,
  onHover,
  onUnhover,
  onActivate,
}: {
  words: readonly string[];
  at: ReadonlyMap<string, Point>;
  sizes: Sizes;
  revealed: ReadonlySet<string>;
  selected: string;
  hints: ReadonlyMap<string, number>;
  lexicon: Lexicon;
  arrivals: Entrances;
  zoom: number | undefined;
  onHover: (word: string, at: PointerAt | null) => void;
  onUnhover: (word: string, at: PointerAt | null) => void;
  onActivate: (word: string, at: PointerAt | null) => void;
}) {
  const layers = useMemo(() => {
    const coming: string[] = [];
    const settled: string[] = [];
    for (const word of words) (arrivals.nodes.has(word) ? coming : settled).push(word);
    return [coming, settled];
  }, [words, arrivals]);

  return (
    <>
      {layers.map((layer, which) => (
        <g key={which}>
          {layer.map((word) => {
            const spot = at.get(word);
            if (!spot) return null;
            const entrance = arrivals.nodes.get(word);
            const degree = sizes.degree(word);
            return (
              <g key={word} data-word={word} transform={`translate(${spot.x} ${spot.y})`}>
                <PlateNode
                  word={word}
                  lexicon={lexicon}
                  isRevealed={revealed.has(word)}
                  isSelected={word === selected}
                  standing
                  level={hints.get(word) ?? 0}
                  degree={degree}
                  // Where you stand is always named, however small it is on screen.
                  showName={word === selected || showsName(degree, zoom)}
                  sprouting={entrance !== undefined}
                  delay={entrance?.delay ?? 0}
                  grow={entrance?.duration ?? 0}
                  onHover={onHover}
                  onUnhover={onUnhover}
                  onActivate={onActivate}
                  onInspect={undefined}
                />
              </g>
            );
          })}
        </g>
      ))}
    </>
  );
});

function offsetsOf(
  words: readonly string[],
  offset: (word: string) => Point | undefined,
): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const word of words) {
    const spot = offset(word);
    if (spot) out.set(word, spot);
  }
  return out;
}

/** One territory's inner moves. Keyed on `shape`, not position, so moving the region skips it. */
const CountryMoves = memo(function CountryMoves({
  shape,
  words,
  edges,
  offset,
  walked,
  revealed,
  selected,
  lit,
  arrivals,
  edgeHandlers,
}: {
  shape: number;
  words: readonly string[];
  edges: readonly Edge[];
  offset: (word: string) => Point | undefined;
  walked: ReadonlyMap<string, { sub: string; kind: 'add' | 'remove' }>;
  revealed: ReadonlySet<string>;
  selected: string;
  lit: Lit;
  arrivals: Entrances;
  edgeHandlers: Pointing['edgeHandlers'];
}) {
  // `shape` changes when the offsets move; `words` when the territory gains one.
  const at = useMemo(() => offsetsOf(words, offset), [words, offset, shape]);
  return (
    <Moves
      edges={edges}
      at={at}
      walked={walked}
      revealed={revealed}
      selected={selected}
      lit={lit}
      arrivals={arrivals}
      edgeHandlers={edgeHandlers}
    />
  );
});

/** One territory's words, memoised like `CountryMoves`. */
const CountryWords = memo(function CountryWords({
  shape,
  words,
  offset,
  ...rest
}: {
  shape: number;
  words: readonly string[];
  offset: (word: string) => Point | undefined;
  sizes: Sizes;
  revealed: ReadonlySet<string>;
  selected: string;
  hints: ReadonlyMap<string, number>;
  lexicon: Lexicon;
  arrivals: Entrances;
  zoom: number | undefined;
  onHover: (word: string, at: PointerAt | null) => void;
  onUnhover: (word: string, at: PointerAt | null) => void;
  onActivate: (word: string, at: PointerAt | null) => void;
}) {
  const at = useMemo(() => offsetsOf(words, offset), [words, offset, shape]);
  return <Words words={words} at={at} {...rest} />;
});

export function AtlasPlate({
  figure,
  sizes,
  layout,
  territories,
  revealed,
  selected,
  hints,
  log,
  lexicon,
  arrivals = NO_ENTRANCE,
  view,
  frame,
  overhang,
  nudge,
  zoom,
  gestures,
  engaged = false,
  onSelect,
  onAsk,
}: Props) {
  const intl = useIntl();

  const where = useMemo(() => ({ get: (word: string) => layout.place(word) }), [layout]);

  const { overWord, overEdge, edgeHandlers, onHover, onUnhover, onActivate, surface } = usePointing(
    {
      nodes: figure.nodes,
      positions: where,
      view,
      canStand: (word) => revealed.has(word),
      onSelect,
      onAsk,
    },
  );

  /** Moves made, keyed both ways, with their subword. From the log, which has every move. */
  const walked = useMemo(() => {
    const map = new Map<string, { sub: string; kind: 'add' | 'remove' }>();
    for (const { from, to, move } of log) {
      const mark = { sub: move.sub, kind: move.kind };
      map.set(`${from} ${to}`, mark);
      map.set(`${to} ${from}`, mark);
    }
    return map;
  }, [log]);

  /**
   * Words and inner moves per territory, and the moves between territories. An unchanged list is
   * handed back as the previous array, so only territories that gained something re-render.
   */
  const held = useRef<{
    words: Map<number, string[]>;
    inside: Map<number, Edge[]>;
    across: Edge[];
  } | null>(null);
  const split = useMemo(() => {
    const words = new Map<number, string[]>();
    const inside = new Map<number, Edge[]>();
    for (const word of figure.nodes) {
      const slot = layout.homeOf(word);
      if (slot < 0) continue;
      (words.get(slot) ?? words.set(slot, []).get(slot)!).push(word);
    }
    const across: Edge[] = [];
    for (const edge of figure.edges) {
      const one = layout.homeOf(edge.a);
      const two = layout.homeOf(edge.b);
      if (one >= 0 && one === two) {
        (inside.get(one) ?? inside.set(one, []).get(one)!).push(edge);
        continue;
      }
      across.push(edge);
    }

    // Both lists come from the figure in the same order, so equal sets compare equal in order.
    const same = <T,>(one: readonly T[] | undefined, two: readonly T[]) =>
      one !== undefined && one.length === two.length && one.every((at, i) => at === two[i]);

    const last = held.current;
    if (last) {
      for (const [slot, list] of words) {
        const before = last.words.get(slot);
        if (same(before, list)) words.set(slot, before!);
      }
      for (const [slot, list] of inside) {
        const before = last.inside.get(slot);
        if (same(before, list)) inside.set(slot, before!);
      }
      if (same(last.across, across)) {
        held.current = { words, inside, across: last.across };
        return held.current;
      }
    }
    held.current = { words, inside, across };
    return held.current;
  }, [figure, layout]);

  // The territories the pointer is in, so only they get a non-empty `lit`.
  const litSlot = overWord === null ? -1 : layout.homeOf(overWord);
  const edgeSlot = overEdge === null ? -1 : layout.homeOf(overEdge.split(' ')[0] ?? '');

  /**
   * Board positions of the ends of moves between territories, as of this render. Between renders
   * `usePainting` moves those lines.
   */
  const world = useMemo(() => {
    const out = new Map<string, Point>();
    for (const edge of split.across) {
      for (const end of [edge.a, edge.b]) {
        if (out.has(end)) continue;
        const spot = layout.place(end);
        if (spot) out.set(end, spot);
      }
    }
    return out;
    // Not keyed on the arrangement: React leaves unchanged props alone, so a stale value here
    // does not overwrite what the painter wrote.
  }, [split, layout]);

  const lit = useMemo(() => ({ overWord, overEdge }), [overWord, overEdge]);

  // Positions between renders are written straight to the elements. The painter rescans the
  // elements when `split` or `arrivals` changes, the only things that add or re-parent one.
  const paint = usePainting(
    layout,
    useMemo(() => ({ split, arrivals }), [split, arrivals]),
    useCallback(
      (a: string, b: string) => {
        const pa = layout.place(a);
        const pb = layout.place(b);
        if (!pa || !pb) return null;
        const room = roomFor(sizes);
        return labelSpot(pa.x, pa.y, pb.x, pb.y, reachOf(room(a)), reachOf(room(b)));
      },
      [layout, sizes],
    ),
  );

  return (
    <Plate
      frame={frame}
      overhang={overhang}
      nudge={nudge}
      gestures={gestures}
      surface={surface}
      engaged={engaged}
      label={intl.formatMessage(says.plate, {
        named: revealed.size,
        total: figure.nodes.length,
        regions: territories.length,
      })}
    >
      {/* `usePainting` finds what it moves under here by the `data-layer` marks. */}
      <g ref={paint.root}>
      {/*
        Outlines of every territory, then moves, then words: SVG paints in document order, and a
        move's wide invisible hit stroke over another region's words would take their clicks.
      */}
      <g>
        {territories.map((one) =>
          one.words.length >= WORTH_DRAWING ? (
            <g
              key={one.slot}
              data-slot={one.slot}
              data-layer="ground"
              transform={`translate(${one.at.x} ${one.at.y})`}
            >
              <Ground ring={one.ring} />
            </g>
          ) : null,
        )}
      </g>

      <g>
        {territories.map((one) => {
          const edges = split.inside.get(one.slot);
          if (!edges || edges.length === 0) return null;
          return (
            <g
              key={one.slot}
              data-slot={one.slot}
              data-layer="moves"
              transform={`translate(${one.at.x} ${one.at.y})`}
            >
              <CountryMoves
                shape={one.shape}
                words={split.words.get(one.slot) ?? NO_WORDS}
                edges={edges}
                offset={layout.offset}
                walked={walked}
                revealed={revealed}
                selected={selected}
                lit={
                  one.slot === litSlot || one.slot === edgeSlot
                    ? { overWord: one.slot === litSlot ? overWord : null, overEdge }
                    : NOTHING_LIT
                }
                arrivals={arrivals}
                edgeHandlers={edgeHandlers}
              />
            </g>
          );
        })}
        {/* Moves between territories, in board coordinates. */}
        <g data-layer="across">
          <Moves
            edges={split.across}
            at={world}
            walked={walked}
            revealed={revealed}
            selected={selected}
            lit={lit}
            arrivals={arrivals}
            edgeHandlers={edgeHandlers}
          />
        </g>
      </g>

      <g>
        {territories.map((one) => {
          const words = split.words.get(one.slot);
          if (!words || words.length === 0) return null;
          return (
            <g
              key={one.slot}
              data-slot={one.slot}
              data-layer="words"
              data-region={one.region}
              transform={`translate(${one.at.x} ${one.at.y})`}
            >
              <CountryWords
                shape={one.shape}
                words={words}
                offset={layout.offset}
                sizes={sizes}
                revealed={revealed}
                selected={selected}
                hints={hints}
                lexicon={lexicon}
                arrivals={arrivals}
                zoom={zoom}
                onHover={onHover}
                onUnhover={onUnhover}
                onActivate={onActivate}
              />
            </g>
          );
        })}
      </g>

      {/*
        Subwords of made moves under the pointer (the move, or every move of the word), drawn last
        so no mark covers them. Placed between the two marks' edges, not at the line's midpoint;
        see `labelAlong` in sizes.ts.
      */}
      <g aria-hidden data-layer="labels" ref={paint.labels}>
        {(overWord !== null || overEdge !== null) &&
          figure.edges.map((edge: Edge) => {
            const key = `${edge.a} ${edge.b}`;
            if (overEdge !== key && edge.a !== overWord && edge.b !== overWord) return null;
            const trail = walked.get(key);
            if (!trail) return null;
            const pa = layout.place(edge.a);
            const pb = layout.place(edge.b);
            if (!pa || !pb) return null;
            return (
              // `data-edge` lets the painter find the label's two words.
              <g key={key} data-edge={key}>
                <EdgeLabel
                  ax={pa.x}
                  ay={pa.y}
                  bx={pb.x}
                  by={pb.y}
                  ar={reachOf(roomFor(sizes)(edge.a))}
                  br={reachOf(roomFor(sizes)(edge.b))}
                  kind="made"
                  sub={trail.sub}
                  lexicon={lexicon}
                />
              </g>
            );
          })}
      </g>
      </g>
    </Plate>
  );
}

/** A shared empty list, so the memos see the same array. */
const NO_WORDS: readonly string[] = [];
