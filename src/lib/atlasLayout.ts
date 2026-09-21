/**
 * Where the words of an open map go.
 *
 * The daily board has an answer to hang itself off: source at the top, target at the bottom,
 * the route pinned down the middle, everything else pushed aside. An atlas has no answer and
 * no ends, and by the time it is interesting it has a few thousand words on it. One force
 * simulation over all of them gives a hairball with no landmarks in it, and re-settling that
 * hairball on every guess costs more than the guess is worth.
 *
 * So the arrangement happens at two scales that never see each other:
 *
 * * **Regions are laid out against regions.** Tens of nodes, each one a whole territory with a
 *   radius. What keeps them apart is a collider on that radius, which is what makes them read
 *   as places rather than as a smear.
 * * **Words are laid out inside their own region**, in coordinates relative to its centre.
 *   A region is tens to a few hundred words, so this is bounded work however large the atlas
 *   grows — and a guess disturbs exactly one of them.
 *
 * A word's position is its region's centre plus its own offset, so moving a region translates
 * its words rigidly: the map keeps its shape while the continents rearrange. That is what
 * makes a region a *landmark* — you learn where `fact` is, and it is still there tomorrow with
 * the same words around it in the same arrangement.
 *
 * **A crossing move is not simulated, it is aimed at.** A region's layout never sees another
 * region's words; a word with a move leading out of its territory is instead pulled toward the
 * direction that territory lies in. So a bridge sits on the side of its region facing where it
 * goes, and neither region has to know what is in the other.
 *
 * Pure, and tested in node. Nothing here renders, animates or remembers — `useAtlasLayout`
 * does all three.
 */

import { forceCollide, forceLink, forceSimulation, forceX, forceY } from 'd3-force';
import type { Box } from './camera';
import {
  boxOf,
  crowded,
  forceBoxes,
  forceMass,
  linkDistance,
  reachOf,
  relax,
  settle,
  type Room,
  type SimLink,
  type SimNode,
} from './forces';
import { plateReach } from './hull';
import type { ClusterGraph } from './regions';
import { DOT_R } from '../components/plate/sizes';
import { NODE_R } from './sizes';
import type { Point } from './types';

/**
 * How firmly a move holds inside a region, and how hard a word pushes.
 *
 * The same numbers the daily board uses and for the same reasons — see useBoardLayout, which
 * explains why the strength is off 1 and why the charge has a range. What is different here is
 * how words are kept off each other: the daily figure is small enough that charge alone does it,
 * and a region of two hundred words is not. See `forceBoxes`.
 */
const LINK_STRENGTH = 0.5;

/**
 * **There is no repulsion between words either, and it is the same argument as between
 * territories.**
 *
 * A link and a separation both have a rest state: the spring wants two joined words a move
 * apart, the box force will not let any two share any ink, and an arrangement satisfying both
 * exists and is settled into. An n-body charge has no rest state on a graph this sparse — every
 * word pushes every word two moves away, nothing pulls back across a long chain, and a near-tree
 * simply unfolds. Measured over 2,049 words: at -150 the map came out 108,000 units across with
 * a single territory reaching 7,600 from its own middle; at -60, 45,000; at nothing at all,
 * **4,400**, with the largest territory 737.
 *
 * What the charge was for — keeping words out of each other's way — is `forceBoxes`'s job, and
 * it does it as a local constraint rather than as a field, which is why it converges. What is
 * left deciding the shape is the moves, which is the whole of what a territory should be a
 * picture of.
 *
 * This is also what makes a radial gathering unnecessary. There was one, weak, holding the
 * sprawl in; it worked and it was wrong, because a pull toward a point makes round things and a
 * region should look like whatever its own moves make it look like.
 */

/**
 * How firmly a bridge is drawn toward the way out of its territory.
 *
 * Weak on purpose: it is a *hint* about which way is out, not a placement. A bridge clamped to
 * the rim would leave the region with a ring of words round the outside of it, and where a word
 * belongs is still what it is joined to.
 *
 * There is no answering pull inward. See `CHARGE_REACH`.
 */
