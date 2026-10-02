import { describe, expect, it } from 'vitest';
import { ahead, back, readTrail, stand, startTrail, walk } from './trail';

describe('the trail of words stood on', () => {
  it('steps back to where a guess was made from, and forward again', () => {
    let trail = stand(stand(startTrail('cat'), 'cast'), 'caste');
    trail = back(trail)!;
    expect(trail.words[trail.at]).toBe('cast');
    trail = back(trail)!;
    expect(trail.words[trail.at]).toBe('cat');
    expect(back(trail)).toBeNull();
    trail = ahead(trail)!;
    expect(trail.words[trail.at]).toBe('cast');
  });

  it('drops what was ahead when the player goes somewhere new from part way back', () => {
    let trail = stand(stand(startTrail('cat'), 'cast'), 'caste');
    trail = stand(back(trail)!, 'coast');
    expect(trail.words).toEqual(['cat', 'cast', 'coast']);
    expect(ahead(trail)).toBeNull();
  });

  it('takes standing where it already stands as no step at all', () => {
    const trail = stand(startTrail('cat'), 'cast');
    expect(stand(trail, 'cast')).toBe(trail);
    // Including after stepping back, so the travel a step causes is not taken for a new one.
    const behind = back(trail)!;
    expect(stand(behind, 'cat')).toBe(behind);
  });

  it('keeps a bounded history', () => {
    let trail = startTrail('w0');
    for (let i = 1; i < 500; i++) trail = stand(trail, `w${i}`);
    expect(trail.words.length).toBe(200);
    expect(trail.words[trail.at]).toBe('w499');
  });

  it('walks a state along it, and leaves it alone at either end', () => {
    const state = { selected: 'cast', stood: stand(startTrail('cat'), 'cast') };
    const behind = walk(state, 'back');
    expect(behind.selected).toBe('cat');
    expect(walk(behind, 'back')).toBe(behind);
    expect(walk(walk(behind, 'next'), 'next').selected).toBe('cast');
  });
});

describe('a trail read back from a save', () => {
  const can = (word: string) => word !== 'gone';

  it('comes back as it was written', () => {
    const trail = { words: ['cat', 'cast', 'caste'], at: 1 };
    expect(readTrail(trail, can, 'cast')).toEqual(trail);
  });

  it('drops words that can no longer be stood on, and the repeat that leaves', () => {
    const trail = readTrail({ words: ['cat', 'gone', 'cat', 'cast'], at: 3 }, can, 'cast');
    expect(trail).toEqual({ words: ['cat', 'cast'], at: 1 });
  });

  it('ends where the game stands, whatever the save said', () => {
    expect(readTrail({ words: ['cat', 'cast'], at: 1 }, can, 'coast')).toEqual({
      words: ['cat', 'cast', 'coast'],
      at: 2,
    });
  });

  it('is a fresh trail from a save that has none, or nonsense', () => {
    for (const saved of [undefined, null, 7, { words: 'cat' }, { words: [3, null] }]) {
      expect(readTrail(saved, can, 'cat')).toEqual(startTrail('cat'));
    }
  });
});
