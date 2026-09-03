/**
 * Records to coordinates.
 *
 * Everything a chart on the stats screen needs to be drawn, worked out here so that
 * `Chart.tsx` does nothing but emit shapes — which is the same division the rest of the
 * client keeps, and here it buys something specific: where a mark lands is arithmetic, and
 * arithmetic is testable without a browser. A chart that puts the zero line in the wrong
 * place is a bug nobody would see in a screenshot until the day it mattered.
 *
 * There is no charting library, and that is a decision. The game has three runtime
 * dependencies and an explicit bar for a fourth; two scatter plots and a bar chart are a
 * hundred lines of `Math.min` either way, and a library would arrive with a type scale, a
 * colour palette and a set of default axes, none of which are this game's.
 *
 * Coordinates are SVG's: y grows downward, and the y axis is flipped back so that more
 * guesses is higher up. A round that beat par therefore *dips below* the zero line, which is
 * what puts it in gilt — the colour this game uses for arriving, and the only good direction
 * there is on this chart. Everything is in the frame's own pixels, with no transform, because
 * a transform would scale the stroke widths and the type along with the geometry.
 */

import type { Completion } from './stats';

/** The box a chart is drawn in, and the room reserved inside it for labels. */
export interface Frame {
  width: number;
  height: number;
  pad: { left: number; right: number; top: number; bottom: number };
}