const OUTWARD = 0.09;

/**
 * How much of its own velocity a word keeps, by how big it is drawn.
 *
 * One for a word at `DOT_R`, which is every unfound word on the rim: they are the lightest
 * things on the board and go where they are pushed. A found word is `markRadius` across, so its
 * mass — which is its *area* — is a good deal more, and it takes a good deal more to shift it.
 * A move between a hub and a leaf then mostly moves the leaf, and a crowd making room for a
 * newcomer mostly moves the newcomer, which is what the arrival is supposed to look like.
 *
 * The damping is a root of the mass rather than the whole of it: at the whole, a word ten times
 * the ink is a hundred times as hard to move and stops finding its own place at all. See
 * `forceMass`.
 */
const MOBILITY = 0.5;

function mobility(radius: number): number {
  return Math.min(1, (DOT_R / Math.max(radius, DOT_R)) ** (2 * MOBILITY));
}

/** How far apart two territories are held, beyond their own radii. */
const REGION_GAP = 70;
const REGION_LINK_STRENGTH = 0.35;
/**
 * **There is no repulsion between territories, and that is the whole reason the map is
 * stable.**
 *
 * A collider and a spring agree with each other: the spring wants two joined territories
 * exactly `ra + rb + REGION_GAP` apart and the collider will not let them closer than
 * `ra + rb`, so the arrangement has a rest state and settles into it. Add an n-body repulsion
 * and it does not: every pass pushes a little further than the last and nothing pulls back, so
 * re-running it grows the map. Measured over five thousand words, a bounded charge at -400
 * took a settled 8,000-unit map to 33,000 in one pass and moved every word on the board, some
 * of them by forty thousand units.
 *
 * What the charge was there for — somewhere for a territory joined to nothing to go — the
 * collider does anyway, and a weak pull toward the middle keeps the whole map from drifting
 * apart at the seams.
 */
const REGION_HOME = 0.05;

/**
 * How tightly the cold pre-packing lays territories out, and the angle it steps by.
 *
 * A sunflower spiral — successive points a golden angle apart, at a radius growing as the
 * square root of their rank — is the arrangement that packs discs on a plane most evenly
 * without knowing anything about them. Seven tenths is about the area fraction it achieves, so
 * dividing by it gives the disc that will hold them.
 */
const SPIRAL_DENSITY = 0.7;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Ticks a settle is given, cold and warm.
 *
 * A territory being arranged for the first time has to find its shape from a seed; one that
 * has gained a word since it was last settled has only to make room for it, and starts from
 * an arrangement that was already right. The difference is what keeps a guess cheap: at three
 * hundred words the cold figure is two hundred milliseconds of blocked main thread and the
 * warm one is fifty, and a guess only ever pays the warm price.
 */
const COLD_TICKS = 220;
const WARM_ALPHA = 0.6;
const WARM_TICKS = 80;
const GLOBAL_COLD_TICKS = 300;
/**
 * And the same distinction one scale up, which matters far more than it does below.
 *
 * A territory growing past `SHIFT` does have to be made room for, but *making room* is not
 * the same as arranging the map again: run at full heat from the remembered centres, sixty
 * discs re-solve into an arrangement that is just as good and completely different, and every
 * word on the board moves — measured, five thousand of them, the furthest by nine thousand
 * units. The map a player has spent an hour learning is gone, and nothing they did asked for
 * that. So a warm pass is a nudge: enough to open a gap, not enough to rearrange a continent.
 */
const GLOBAL_WARM_ALPHA = 0.3;
const GLOBAL_WARM_TICKS = 150;

