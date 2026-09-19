/**
 * How big a word is drawn.
 *
 * Two promises, and the first is the one that matters: **a board that does not draw degree gets
 * exactly the mark and exactly the label it had before any of this existed.** The daily figure
 * is thirty words whose every dimension has been tuned by looking, and a size function written
 * for a map of thousands must not reach it. Both halves of that have gone wrong once — the mark
 * by way of the default degree, and the label by way of a squeeze that happened to fit.
 *
 * The second is that the map's own range stays a range: the order is by moves and the spread is
 * readable rather than absurd.
 */

import { describe, expect, it } from 'vitest';
import { insideLabel, LABEL_SIZE, markRadius, NODE_R } from './sizes';

describe('the mark', () => {
  it('is exactly what it always was for a board that does not draw degree', () => {
    expect(markRadius(1)).toBe(NODE_R);
    // Which is what `PlateNode`'s default passes, so the daily board never reaches the curve.
    expect(markRadius(0)).toBe(NODE_R);
  });

  it('grows with the moves, in order and by a wide margin', () => {
    expect(markRadius(4)).toBeGreaterThan(markRadius(1));
    expect(markRadius(181)).toBeGreaterThan(markRadius(60));
    /*
      How *much* bigger is `CROWD`, which is a taste knob and is read off the contact sheet
      rather than asserted here. What is asserted is the two ends of the range it may be turned
      through: a hub has to be unmistakably a hub, and it may not be so large that the graph
      disappears inside it — at `NODE_R * 181` the busiest word is 2,500 units across, which is
      a fifth of the whole map.
    */
    expect(markRadius(181) / NODE_R).toBeGreaterThan(3);
    expect(markRadius(181)).toBeLessThan(NODE_R * 181);
  });
});

describe('a name inside its own mark', () => {
  it('never happens at the ordinary mark, however short the word', () => {
    // Two and three letters both fit across a 14-unit disc at a squeeze, and that squeeze is
    // what put some of the daily board's names inside their marks and the rest above them.
    for (const letters of [1, 2, 3, 4, 8]) {
      expect(insideLabel(letters, NODE_R)).toBeNull();
    }
  });

  it('happens once the mark has grown enough to hold the word', () => {
    // A busy word, which on this graph is a disc about four times a leaf.
    expect(insideLabel(4, markRadius(120))).not.toBeNull();
    // A middling one holds a short name and not a long one: what decides it is the chord, so
    // the same disc says yes to `king` and no to `kingfisher`, which is the point of asking.
    // Written as a radius rather than as a degree, because which degree is middling moves with
    // `CROWD` and this is a claim about the chord.
    const some = 30;
    expect(insideLabel(4, some)).not.toBeNull();
    expect(insideLabel(10, some)).toBeNull();
  });

  it('never shouts, however much room there is', () => {
    expect(insideLabel(3, 400)).toBeLessThanOrEqual(LABEL_SIZE * 2);
  });
});
