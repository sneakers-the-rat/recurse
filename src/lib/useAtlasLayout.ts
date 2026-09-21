/**
 * The atlas's layout, alive: what it looks like now, and how it gets from there to where it
 * is going.
 *
 * `atlasLayout.ts` answers where the words *should* be, in one synchronous pass, and answers
 * it the same way every time. This is the rest: remembering the last answer so the next one
 * starts from it, and moving the board from one to the other.
 *
 * **It does not publish simulation ticks, and that is the whole difference from the daily
 * board.** `useBoardLayout` re-renders the plate on every tick of its own simulation, which is
 * right for thirty words and impossible for four thousand — and it means the motion on screen
 * is whatever the physics happened to do, which at this scale is a shudder. So the arrangement
 * is *solved* first, off screen, and then oozed into: one animation frame loop easing every
 * word that actually moved from where it was to where it now belongs. A guess costs one solve
 * and then a glide, and the glide is the same length whatever the physics did.
 *
 * Which is also the animation the game wants. A word arriving does not appear in its final
 * place; it comes out of whatever it was reached from and its neighbourhood shoulders over to
 * take it in, slowly enough to watch. The edges reaching out to meet it are the plate's half of
 * that — see `sprouting` in PlateEdge.
 *
 * **A word that has just arrived is oozed on its own clock**, and everything else on the board's.
 * A guess onto a hub brings a hundred and eighty words in at once, and moving them all on one
 * timeline draws a starburst: one radius, one speed, done. So each newcomer is given a delay and
 * a speed of its own by `sprout.ts` and travels on those, while the neighbourhood shouldering
 * over to make room keeps the single `OOZE_MS` — that motion is the board answering, and it
 * should read as one thing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  arrange,
  remember,
  type Sizes,
  type Arrangement,
  type Remembered,
  type Territory,
} from './atlasLayout';
import { ease } from './camera';
import type { Box } from './camera';
import type { Figure } from './plate';
import { clusterGraph, type Regions } from './regions';
import { NO_ENTRANCE, type Entrances } from './sprout';
import type { Point } from './types';

/**
 * How long a word already on the board takes to shoulder over into a new arrangement.
 *
 * Long, by this codebase's standards — a guess on the daily board eases in over four tenths of
 * a second. An atlas is a map rather than a figure, and what moves when a word arrives is its
 * whole neighbourhood making room; at four tenths that reads as a twitch, and the thing worth
 * seeing is the room being made.
 *
 * A word *arriving* does not use this: it has a delay and a speed of its own. See `Entrances`.
 */
const OOZE_MS = 900;

export interface AtlasView {
  /** Where each word is being drawn *right now*, part way through the glide. */
  positions: ReadonlyMap<string, Point>;
  /** Where each one is going, which is what a territory's bounds are measured on. */
  territories: readonly Territory[];
  figure: Box;
  /** What the atlas writes down, so opening it again is exact and instant. */
  settled: Remembered;
  /** True while the board is still moving. */
  moving: boolean;
}