/**
 * How much a territory may **grow** before the map is rearranged to make room for it.
 *
 * Growth only. A territory that has shrunk needs nothing done about it — its neighbours are
 * further off than they have to be, which is untidy and not wrong, and closing that gap would
 * move every word around it to gain nothing. The remembered radius is exactly what the last
 * global pass made room for, so this asks the one question worth asking: is it still enough?
 *
 * A guess usually adds one word to a region of two hundred and changes its extent by a few
 * units. Shuffling sixty territories to absorb that would make the map restless for no reason
 * — and the point of a territory is that it is still where you learnt it.
 */
const SHIFT = 40;

/**
 * How big each word on the board is drawn, which the arrangement has to know.
 *
 * Not a property of the graph and not of the layout: it is what the *plate* will draw, and the
 * two have to agree or the layout is arranging boxes that are not the size of the words in
 * them. The board hands it in rather than working it out — which is also what lets the daily
 * figure, where every word is the same size, hand in nothing.
 */
export interface Sizes {
  /** The mark this word gets, in graph units. See `markRadius`. */
  radius(word: string): number;
  /** How many moves it has, for the room its name needs beside its mark. */
  degree(word: string): number;
  /** Whether it has been reached — so whether it is showing a name at all. */
  revealed(word: string): boolean;
}

/** Every word the same size, which is the daily board and every test that predates this. */
export const EVEN: Sizes = {
  radius: () => NODE_R,
  degree: () => 1,
  revealed: () => true,
};

/**
 * Air round a rim dot, beyond its own ink.
 *
 * Four units of nothing that wants to sit close to whatever it hangs off — so it claims its ink
 * and a little, and not the berth `boxOf` gives a word that might one day carry a name. A found
 * word's room is `boxOf`, which is the label and the mark together; see `roomFor`.
 */
const RIM_AIR = 9;

/**
 * How much room each word on the board claims, which is **the box nothing else may enter.**
 *
 * Two answers, because this board draws two kinds of thing. A found word is a mark with its name
 * over it or in it, and `boxOf` is the one definition of that — the same arithmetic the region's
 * radius and the figure's bounds are measured with. A rim dot is four units of ink with no name
 * at all, and giving it a word's berth would empty the map of the very thing it is for.
 */
export function roomFor(sizes: Sizes): (word: string) => Room {
  return (word) =>
    sizes.revealed(word)
      ? boxOf(word, true, sizes.degree(word))
      : { w: DOT_R + RIM_AIR, h: DOT_R + RIM_AIR, cy: 0, round: true };
}

/** Where a region sits and how much room it takes. */
export interface Territory {
  /** Its index in `Regions`, or negative for an island — see `clusterGraph`. */
  region: number;
  name: string;
  at: Point;
  /** How far its furthest word reaches from `at`, with air. What holds two apart. */
  radius: number;
  words: string[];
}

export interface Arrangement {
  /** Absolute positions, for every word on the board. */
  positions: Map<string, Point>;
  /** Each word's place within its own region, which is what survives a region moving. */
  offsets: Map<string, Point>;
  territories: Territory[];
  figure: Box;
}

/** What a previous arrangement left behind, so a new one starts where the last one ended. */
export interface Remembered {
  offsets: ReadonlyMap<string, Point>;
  centres: ReadonlyMap<number, Point>;
  /**
   * How big each territory was when it was last arranged.
   *
   * Only so that a pass can tell whether one has grown enough to be worth moving anything for
   * — see `SHIFT`. Absent, every pass rearranges the map, which is what a first one wants.
   */
  radii?: ReadonlyMap<number, number> | undefined;
}

export const NOTHING: Remembered = { offsets: new Map(), centres: new Map() };

/**
 * What to hand the next pass, and what an atlas writes down.
 *
 * Offsets rather than positions, because an offset is what survives its territory moving —
 * and a saved map that stored absolute positions would come back subtly wrong the first time
 * a new region shouldered its neighbours along.
 */
export function remember(laid: Arrangement): Remembered {
  return {
    offsets: laid.offsets,
    centres: new Map(laid.territories.map((one) => [one.region, one.at])),
    radii: new Map(laid.territories.map((one) => [one.region, one.radius])),
  };
}

