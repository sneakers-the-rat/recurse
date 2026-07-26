/**
 * Board selection, against the real shipped data.
 *
 * Using the real graph matters here: the whole point of plate.ts is keeping a
 * 109k-node graph drawable, and a toy fixture cannot show whether it does.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { buildPlate, type PlateOptions } from './plate';
import type { Graph, Puzzle, RawDictionary, RawGraph, RawPuzzles } from './types';

const dataDir = join(process.cwd(), 'public', 'data');
const read = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(dataDir, name), 'utf8')) as T;

/**
 * The shipped graph, built the way the app builds it — including the common word
 * list, without which every word counts as ordinary and the board under test is
 * not the board that ships.
 */
function realGraph() {
  const words = read<RawDictionary>('dictionary.json').words.split('\n');
  const common = new Set<string>();
  let at = 0;
  for (const delta of read<{ common: number[] }>('common.json').common) {
    at += delta;
    const word = words[at];
    if (word !== undefined) common.add(word);
  }
  return buildGraph(read<RawGraph>('graph.json'), words, common);
}

let cached: { graph: Graph; puzzles: Puzzle[]; draw: PlateOptions } | null = null;
function real() {
  if (!cached) {
    const rawPuzzles = read<RawPuzzles>('puzzles.json');
    cached = {
      graph: realGraph(),
      puzzles: rawPuzzles.puzzles,
      // The budget the client actually draws with, not selection's wider measure.
      draw: { slack: rawPuzzles.params.drawSlack, maxDrawn: rawPuzzles.params.drawMax },
    };
  }
  return cached;
}

