import { describe, expect, it } from 'vitest';
import { dice, entrances, NO_ENTRANCE, REACH_SPREAD } from './sprout';

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

  it('takes longer the more of the map a guess opened', () => {
    const rim = (count: number) =>
      new Set(['hub', ...Array.from({ length: count }, (_unused, i) => `word${i}`)]);
    const reached = (word: string) => word === 'hub';
    // The last delay rather than the span, which for a small arrival is mostly one word's growth.
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

  it('holds a move back until the word at the far end is mostly out', () => {
    const timed = entrances(new Set(['cage', 'cages']), (word) => word === 'cage', [
      { a: 'cage', b: 'cages' },
    ]);
    const far = timed.nodes.get('cages')!;
    const edge = timed.edges.get('cage cages')!;
    expect(edge.delay).toBeGreaterThan(far.delay);
    expect(edge.delay).toBeLessThan(far.delay + far.duration + REACH_SPREAD);
  });

  it('draws a move to a word already on the board off the newcomer alone', () => {
    const timed = entrances(new Set(['cage']), () => true, [{ a: 'cage', b: 'page' }]);
    const arrival = timed.nodes.get('cage')!;
    const edge = timed.edges.get('cage page')!;
    expect(arrival.delay).toBe(0);
    expect(edge.delay).toBeGreaterThan(0);
    expect(edge.delay).toBeLessThan(arrival.duration + REACH_SPREAD);
  });

  it('spreads the moves out of one word over time', () => {
    const timed = entrances(new Set(['cage']), () => true, [
      { a: 'cage', b: 'page' },
      { a: 'cage', b: 'rage' },
      { a: 'cage', b: 'sage' },
      { a: 'cage', b: 'wage' },
    ]);
    expect(new Set([...timed.edges.values()].map((one) => one.delay)).size).toBeGreaterThan(1);
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