/**
 * Arrange the board.
 *
 * `settled` is what the atlas remembers, and passing it is what makes a resume exact: a word
 * whose offset is known and whose region is not disturbed does not move at all, so opening a
 * map of three thousand words costs one pass over the regions and nothing else.
 *
 * `disturbed` names the regions to re-settle — the one a guess landed in, and any that have
 * gained a word. Empty means every one of them, which is what a first arrangement wants.
 */
export function arrange(
  clusters: ClusterGraph,
  sizes: Sizes = EVEN,
  settled: Remembered = NOTHING,
): Arrangement {
  const offsets = new Map<string, Point>();
  const radii: number[] = [];
  const room = roomFor(sizes);

  for (const [index, cluster] of clusters.clusters.entries()) {
    /*
      **A territory is quiet when nothing in it has arrived and nothing in it is crowded.**

      It used to be told which regions to disturb, which meant the caller could ask for one
      that had gained nothing — and re-settling a territory with nothing to make room for is
      exactly the churn this is for avoiding: it re-solves an arrangement that was already
      right and moves every word in it. Words never leave a map, so an arrival is the usual
      reason to touch one, and working it out here means nobody can get it wrong.

      **But an arrival is not the only thing that changes what a word needs.** Guessing a rim
      dot turns four units of ink into a mark that can be a hundred across with a name on it,
      and if that word's whole rim happens to fall in *other* regions this one has gained
      nothing — so it was left alone, and the hub was drawn over the crowd it grew into for
      good. Asking whether anything is lying over anything is what makes the promise hold in
      that case and in every other: whatever left an overlap, the next pass undoes it.
    */
    const known = cluster.words.every((word) => settled.offsets.has(word));
    const quiet =
      known &&
      crowded(
        cluster.words.map((word) => ({ id: word, ...settled.offsets.get(word)! })),
        room,
      ).size === 0;

    const placed = quiet
      ? new Map(cluster.words.map((word) => [word, settled.offsets.get(word)!]))
      : layOutRegion(cluster, clusters, sizes, settled, index);

    /*
      How much room the territory needs, which is **the room its words claim and not the points
      they sit on**: a name is wider than its mark, and a region whose radius ignored that would
      have its outermost labels overlap the next territory along.

      And then room for the *ground* on top of that, since the plate drawn under the words stands
      off the furthest of them by its own margin — see `plateReach`. **A territory is exactly its
      own plate**, so the collider below holds two of them at the point where their plates touch
      and the spring rests them `REGION_GAP` apart: the map reads as plates in contact and being
      shoved about by each other, which is what a region is a picture of. Any slack added here is
      added twice over, once per territory, and it comes out as channels of bare ground wider
      than the places either side of them.
    */
    let reach = 0;
    for (const [word, at] of placed) {
      offsets.set(word, at);
      reach = Math.max(reach, Math.hypot(at.x, at.y) + reachOf(room(word)));
    }
    radii.push(plateReach(reach));
  }

  /*
    Rearrange the territories only when there is something to rearrange.

    A guess that lands inside a region the map already holds moves nothing at this scale, and
    running the global pass anyway would nudge sixty centres by a unit or two — which is every
    word on the board moving, on every guess, to say nothing. See `SHIFT`.
  */
  const held = clusters.clusters.map((cluster) => settled.centres.get(cluster.region));
  const steady =
    held.every((centre) => centre !== undefined) &&
    radii.every(
      (radius, index) =>
        radius <= (settled.radii?.get(clusters.clusters[index]!.region) ?? -Infinity) + SHIFT,
    );
  const centres = steady
    ? (held as Point[])
    : layOutTerritories(clusters, radii, settled, held.every((one) => one !== undefined));

  const positions = new Map<string, Point>();
  const territories: Territory[] = [];
  const figure: Box = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let first = true;

  for (const [index, cluster] of clusters.clusters.entries()) {
    const centre = centres[index]!;
    territories.push({
      region: cluster.region,
      name: cluster.name,
      at: centre,
      radius: radii[index]!,
      words: cluster.words,
    });
    for (const word of cluster.words) {
      const offset = offsets.get(word) ?? { x: 0, y: 0 };
      const at = { x: centre.x + offset.x, y: centre.y + offset.y };
      positions.set(word, at);
      // The same reach the territory's radius and the ground under it are measured with, so a
      // word at the edge of the map has its name in shot rather than half off it.
      const claim = reachOf(room(word));
      if (first) {
        figure.minX = at.x - claim;
        figure.maxX = at.x + claim;
        figure.minY = at.y - claim;
        figure.maxY = at.y + claim;
        first = false;
      } else {
        figure.minX = Math.min(figure.minX, at.x - claim);
        figure.maxX = Math.max(figure.maxX, at.x + claim);
        figure.minY = Math.min(figure.minY, at.y - claim);
        figure.maxY = Math.max(figure.maxY, at.y + claim);
      }
    }
  }

  return { positions, offsets, territories, figure };
}

