/**
 * What an arrival's timing has to be true of.
 *
 * How it *looks* is taste and the contact sheet's business. What can be asserted is the four
 * promises the schedule is for: the word the player reached is first, a big arrival takes longer
 * than a small one, a move waits for the word at the end of it, and the same guess is timed the
 * same way twice.
 */

import { describe, expect, it } from 'vitest';
import { dice, entrances, NO_ENTRANCE } from './sprout';

const edgesOf = (...pairs: [string, string][]) => pairs.map(([a, b]) => ({ a, b }));

describe('entrances', () => {
  it('has nothing to schedule when nothing arrived', () => {
    expect(entrances(new Set(), () => false, edgesOf(['a', 'b']))).toBe(NO_ENTRANCE);
  });

  it('brings the word the player reached out first, at nothing', () => {
    const arriving = new Set(['cage', 'cages', 'page', 'caged']);
    const timed = entrances(arriving, (word) => word === 'cage', []);
    expect(timed.nodes.get('cage')!.delay).toBe(0);
    for (const word of ['cages', 'page', 'caged']) {
      expect(timed.nodes.get(word)!.delay).toBeGreaterThan(0);
    }
  });

  /** The whole point: what a big guess opened up is what it is paid in. */
  it('takes longer the more of the map a guess opened', () => {
    const rim = (count: number) =>
      new Set(['hub', ...Array.from({ length: count }, (_unused, i) => `word${i}`)]);
    const reached = (word: string) => word === 'hub';
    // The *last* word out, rather than the span: a two-word arrival's span is mostly the time
    // one word takes to grow, and what scales with the size of the guess is the queue in front
    // of it.
    const last = (count: number) =>
      Math.max(...[...entrances(rim(count), reached, []).nodes.values()].map((one) => one.delay));
    expect(last(20)).toBeGreaterThan(last(2) * 3);
  });

  it('never runs on for ever, however busy the word', () => {
    const huge = new Set(['hub', ...Array.from({ length: 400 }, (_unused, i) => `w${i}`)]);
    expect(entrances(huge, (word) => word === 'hub', []).span).toBeLessThan(8000);
  });

  it('varies how fast each word grows, and does not vary it between renders', () => {
    const arriving = new Set(['aback', 'abaft', 'abase', 'abate', 'abbey']);
    const timed = entrances(arriving, () => false, []);
    const speeds = new Set([...timed.nodes.values()].map((one) => one.duration));
    expect(speeds.size).toBeGreaterThan(1);
    expect(entrances(arriving, () => false, []).nodes).toEqual(timed.nodes);
  });

  /**
   * A move drawn to a word still on its way looks like the line came first and the word slid
   * down it.
   */
  it('holds a move back until the word at the far end is mostly out', () => {
    const timed = entrances(new Set(['cage', 'cages']), (word) => word === 'cage', [
      { a: 'cage', b: 'cages' },
    ]);
    const far = timed.nodes.get('cages')!;
    const edge = timed.edges.get('cage cages')!;
    expect(edge.delay).toBeGreaterThan(far.delay);
    expect(edge.delay).toBeLessThan(far.delay + far.duration);
  });

  /**
   * And a move to somewhere the player already knew waits only on the word that arrived — which
   * is what makes a big guess look like it joined up rather than merely appeared.
   */
  it('draws a move to a word already on the board as soon as the newcomer is out', () => {
    const timed = entrances(new Set(['cage']), () => true, [{ a: 'cage', b: 'page' }]);
    const arrival = timed.nodes.get('cage')!;
    expect(arrival.delay).toBe(0);
    expect(timed.edges.get('cage page')!.delay).toBeGreaterThan(0);
    expect(timed.edges.get('cage page')!.delay).toBeLessThan(arrival.duration);
  });

  it('has nothing to say about a move between two words that were both here already', () => {
    const timed = entrances(new Set(['cage']), () => true, [{ a: 'lease', b: 'please' }]);
    expect(timed.edges.has('lease please')).toBe(false);
  });
});

describe('dice', () => {
  it('spreads two words that differ in one letter', () => {
    expect(dice('cage', 1)).not.toBe(dice('cave', 1));
  });

  it('gives one word independent draws per salt, both in range', () => {
    for (const word of ['a', 'cage', 'colorations']) {
      for (const salt of [1, 2, 3]) {
        expect(dice(word, salt)).toBeGreaterThanOrEqual(0);
        expect(dice(word, salt)).toBeLessThan(1);
      }
      expect(dice(word, 1)).not.toBe(dice(word, 2));
    }
  });
});
