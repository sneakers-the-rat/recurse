import { describe, expect, it } from 'vitest';
import { DICTIONARY, RAW, testGraph } from './fixture';
import { bfs, buildGraph, distance, shortestPath, shortestPathNodes } from './graph';

const graph = testGraph();

describe('buildGraph', () => {
  it('makes every edge traversable in both directions', () => {
    expect(graph.findMove('base', 'baseball')).toMatchObject({ kind: 'add', sub: 'ball', pos: 4 });
    expect(graph.findMove('baseball', 'base')).toMatchObject({ kind: 'remove', sub: 'ball', pos: 4 });
  });

  it('shares one position between both directions', () => {
    // pos indexes into the shorter word and the longer one identically, because
    // big === small.slice(0, pos) + sub + small.slice(pos).
    const move = graph.findMove('base', 'baseball')!;
    const rebuilt = 'base'.slice(0, move.pos) + move.sub + 'base'.slice(move.pos);
    expect(rebuilt).toBe('baseball');
  });

  it('reports degree and neighbours', () => {
    expect(graph.degree('ball')).toBe(2);
    expect([...graph.neighbors('ball')].sort()).toEqual(['baseball', 'cannonball']);
    expect(graph.degree('base')).toBe(1);
  });

  it('returns null for a move that does not exist', () => {
    expect(graph.findMove('base', 'cannon')).toBeNull();
    expect(graph.findMove('base', 'nonsense')).toBeNull();
  });

  it('knows which words are in the graph at all', () => {
    expect(graph.has('baseball')).toBe(true);
    expect(graph.has('lifespan')).toBe(false);
  });

  it('rejects an edge file referencing a missing index', () => {
    expect(() =>
      buildGraph({ ...RAW, edges: [999, 0] }, DICTIONARY),
    ).toThrow(/missing index/);
  });
});

describe('bfs', () => {
  it('measures distance in moves', () => {
    const d = bfs(graph, 'base');
    expect(d.get('base')).toBe(0);
    expect(d.get('baseball')).toBe(1);
    expect(d.get('ball')).toBe(2);
    expect(d.get('cannon')).toBe(4);
  });

  it('honours a depth limit', () => {
    const d = bfs(graph, 'base', 2);
    expect(d.has('ball')).toBe(true);
    expect(d.has('cannonball')).toBe(false);
  });
});

describe('shortestPath', () => {
  it('walks the only route there is', () => {
    expect(shortestPath(graph, 'base', 'cannon')).toEqual([
      'base',
      'baseball',
      'ball',
      'cannonball',
      'cannon',
    ]);
  });

  it('is trivial for a word to itself', () => {
    expect(shortestPath(graph, 'base', 'base')).toEqual(['base']);
  });

  it('returns null when unreachable', () => {
    expect(shortestPath(graph, 'base', 'lifespan')).toBeNull();
    expect(distance(graph, 'base', 'lifespan')).toBe(Infinity);
  });
});

describe('shortestPathNodes', () => {
  it('includes every node on the route and nothing else', () => {
    const nodes = shortestPathNodes(graph, 'base', 'cannon', 4);
    expect([...nodes].sort()).toEqual(['ball', 'base', 'baseball', 'cannon', 'cannonball']);
  });
});