/**
 * One territory's own words, in coordinates about its centre.
 *
 * Seeded from where they were, or — for a word arriving now — from the mean of whichever
 * neighbours already have a place. A force layout settles into whichever arrangement is
 * nearest where it began, so where a newcomer *starts* decides more than any force does: a
 * word dropped at the origin of a settled region has to push its way out through everything,
 * and where it ends up is a record of that fight rather than of the graph.
 */
function layOutRegion(
  cluster: ClusterGraph['clusters'][number],
  clusters: ClusterGraph,
  sizes: Sizes,
  settled: Remembered,
  index: number,
): Map<string, Point> {
  /*
    Warm when most of it is already arranged: then this is making room for a newcomer rather
    than finding a shape, and a long run would only shuffle what was already right.

    **Unless a good part of it is lying over itself**, which a warm pass cannot fix: a warm pass
    pins everything it is not making room for, and a crowd where a quarter of the words are
    overlapping needs the whole neighbourhood to give way rather than a gap opened in it. That is
    what revealing a word does when its mark grows from four units to a hundred.
  */
  const room = roomFor(sizes);
  const crowding = crowded(
    cluster.words
      .filter((word) => settled.offsets.has(word))
      .map((word) => ({ id: word, ...settled.offsets.get(word)! })),
    room,
  );
  const known = cluster.words.filter((word) => settled.offsets.has(word)).length;
  const warm = known > cluster.words.length / 2 && crowding.size <= cluster.words.length / 4;
  const near = new Map<string, string[]>();
  const degree = new Map<string, number>();
  for (const { a, b } of cluster.inside) {
    (near.get(a) ?? near.set(a, []).get(a)!).push(b);
    (near.get(b) ?? near.set(b, []).get(b)!).push(a);
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  /*
    Which way is *out*, for a word with a move leading to another territory.

    The direction the other region's centre lies in, as it was last arranged — so this reads a
    remembered position rather than one this pass is about to compute. That is not a
    compromise: a bridge should face where its neighbour has been all along, and using a centre
    that is itself still moving would aim it at nothing in particular.
  */
  const mine = settled.centres.get(cluster.region);
  const outward = new Map<string, Point>();
  if (mine) {
    const towards = new Map<string, { x: number; y: number }>();
    for (const edge of clusters.across) {
      // One end of this move is in this region and the other is not; the one that is, is the
      // bridge, and the way out is wherever the region at the far end has been sitting.
      const here = clusters.home.get(edge.a) === index ? edge.a : edge.b;
      const there = here === edge.a ? edge.b : edge.a;
      if (clusters.home.get(here) !== index) continue;
      const other = clusters.clusters[clusters.home.get(there) ?? -1];
      const at = other ? settled.centres.get(other.region) : undefined;
      if (!at) continue;
      const span = Math.hypot(at.x - mine.x, at.y - mine.y) || 1;
      const acc = towards.get(here) ?? { x: 0, y: 0 };
      acc.x += (at.x - mine.x) / span;
      acc.y += (at.y - mine.y) / span;
      towards.set(here, acc);
    }
    for (const [word, acc] of towards) {
      const span = Math.hypot(acc.x, acc.y);
      // A word bridging two territories that lie in opposite directions has no way out to
      // face, so it is left to the links to place like any other.
      if (span < 1e-6) continue;
      outward.set(word, { x: (acc.x / span) * REGION_GAP, y: (acc.y / span) * REGION_GAP });
    }
  }

  const nodes: SimNode[] = cluster.words.map((word) => {
    const kept = settled.offsets.get(word);
    return { id: word, x: kept?.x ?? 0, y: kept?.y ?? 0 };
  });
  const at = new Map(nodes.map((node) => [node.id, node]));

  /*
    **On a warm pass, only what the guess touched is free to move.**

    This is the difference between a map growing and a map churning. A warm settle over the
    whole territory re-solves it — measured, a single guess moved three hundred and sixty-eight
    words, the furthest by three hundred and forty units — and what a player sees is the
    neighbourhood they know shuffling itself every time they type. Nothing asked for that: the
    board gained one word.

    So the newcomers move, and whatever they are joined to moves to let them in, and everything
    else is pinned exactly where it was. The pinned words are still in the simulation and still
    collide, so they are walls the arrival has to find room against rather than absent — which
    is what makes it look like something growing into a space rather than a space rearranging.

    **And whatever is lying over something else, which is the one thing a pin may not preserve.**
    A word does not only *arrive*: guessing a rim dot turns four units of ink into a mark that can
    be a hundred across, and that word was already placed, so it is not arriving and the crowd
    now inside it was pinned exactly where it was. Freeing everything crowded is what makes the
    promise self-correcting — whatever left an overlap, a grown mark or a pass that ran out of
    ticks, the next pass is free to undo it — and it costs nothing on a board that has none,
    which after the first pass is every board.

    A cold pass pins nothing: there is nothing to preserve and the whole shape is being found.
  */
  const arriving = cluster.words.filter((word) => !settled.offsets.has(word));
  if (warm) {
    const free = new Set([...arriving, ...crowding]);
    for (const word of [...free]) for (const other of near.get(word) ?? []) free.add(other);
    for (const node of nodes) {
      if (free.has(node.id)) continue;
      node.fx = node.x;
      node.fy = node.y;
    }
  }

  // A newcomer starts on the mean of its placed neighbours, off it by a deterministic hair so
  // that a word joined to exactly one of them has a direction to leave in.
  for (const node of nodes) {
    if (settled.offsets.has(node.id)) continue;
    const anchors = (near.get(node.id) ?? [])
      .map((other) => (settled.offsets.has(other) ? at.get(other) : undefined))
      .filter((one): one is SimNode => one !== undefined);
    if (anchors.length === 0) continue;
    node.x = anchors.reduce((sum, one) => sum + (one.x ?? 0), 0) / anchors.length;
    node.y = anchors.reduce((sum, one) => sum + (one.y ?? 0), 0) / anchors.length;
    const away = ((node.id.charCodeAt(0) + node.id.length) % 8) / 8;
    node.x += Math.cos(away * Math.PI * 2) * 30;
    node.y += Math.sin(away * Math.PI * 2) * 30;
  }

  const links: SimLink[] = cluster.inside.map(({ a, b }) => ({ source: a, target: b }));
  const bridge = (node: SimNode) => (outward.has(node.id) ? OUTWARD : 0);

  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((node) => node.id)
        .distance((link) =>
          linkDistance(
            Math.max(
              degree.get(typeof link.source === 'string' ? link.source : link.source.id) ?? 1,
              degree.get(typeof link.target === 'string' ? link.target : link.target.id) ?? 1,
            ),
          ),
        )
        .strength(LINK_STRENGTH),
    )
    /*
      **Nothing drawn may lie over anything else drawn, and a word is not a disc.**

      It was a disc — the mark and some air, and never the name standing over it, on the argument
      that a big word carries its name inside itself and what is left is a label problem rather
      than a node one. It is not: `insideLabel` takes a name in only where the mark has grown
      enough to hold it, so most of a map's names are *outside* their marks, and those are what
      collide. A crowd of five-letter words held apart by their fourteen-unit discs is five
      labels written across each other.

      So what is kept apart is the box the word occupies, names and all — see `forceBoxes`, and
      `roomFor` for what a rim dot claims as against a word with a name.
    */
    .force('room', forceBoxes(room))
    // Toward whichever way out a bridge has, and nothing at all for anything else: a region's
    // shape is what its own moves make it. See `CHARGE_REACH`.
    .force('place', forceX<SimNode>((node) => outward.get(node.id)?.x ?? 0).strength(bridge))
    .force('placeY', forceY<SimNode>((node) => outward.get(node.id)?.y ?? 0).strength(bridge))
    // Last, so it scales whatever every force above decided. See `forceMass`.
    .force('mass', forceMass((id) => mobility(sizes.radius(id))))
    .stop();

  settle(simulation, warm ? WARM_ALPHA : 1, warm ? WARM_TICKS : COLD_TICKS);

  /*
    And then the overlaps are simply taken out.

    A force is a tendency and this promise is absolute: a link pulling two words together and a
    box force pushing them apart settle at a balance, and where the link is the stronger that
    balance is a small overlap. A settle also stops on a tick budget rather than at rest. So the
    arrangement is found by the simulation and then *made true* by `relax`, which is a far easier
    problem — local, and one that has a solution.

    **And when a warm pass cannot keep the promise, it gives way to a cold one.** Freeing the
    arrival and whatever it landed among is usually enough room; sometimes it is not, and then
    the pinned words are walls with a word wedged between them and no pass over the free ones
    will ever separate it. Keeping the neighbourhood still is a preference and not overlapping is
    a promise, so the preference is what yields: everything is unpinned and the territory finds
    its shape again. Rare, and the one case where a player sees their neighbourhood rearrange.
  */
  if (relax(nodes, room) > 0 && warm) {
    for (const node of nodes) {
      delete node.fx;
      delete node.fy;
    }
    settle(simulation, 1, COLD_TICKS);
    relax(nodes, room);
  }

  // About its own middle, so a region that grew lopsided does not drag its centre with it —
  // and so the radius measured from here is the radius of the blob rather than of its
  // furthest excursion from an arbitrary origin.
  let cx = 0;
  let cy = 0;
  for (const node of nodes) {
    cx += node.x ?? 0;
    cy += node.y ?? 0;
  }
  cx /= nodes.length || 1;
  cy /= nodes.length || 1;

  return new Map(nodes.map((node) => [node.id, { x: (node.x ?? 0) - cx, y: (node.y ?? 0) - cy }]));
}