describe('buildPlate', () => {
  // Each puzzle needs two fresh full-graph sweeps, ~100ms, so this samples
  // rather than exhausts the bank.
  it('draws a readable number of nodes for every puzzle it is given', { timeout: 30_000 }, () => {
    const { graph, puzzles, draw } = real();
    for (const puzzle of puzzles.slice(0, 25)) {
      const plate = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
      expect(plate.nodes.length).toBeGreaterThan(2);
      // maxDrawn is a budget for *detours*. The best routes are never trimmed, so
      // a puzzle with many equally short answers may exceed it — but then every
      // drawn word is on one of those answers, and nothing was drawn carelessly.
      if (plate.nodes.length > draw.maxDrawn!) {
        expect(plate.nodes.every((word) => plate.routeNodes.has(word))).toBe(true);
      }
    }
  });

  it('always includes the two puzzle words and the best route', () => {
    const { graph, puzzles, draw } = real();
    const puzzle = puzzles[0]!;
    const plate = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
    expect(plate.nodes).toContain(puzzle.source);
    expect(plate.nodes).toContain(puzzle.target);
    expect(plate.routeNodes.has(puzzle.source)).toBe(true);
    expect(plate.routeNodes.has(puzzle.target)).toBe(true);
    // Every route node is genuinely on a shortest path.
    for (const word of plate.routeNodes) {
      const ds = plate.distFromSource.get(word)!;
      const dt = plate.distToTarget.get(word)!;
      expect(ds + dt).toBe(puzzle.par);
    }
  });

  it('leaves no dead ends on the board', () => {
    const { graph, puzzles, draw } = real();
    const puzzle = puzzles[1]!;
    const plate = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
    const drawn = new Set(plate.nodes);
    for (const word of plate.nodes) {
      if (word === puzzle.source || word === puzzle.target) continue;
      const degree = graph.neighbors(word).filter((n) => drawn.has(n)).length;
      // Every drawn word lies on a route, so it has a way in and a way out.
      expect(degree).toBeGreaterThanOrEqual(2);
    }
  });

  it('counts moves that lead off the board', () => {
    const { graph, puzzles, draw } = real();
    const puzzle = puzzles[0]!;
    const plate = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
    const drawn = new Set(plate.nodes);
    for (const word of plate.nodes) {
      const offBoard = graph.neighbors(word).filter((n) => !drawn.has(n)).length;
      expect(plate.spurCount.get(word)).toBe(offBoard);
      // Spurs plus drawn neighbours must account for every legal move.
      const drawnNeighbours = graph.neighbors(word).filter((n) => drawn.has(n)).length;
      expect(offBoard + drawnNeighbours).toBe(graph.degree(word));
    }
  });

  it('grows the board when a word off it is named', () => {
    const { graph, puzzles, draw } = real();
    const puzzle = puzzles[0]!;
    const base = buildPlate(graph, puzzle.source, puzzle.target, [], draw);

    // Take a legal move from the source that the board does not show.
    const drawn = new Set(base.nodes);
    const stray = graph.neighbors(puzzle.source).find((w) => !drawn.has(w));
    if (!stray) return; // nothing off-board to find; nothing to assert

    const grown = buildPlate(
      graph,
      puzzle.source,
      puzzle.target,
      [
        { word: puzzle.source, via: null, move: null, order: 0 },
        { word: stray, via: puzzle.source, move: graph.findMove(puzzle.source, stray), order: 1 },
      ],
      draw,
    );
    expect(grown.nodes).toContain(stray);
    // It is connected, not floating.
    expect(grown.edges.some((e) => e.a === stray || e.b === stray)).toBe(true);
    // And it has somewhere to go, or is at least placed vertically.
    expect(grown.distToTarget.has(stray)).toBe(true);
  });

  it('keeps a word the player found even if it is a dead end', () => {
    const { graph, puzzles, draw } = real();
    const puzzle = puzzles[2]!;
    const first = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
    const drawn = new Set(first.nodes);
    const spur = graph
      .neighbors(puzzle.source)
      .find((w) => !drawn.has(w) && graph.degree(w) === 1);
    if (!spur) return;
    const plate = buildPlate(
      graph,
      puzzle.source,
      puzzle.target,
      [
        { word: puzzle.source, via: null, move: null, order: 0 },
        { word: spur, via: puzzle.source, move: graph.findMove(puzzle.source, spur), order: 1 },
      ],
      draw,
    );
    // Pruning must not erase where the player is standing.
    expect(plate.nodes).toContain(spur);
  });

  // The symptom this guards against: a board drawn as a bare line of four nodes
  // with nothing to choose between, because the neighbourhood overflowed and the
  // radius collapsed to zero instead of being trimmed.
  it('always shows alternatives, never just the shortest path', { timeout: 60_000 }, () => {
    const { graph, puzzles, draw } = real();
    const bare: string[] = [];
    for (const puzzle of puzzles.slice(0, 25)) {
      const plate = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
      const offRoute = plate.nodes.filter((w) => !plate.routeNodes.has(w));
      if (offRoute.length === 0) bare.push(`${puzzle.source}->${puzzle.target}`);
    }
    expect(bare).toEqual([]);
  });

  /**
   * The complaint this pins down: a board with one way out of the source is not a
   * puzzle, it is a corridor. Selection promises a branch at the root and a longer
   * way round; those promises are about the graph the board is *drawn* from, so
   * this checks them where the player meets them.
   */
  it('gives every board a branch at the root and a way round', { timeout: 60_000 }, () => {
    const { graph, puzzles, draw } = real();
    const forced: string[] = [];
    const bare: string[] = [];
    for (const puzzle of puzzles.slice(0, 40)) {
      const plate = buildPlate(graph, puzzle.source, puzzle.target, [], draw);
      const drawn = new Set(plate.nodes);
      const fromSource = graph.commonNeighbors(puzzle.source).filter((w) => drawn.has(w));
      if (fromSource.length < 2) forced.push(`${puzzle.source}->${puzzle.target}`);
      if (plate.nodes.every((w) => plate.routeNodes.has(w))) {
        bare.push(`${puzzle.source}->${puzzle.target}`);
      }
    }
    expect(forced).toEqual([]);
    expect(bare).toEqual([]);
  });

  it('builds fast enough to run on every guess', () => {
    const { graph, puzzles, draw } = real();
    // Warm the distance cache the way a real session would.
    buildPlate(graph, puzzles[0]!.source, puzzles[0]!.target, [], draw);

    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      buildPlate(graph, puzzles[0]!.source, puzzles[0]!.target, [], draw);
    }
    const each = (performance.now() - started) / 20;
    // Runs once per guess, not per frame, so ~100ms is tolerable but not good.
    // The remaining cost is string-keyed Map lookups in the admissibility test,
    // repeated once per slack level; moving the hot structures to integer word
    // ids is the obvious next win. This bound is here to catch a regression, not
    // to bless the number.
    expect(each).toBeLessThan(150);
  });
});