/** The part of the frame marks may occupy. */
export interface Area {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function areaOf(frame: Frame): Area {
  return {
    left: frame.pad.left,
    right: frame.width - frame.pad.right,
    top: frame.pad.top,
    bottom: frame.height - frame.pad.bottom,
  };
}

/** A value in `[from, to]` placed in `[low, high]`. A zero-width span lands in the middle. */
function place(value: number, from: number, to: number, low: number, high: number): number {
  if (to === from) return (low + high) / 2;
  return low + ((value - from) / (to - from)) * (high - low);
}

/** One round, as a mark. */
export interface Dot {
  x: number;
  y: number;
  /** Which of the three lengths, which is what the mark's *shape* says. */
  band: number;
  /** Guesses minus par: negative is under par, below the line, and drawn gilt. */
  diff: number;
  date: string;
  key: string;
}

export interface ScoreChart {
  area: Area;
  dots: Dot[];
  /** Where par itself is: the line every mark is read against. */
  zero: number;
  /** The average score against par, as a value and as a line. */
  mean: number;
  meanY: number;
  /** Whole numbers of guesses above and below par, labelled. */
  ticks: { y: number; label: string; diff: number }[];
}

/**
 * Where the y axis runs, in whole guesses either side of par.
 *
 * Zero is always in it, because par is what the chart is about and a chart that cropped it
 * out would be a chart of nothing. Half a step of air at each end keeps the extreme marks
 * off the frame's own rules, where they read as clipped rather than as extreme.
 */
function diffRange(diffs: readonly number[]): { low: number; high: number } {
  return { low: Math.min(0, ...diffs), high: Math.max(0, ...diffs) };
}

/**
 * Enough ticks to read the scale by, and no more.
 *
 * Every whole guess while the range is small, every second one once it is not — a tick per
 * row of type is a ladder rather than an axis, and this axis is about four centimetres tall.
 */
function tickStride(span: number): number {
  return span <= 8 ? 1 : Math.ceil(span / 8);
}

/** Rounds in calendar order, which is the order every chart here is drawn in. */
function inOrder(records: readonly Completion[]): Completion[] {
  return [...records].sort((a, b) => a.day - b.day || a.band - b.band);
}

export function scoreChart(records: readonly Completion[], frame: Frame): ScoreChart | null {
  const rounds = inOrder(records);
  if (rounds.length === 0) return null;

  const area = areaOf(frame);
  const diffs = rounds.map((one) => one.guesses - one.par);
  const { low, high } = diffRange(diffs);
  const from = low - 0.5;
  const to = high + 0.5;

  const days = rounds.map((one) => one.day);
  const first = Math.min(...days);
  const last = Math.max(...days);

  // Flipped out of SVG's downward y, so more guesses is higher and beating par dips below
  // the line rather than rising above it.
  const yOf = (diff: number) => place(diff, from, to, area.bottom, area.top);
  const xOf = (day: number) => place(day, first, last, area.left, area.right);

  const total = diffs.reduce((sum, diff) => sum + diff, 0);
  const mean = total / diffs.length;

  const stride = tickStride(high - low);
  const ticks: ScoreChart['ticks'] = [];
  for (let diff = low; diff <= high; diff += stride) {
    ticks.push({ diff, y: yOf(diff), label: diff > 0 ? `+${diff}` : String(diff) });
  }

  return {
    area,
    dots: rounds.map((one) => ({
      x: xOf(one.day),
      y: yOf(one.guesses - one.par),
      band: one.band,
      diff: one.guesses - one.par,
      date: one.date,
      key: one.key,
    })),
    zero: yOf(0),
    mean,
    meanY: yOf(mean),
    ticks,
  };
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Guesses minus par, which this column counts. */
  diff: number;
  count: number;
  /** The middle of the column, for its label. */
  centre: number;
}

export interface HistogramChart {
  area: Area;
  bars: Bar[];
  /** The tallest column, which is what the others are drawn against. */
  most: number;
}

/**
 * The distribution of scores against par.
 *
 * Readable after five rounds rather than fifty, which is the point of it beside the scatter:
 * five marks scattered over a fortnight say very little, and five stacked into three columns
 * say "mostly par, once over, never under".
 *
 * Columns are equal width across whatever range occurred, including the steps nothing landed
 * on — a gap in a distribution is information, and closing it up would make an even spread
 * out of a bimodal one.
 */
export function histogramChart(
  buckets: readonly { diff: number; count: number }[],
  frame: Frame,
): HistogramChart | null {
  if (buckets.length === 0) return null;
  const area = areaOf(frame);
  const most = Math.max(...buckets.map((one) => one.count));
  const step = (area.right - area.left) / buckets.length;
  // A hairline between columns rather than a gutter: the columns are the figure, and at four
  // or five of them a wide gutter reads as four charts.
  const width = Math.max(1, step - 2);

  return {
    area,
    bars: buckets.map((one, index) => {
      const height = most === 0 ? 0 : ((area.bottom - area.top) * one.count) / most;
      const x = area.left + index * step + (step - width) / 2;
      return {
        x,
        width,
        height,
        y: area.bottom - height,
        diff: one.diff,
        count: one.count,
        centre: x + width / 2,
      };
    }),
    most,
  };
}

export interface Stack {
  x: number;
  width: number;
  /** Letters bought, at the foot of the column; move shapes stacked on top of them. */
  letters: { y: number; height: number; count: number };
  shapes: { y: number; height: number; count: number };
  date: string;
  key: string;
}

export interface HintChart {
  area: Area;
  stacks: Stack[];
  /** The most hints any one round cost. */
  most: number;
}

/**
 * Hints per round, on the same day axis as the scores, so the two charts read as one
 * timeline: a run of gold on the top chart and a wall of columns underneath it is a story.
 *
 * Stacked rather than side by side, because the height that matters first is the total —
 * what a round cost in help — and the split between letters and shapes is the second
 * question, not the first.
 */
export function hintChart(records: readonly Completion[], frame: Frame): HintChart | null {
  const rounds = inOrder(records);
  if (rounds.length === 0) return null;

  const area = areaOf(frame);
  const days = rounds.map((one) => one.day);
  const first = Math.min(...days);
  const last = Math.max(...days);
  const most = Math.max(1, ...rounds.map((one) => one.letters + one.shapes));
  const tall = area.bottom - area.top;

  // Wide enough to see, narrow enough that a busy fortnight is still columns rather than a
  // solid block. A single round gets a column of the same width as a hundred would.
  const width = Math.max(2, Math.min(10, (area.right - area.left) / Math.max(rounds.length, 8)));

  return {
    area,
    most,
    stacks: rounds.map((one) => {
      const letters = (tall * one.letters) / most;
      const shapes = (tall * one.shapes) / most;
      return {
        x: place(one.day, first, last, area.left, area.right) - width / 2,
        width,
        letters: { y: area.bottom - letters, height: letters, count: one.letters },
        shapes: { y: area.bottom - letters - shapes, height: shapes, count: one.shapes },
        date: one.date,
        key: one.key,
      };
    }),
  };
}
