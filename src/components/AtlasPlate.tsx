/**
 * An open map, drawn as one figure.
 *
 * The same words and the same moves the daily board draws — `plate/PlateNode` and
 * `plate/PlateEdge` are shared, so a word means the same thing on either — with none of the
 * puzzle's emphasis on top, because there is no answer to emphasise. What an atlas adds
 * instead is the thing a map needs and a puzzle does not: **territories**, drawn behind
 * everything as the ground the words stand on.
 *
 * Three states and no more:
 *
 *   revealed    a word you have been to: a full mark with its name
 *   named       one you have spent a point on: the mark, and how many letters it has
 *   the rim     one you have not: a dot, saying only that there is something here
 *
 * No route, no par, no shortcut, no fan of moves leading off the board — the rim *is* the
 * moves leading off the board, so a fan would be a second way of saying it.
 *
 * And two states for a move, against the daily board's seven: one the player has, which is any
 * move between two words they have found, and one they do not. See `bothKnown` where the edges
 * are drawn.
 */

import { memo, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { explore as says } from '../i18n/messages/explore';
import { EdgeLabel } from './plate/EdgeLabel';
import { Plate } from './plate/Plate';
import { PlateEdge } from './plate/PlateEdge';
import { PlateNode } from './plate/PlateNode';
import { usePointing } from './plate/usePointing';
import { roomFor, type Sizes, type Territory } from '../lib/atlasLayout';
import { reachOf } from '../lib/forces';
import { outlinePath, type Blob } from '../lib/hull';
import type { LogEntry } from '../lib/found';
import type { Lexicon } from '../lib/lexicon';
import type { PlateEdge as Edge, Figure } from '../lib/plate';
import { NO_ENTRANCE, type Entrances } from '../lib/sprout';
import type { Point } from '../lib/types';

interface Props {
  figure: Figure;
  /** How big each word is drawn, which the layout arranged them by. See `Sizes`. */
  sizes: Sizes;
  positions: ReadonlyMap<string, Point>;
  territories: readonly Territory[];
  /** Everywhere the player has been. Anything else drawn is the rim. */
  revealed: ReadonlySet<string>;
  /** Where the next guess is made from. */
  selected: string;
  /** Words a point has been spent on, at level 1: the letter count and nothing more. */
  hints: ReadonlyMap<string, number>;
  /** Every move made, for drawing the subword on the ones that were. */
  log: readonly LogEntry[];
  lexicon: Lexicon;
  /**
   * When each word and each move that has just arrived comes out. See `sprout.ts`.
   *
   * Everything in it carries the growing animation; everything else is simply drawn. Which is
   * also what the layout is oozing the same words along, so the two agree by construction rather
   * than by two sets of numbers that have to be kept in step.
   */
  arrivals?: Entrances;
  view: { x: number; y: number; width: number; height: number };
  gestures?: Record<string, unknown>;
  engaged?: boolean;
  /** Stand here, and guess from here. */
  onSelect: (word: string) => void;
  /** Ask about a word on the rim — which costs a point. */
  onAsk: (word: string) => void;
}

/**
 * A territory, drawn as the ground rather than as an object.
 *
 * **A plate, not a skin.** The shape is a polygon round the region's outermost words with room to
 * spare inside it, so what the eye reads is a *place* with an extent and an edge — one being
 * shoved about by the places next to it as it grows — rather than a membrane shrink-wrapped
 * round a graph that is already drawn. The words were already on the board; the ground's job is
 * to say that this patch of the map is somewhere. See hull.ts, which has the whole argument.
 *
 * Barely there on purpose: a hairline and a wash. It is orientation at a glance — "I came in
 * over there" — and anything louder competes with the words, which are the thing. **No name
 * either**: a territory is somewhere you recognise by its shape and what is in it, and a word
 * floating over it at sixteen units is a second kind of label on a board that already has one.
 *
 * Memoised on the path, which the caller only recomputes when the region's words move.
 */
const Ground = memo(function Ground({ path }: { path: string }) {
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

/** Territories worth drawing a ground for: the ones with a crowd rather than a word or two. */
const WORTH_DRAWING = 3;

export function AtlasPlate({
  figure,
  sizes,
  positions,
  territories,
  revealed,
  selected,
  hints,
  log,
  lexicon,
  arrivals = NO_ENTRANCE,
  view,
  gestures,
  engaged = false,
  onSelect,
  onAsk,
}: Props) {
  const intl = useIntl();

  const { overWord, overEdge, edgeHandlers, onHover, onUnhover, onActivate } = usePointing({
      nodes: figure.nodes,
      positions,
      view,
      // Everywhere you have been is somewhere you can stand — and there is nowhere else,
      // because an atlas has no goal to work back from.
      canStand: (word) => revealed.has(word),
    onSelect,
    onAsk,
  });

  /**
   * Edges the player walked, keyed both ways, with the subword used.
   *
   * Read off the log rather than off how each word arrived, for the reason the daily board
   * reads it there: a word carries one arrival and can be reached several ways, so arrivals
   * are a subset of the moves made.
   *
   * This is what puts a *subword* on a line. Which line is **drawn** as a move the player has is
   * a wider question — see `bothKnown` below.
   */
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
   * The plate under every territory with a crowd in it.
   *
   * Over the region's *whole* membership rather than what is culled into view, or panning would
   * redraw a different shape for the same place. Memoised on the positions, which change on
   * every frame of an ooze — so this runs per frame while the board is moving, which is
   * affordable only because a plate is a convex hull rather than a contour over a grid. See
   * hull.ts.
   *
   * **Over the room each word claims, not over its mark.** A name stands beside its mark and
   * reaches further than it does, so a plate drawn to the marks alone had the outermost names of
   * a territory hanging off the edge of its own ground. It is also the same `roomFor` the
   * layout's radius is measured with — so a territory is exactly its plate plus half the gap
   * between two of them, which is what makes the map read as plates in contact.
   */
  const grounds = useMemo(() => {
    const room = roomFor(sizes);
    return territories
      .filter((one) => one.region >= 0 && one.words.length >= WORTH_DRAWING)
      .map((one) => ({
        region: one.region,
        path: outlinePath(
          one.words
            .map((word) => {
              const at = positions.get(word);
              return at ? { x: at.x, y: at.y, r: reachOf(room(word)) } : null;
            })
            .filter((blob): blob is Blob => blob !== null),
        ),
      }))
      .filter((one) => one.path !== '');
  }, [territories, positions, sizes]);

  return (
    <Plate
      view={view}
      gestures={gestures}
      engaged={engaged}
      label={intl.formatMessage(says.plate, {
        named: revealed.size,
        total: figure.nodes.length,
        regions: territories.length,
      })}
    >
      {/* The ground, under everything. */}
      <g>
        {grounds.map((one) => (
          <Ground key={one.region} path={one.path} />
        ))}
      </g>

      <g>
        {figure.edges.map((edge: Edge) => {
          const pa = positions.get(edge.a);
          const pb = positions.get(edge.b);
          if (!pa || !pb) return null;
          const key = `${edge.a} ${edge.b}`;
          const trail = walked.get(key);
          const entrance = arrivals.edges.get(key);
          /*
            **A move between two words the player has found is a move they have**, typed or not,
            and it is drawn as one.

            On a daily board that would be a lie about par — a legal edge between two undiscovered
            words is a shortcut, and drawing it contradicts the header. An open map has no par and
            nothing to be earnt by typing `cages` from `cage` when both are already on the board.
            Left as hairlines, a found word said it was connected only the way it happened to be
            reached: arrive at a hub from the north and it sat there with one gold line and a
            dozen grey ones, and filling them in meant typing words you were already looking at.

            Every edge here with both ends revealed *is* a move, because `edgesAmong` draws a
            revealed word's whole legal neighbourhood — so this needs no second opinion from the
            graph. What it does not get is a **subword**: that is the record of a move somebody
            made, and it is also what a labelled hub would bury its own neighbourhood under. See
            the layer at the bottom of this file.
          */
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
                lifted={overEdge === key || edge.a === overWord || edge.b === overWord}
                sprouting={entrance !== undefined}
                delay={entrance?.delay ?? 0}
                draw={entrance?.duration ?? 0}
                // No `sub`, and so no label: on a map the words a move ran between are
                // seventy units across and a label drawn with its own line goes straight
                // under the next one along. They are drawn in the layer below instead.
                sub={null}
                {...edgeHandlers(key)}
              />
            </g>
          );
        })}
      </g>

      <g>
        {figure.nodes.map((word) => {
          const at = positions.get(word);
          if (!at) return null;
          const entrance = arrivals.nodes.get(word);
          return (
            <g key={word} data-word={word} transform={`translate(${at.x} ${at.y})`}>
              <PlateNode
                word={word}
                lexicon={lexicon}
                isRevealed={revealed.has(word)}
                isSelected={word === selected}
                level={hints.get(word) ?? 0}
                degree={sizes.degree(word)}
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

      {/*
        The subwords, above everything.

        SVG paints in document order and has no other notion of depth, so a label that must
        never be covered has to be drawn after the thing that would cover it — which on this
        board is every mark on it. Hence a layer of its own rather than a label inside each
        edge's group; see `EdgeLabel`.
      */}
      <g aria-hidden>
        {figure.edges.map((edge: Edge) => {
          const trail = walked.get(`${edge.a} ${edge.b}`);
          if (!trail) return null;
          const pa = positions.get(edge.a);
          const pb = positions.get(edge.b);
          if (!pa || !pb) return null;
          return (
            <EdgeLabel
              key={`${edge.a} ${edge.b}`}
              ax={pa.x}
              ay={pa.y}
              bx={pb.x}
              by={pb.y}
              kind="made"
              sub={trail.sub}
              lexicon={lexicon}
            />
          );
        })}
      </g>
    </Plate>
  );
}
