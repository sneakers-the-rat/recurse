/**
 * Where a mark lands.
 *
 * The claims worth pinning are the ones a screenshot would not catch: that zero — par — is
 * where the chart says it is, that a better round is drawn *above* a worse one in a
 * coordinate system where y grows downward, and that a single round does not divide by the
 * width of its own range and land off the frame.
 */

import { describe, expect, it } from 'vitest';
import { areaOf, histogramChart, hintChart, scoreChart, type Frame } from './chart';
import { parBuckets, type Completion } from './stats';

const frame: Frame = { width: 300, height: 100, pad: { left: 20, right: 10, top: 10, bottom: 20 } };
const area = areaOf(frame);

function done(over: Partial<Completion> = {}): Completion {
  return {
    key: 'base>baseball',
    id: 'aaaa1111',
    day: 0,
    date: '2026-07-26',
    band: 0,
    par: 4,
    secret: 0,
    guesses: 4,
    misses: 0,
    letters: 0,
    shapes: 0,
    marks: 'gggg',
    words: [],
    backfilled: false,
    ...over,
  };
}

describe('scoreChart', () => {
  it('has nothing to draw for no rounds', () => {
    expect(scoreChart([], frame)).toBeNull();
  });

  it('dips below the zero line for a round that beat par', () => {
    const chart = scoreChart(
      [done({ key: 'a', day: 0, guesses: 3 }), done({ key: 'b', day: 1, guesses: 6 })],
      frame,
    )!;
    const [under, over] = chart.dots;
    expect(under!.diff).toBe(-1);
    expect(over!.diff).toBe(2);
    // y grows downward, so "below the line" is a larger y — and that is where the gilt is.
    expect(under!.y).toBeGreaterThan(chart.zero);
    expect(over!.y).toBeLessThan(chart.zero);
  });

  it('keeps par in shot even when nothing came near it', () => {
    const chart = scoreChart([done({ guesses: 9, par: 4 })], frame)!;
    expect(chart.zero).toBeGreaterThan(area.top);
    expect(chart.zero).toBeLessThanOrEqual(area.bottom);
    expect(chart.ticks.some((tick) => tick.diff === 0)).toBe(true);
  });

  it('puts a single round in the middle rather than dividing by nothing', () => {
    const chart = scoreChart([done()], frame)!;
    expect(chart.dots[0]!.x).toBe((area.left + area.right) / 2);
    expect(Number.isFinite(chart.dots[0]!.y)).toBe(true);
  });

  it('runs left to right in calendar order, whatever order the log is in', () => {
    const chart = scoreChart([done({ key: 'b', day: 8 }), done({ key: 'a', day: 2 })], frame)!;
    expect(chart.dots.map((dot) => dot.key)).toEqual(['a', 'b']);
    expect(chart.dots[0]!.x).toBeLessThan(chart.dots[1]!.x);
  });

  it('draws the mean where the mean is', () => {
    const chart = scoreChart(
      [done({ key: 'a', day: 0, guesses: 3 }), done({ key: 'b', day: 1, guesses: 5 })],
      frame,
    )!;
    expect(chart.mean).toBe(0);
    expect(chart.meanY).toBeCloseTo(chart.zero);
  });

  it('stops the axis becoming a ladder over a wide range', () => {
    const wide = [0, 20].map((extra, day) => done({ key: `k${day}`, day, guesses: 4 + extra }));
    const chart = scoreChart(wide, frame)!;
    expect(chart.ticks.length).toBeLessThanOrEqual(9);
  });
});

describe('histogramChart', () => {
  it('draws a column per step of the range, tallest one full height', () => {
    const chart = histogramChart(
      parBuckets([done({ key: 'a', guesses: 4 }), done({ key: 'b', guesses: 4 }), done({ key: 'c', guesses: 5 })]),
      frame,
    )!;
    expect(chart.bars.map((bar) => bar.count)).toEqual([2, 1]);
    expect(chart.most).toBe(2);
    expect(chart.bars[0]!.height).toBe(area.bottom - area.top);
    expect(chart.bars[0]!.y + chart.bars[0]!.height).toBeCloseTo(area.bottom);
  });

  it('draws an empty step as an empty step, not as no step', () => {
    const chart = histogramChart(parBuckets([done({ guesses: 7, par: 4 })]), frame)!;
    // −0 through +3, and only the last of them has anything in it.
    expect(chart.bars).toHaveLength(4);
    expect(chart.bars[0]!.height).toBe(0);
  });

  it('has nothing to draw for no rounds', () => {
    expect(histogramChart(parBuckets([]), frame)).toBeNull();
  });
});

describe('hintChart', () => {
  it('stacks the shapes on top of the letters, both sitting on the floor', () => {
    const chart = hintChart([done({ letters: 3, shapes: 1 })], frame)!;
    const [stack] = chart.stacks;
    expect(stack!.letters.y + stack!.letters.height).toBeCloseTo(area.bottom);
    expect(stack!.shapes.y + stack!.shapes.height).toBeCloseTo(stack!.letters.y);
    expect(chart.most).toBe(4);
  });

  it('draws a round that cost nothing as nothing', () => {
    const chart = hintChart([done({ letters: 0, shapes: 0 })], frame)!;
    expect(chart.stacks[0]!.letters.height).toBe(0);
    expect(chart.stacks[0]!.shapes.height).toBe(0);
  });

  it('shares the day axis with the score chart, so the two read as one timeline', () => {
    const records = [done({ key: 'a', day: 2 }), done({ key: 'b', day: 9 })];
    const hints = hintChart(records, frame)!;
    const scores = scoreChart(records, frame)!;
    for (let i = 0; i < 2; i++) {
      expect(hints.stacks[i]!.x + hints.stacks[i]!.width / 2).toBeCloseTo(scores.dots[i]!.x);
    }
  });
});