export function useAtlasLayout(
  figure: Figure | null,
  regions: Regions,
  /** How big each word is drawn, which the arrangement has to agree with. See `Sizes`. */
  sizes: Sizes,
  /**
   * What the atlas remembered, read once when it opens.
   *
   * Its *identity* is the signal that a different atlas is on screen: pass a new object and
   * everything below starts again, pass the same one and the board carries on. A map with
   * saved offsets never settles at all — every territory is quiet, so opening three thousand
   * words costs a pass over the regions and nothing else.
   */
  saved: Remembered | null,
  /**
   * When each word that has just arrived comes out, and how fast it travels.
   *
   * The board decides this rather than this hook working it out, because the *plate* needs the
   * identical schedule to time its marks and its lines against — see `entrances`. Absent, every
   * newcomer travels on `OOZE_MS` with the rest of the board.
   */
  arrivals: Entrances = NO_ENTRANCE,
): AtlasView | null {
  const settled = useRef<Remembered | null>(null);
  const opened = useRef<Remembered | null>(null);
  if (opened.current !== saved) {
    opened.current = saved;
    settled.current = saved;
  }

  /**
   * Where the board is going.
   *
   * Idempotent on purpose, which is what makes writing to a ref from a memo safe here: run
   * twice on the same figure, the second pass finds every word's offset already remembered,
   * disturbs nothing, and returns the identical arrangement.
   */
  const target = useMemo<Arrangement | null>(() => {
    if (!figure) return null;
    const clusters = clusterGraph(figure, regions);
    // Which territories have gained a word since the last pass is `arrange`'s own question —
    // it is the only reason to touch one, and it can see the answer in what it remembers.
    const laid = arrange(clusters, sizes, settled.current ?? undefined);
    settled.current = remember(laid);
    return laid;
  }, [figure, regions, sizes]);

  /**
   * Where the board is, which is not the same thing until the glide has finished.
   *
   * A ref rather than state, because it changes on every animation frame and the frame counter
   * beside it is what asks for the render. Keeping a `Map` in state would allocate a second
   * one per frame to satisfy React's identity check, for a value nothing compares.
   */
  const shown = useRef(new Map<string, Point>());
  const [frame, setFrame] = useState(0);
  const [moving, setMoving] = useState(false);
  const glide = useRef<number | null>(null);

  useEffect(() => {
    if (!target) return;

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const now = shown.current;

    /*
      Where each word starts from.

      One it has already: wherever it is being drawn. One arriving: the middle of whichever of
      its neighbours are already on the board, so it comes out of the map rather than fading
      in over it — and its own place if it has none, which is the first word of an atlas.
    */
    const from = new Map<string, Point>();
    const coming: string[] = [];
    for (const [word, at] of target.positions) {
      const here = now.get(word);
      if (here) from.set(word, here);
      else {
        from.set(word, at);
        coming.push(word);
      }
    }
    if (coming.length > 0) {
      const wanted = new Set(coming);
      const anchors = new Map<string, Point[]>();
      for (const { a, b } of figure?.edges ?? []) {
        if (wanted.has(a) && now.has(b)) (anchors.get(a) ?? anchors.set(a, []).get(a)!).push(now.get(b)!);
        if (wanted.has(b) && now.has(a)) (anchors.get(b) ?? anchors.set(b, []).get(b)!).push(now.get(a)!);
      }
      for (const [word, out] of anchors) {
        from.set(word, {
          x: out.reduce((sum, one) => sum + one.x, 0) / out.length,
          y: out.reduce((sum, one) => sum + one.y, 0) / out.length,
        });
      }
    }

    /*
      Only the words that actually move, each with the clock it moves on. On a settled board of
      four thousand that is usually a couple of hundred, and interpolating the rest would be
      four thousand object allocations a frame to arrive back where they started.

      A newcomer travels on its own entrance; everything else is the neighbourhood making room,
      and that is one motion at one speed.
    */
    const travelling = [...target.positions]
      .filter(([word, to]) => {
        const start = from.get(word)!;
        return Math.abs(start.x - to.x) > 0.5 || Math.abs(start.y - to.y) > 0.5;
      })
      .map(([word, to]) => {
        const entrance = arrivals.nodes.get(word);
        return {
          word,
          to,
          from: from.get(word)!,
          delay: entrance?.delay ?? 0,
          duration: entrance?.duration ?? OOZE_MS,
        };
      });

    const arrive = () => {
      shown.current = new Map(target.positions);
      setFrame((n) => n + 1);
      setMoving(false);
    };

    if (still || travelling.length === 0) {
      arrive();
      return;
    }

    // Everything that is not moving is simply there, from the first frame.
    shown.current = new Map(target.positions);
    setMoving(true);

    const until = travelling.reduce((most, one) => Math.max(most, one.delay + one.duration), 0);
    const began = performance.now();
    const step = () => {
      const since = performance.now() - began;
      const next = new Map(target.positions);
      for (const one of travelling) {
        // Held at its starting point through its own delay, which is the same thing the mark's
        // own animation is doing in CSS over the same interval — see `.sprout`.
        const at = ease(Math.min(Math.max((since - one.delay) / one.duration, 0), 1));
        next.set(one.word, {
          x: one.from.x + (one.to.x - one.from.x) * at,
          y: one.from.y + (one.to.y - one.from.y) * at,
        });
      }
      shown.current = next;
      setFrame((n) => n + 1);
      if (since < until) {
        glide.current = requestAnimationFrame(step);
        return;
      }
      shown.current = new Map(target.positions);
      glide.current = null;
      setMoving(false);
    };
    glide.current = requestAnimationFrame(step);

    return () => {
      if (glide.current !== null) cancelAnimationFrame(glide.current);
      glide.current = null;
    };
  }, [target, figure, arrivals]);

  return useMemo(() => {
    if (!target) return null;
    return {
      positions: shown.current,
      territories: target.territories,
      figure: target.figure,
      settled: settled.current ?? remember(target),
      moving,
    };
    // `shown.current` is read through the frame counter, which is what a glide bumps.
     
  }, [target, moving, frame]);
}