/**
 * The territories against each other: tens of discs, joined where moves cross between them.
 *
 * The collider is the point of this. Two regions that overlap are not two places, and the
 * whole reason the map is carved up is so that a player can say "that bit over there" and mean
 * something. Everything else is ordinary: a spring per crossing, weighted by how many moves
 * cross, and a weak repulsion so that regions joined to nothing still find their own air.
 */
function layOutTerritories(
  clusters: ClusterGraph,
  radii: readonly number[],
  settled: Remembered,
  warm = false,
): Point[] {
  const nodes: SimNode[] = clusters.clusters.map((cluster, index) => {
    const kept = settled.centres.get(cluster.region);
    return { id: String(index), x: kept?.x ?? 0, y: kept?.y ?? 0 };
  });

  /*
    Where a territory with no remembered place starts.

    **On a cold map this decides the whole thing.** Every node begins at the origin, so seeding
    a newcomer on the mean of its joined neighbours seeds it on the origin too — sixty discs at
    one point, which a collider resolves by flinging them apart and a link force is far too
    weak to gather back. Measured, that came out at 120,000 units across for a map that needs
    about 12,000, and no centring strength fixed it: the arrangement was already made by the
    time any force could argue with it.

    So a cold map is *pre-packed* rather than seeded: the territories are laid on a sunflower
    spiral whose spacing is taken from their own areas, largest first, which is already a
    tolerable packing. The simulation then does what it is for — pulling joined territories
    together and resolving what the packing left overlapping — instead of untangling a knot.
  */
  const at = new Map(nodes.map((node) => [node.id, node]));
  const fresh = clusters.clusters
    .map((cluster, index) => ({ cluster, index }))
    .filter(({ cluster }) => !settled.centres.has(cluster.region));

  if (fresh.length === nodes.length) {
    // Nothing is placed: pack the lot. Area to cover, at a packing density a spiral achieves.
    const area = radii.reduce((sum, radius) => sum + radius * radius, 0) / SPIRAL_DENSITY;
    const step = Math.sqrt(area) / Math.sqrt(Math.max(nodes.length, 1));
    const order = [...fresh].sort(
      (one, two) => (radii[two.index] ?? 0) - (radii[one.index] ?? 0),
    );
    order.forEach(({ index }, rank) => {
      const node = at.get(String(index))!;
      const away = step * Math.sqrt(rank);
      node.x = Math.cos(rank * GOLDEN_ANGLE) * away;
      node.y = Math.sin(rank * GOLDEN_ANGLE) * away;
    });
  } else {
    // A territory appearing on a map that already has some starts beside whatever it is joined
    // to, off it by its own radius so the collider has somewhere to push it rather than a
    // coincident point to resolve.
    for (const { index } of fresh) {
      const joined = clusters.links
        .filter((link) => link.a === index || link.b === index)
        .map((link) => at.get(String(link.a === index ? link.b : link.a)))
        .filter((one): one is SimNode => one !== undefined && settled.centres.has(
          clusters.clusters[Number(one.id)]?.region ?? Number.NaN,
        ));
      const node = at.get(String(index))!;
      let x = 0;
      let y = 0;
      if (joined.length > 0) {
        x = joined.reduce((sum, one) => sum + (one.x ?? 0), 0) / joined.length;
        y = joined.reduce((sum, one) => sum + (one.y ?? 0), 0) / joined.length;
      }
      const away = (index % 8) / 8;
      node.x = x + Math.cos(away * Math.PI * 2) * (radii[index] ?? REGION_GAP);
      node.y = y + Math.sin(away * Math.PI * 2) * (radii[index] ?? REGION_GAP);
    }
  }

  const links: SimLink[] = clusters.links.map((link) => ({
    source: String(link.a),
    target: String(link.b),
  }));

  const simulation = forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((node) => node.id)
        .distance((link) => {
          const one = Number(typeof link.source === 'string' ? link.source : link.source.id);
          const two = Number(typeof link.target === 'string' ? link.target : link.target.id);
          return (radii[one] ?? 0) + (radii[two] ?? 0) + REGION_GAP;
        })
        .strength(REGION_LINK_STRENGTH),
    )
    .force('home', forceX<SimNode>(0).strength(REGION_HOME))
    .force('homeY', forceY<SimNode>(0).strength(REGION_HOME))
    .force(
      'room',
      forceCollide<SimNode>().radius((node) => radii[Number(node.id)] ?? 0),
    )
    .stop();

  settle(simulation, warm ? GLOBAL_WARM_ALPHA : 1, warm ? GLOBAL_WARM_TICKS : GLOBAL_COLD_TICKS);

  return nodes.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 }));
}
