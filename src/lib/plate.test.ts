/**
 * Board selection, against the real shipped data.
 *
 * Using the real graph matters here: the whole point of plate.ts is keeping a
 * 151k-node graph drawable, and a toy fixture cannot show whether it does.
 */

import { describe, expect, it } from 'vitest';
import { drawOptions, shippedData } from '../test/shipped';
import { buildPlate } from './plate';
import { shortestPath } from './graph';
import { applyGuess, newGame } from './game';
import type { Revealed } from './types';

function real() {
  const data = shippedData();
  return { graph: data.graph, puzzles: data.puzzles };
}

describe('buildPlate', () => {
  // Each puzzle needs two fresh full-graph sweeps, ~100ms, so this samples
  // rather than exhausts the bank.
  it('draws a readable number of nodes for every puzzle it is given', { timeout: 30_000 }, () => {
    const { graph, puzzles } = real();
    for (const puzzle of puzzles.slice(0, 25)) {
      const plate = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
      expect(plate.nodes.length).toBeGreaterThan(2);
      // The puzzle declares its own board, so the client draws what it was given: every
      // drawn word is either one the builder chose or one the player found.
      const declared = new Set([...puzzle.board, puzzle.source, puzzle.target]);
      expect(plate.nodes.every((word) => declared.has(word))).toBe(true);
    }
  });

  it('always includes the two puzzle words and the best route', () => {
    const { graph, puzzles } = real();
    const puzzle = puzzles[0]!;
    const plate = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
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
    const { graph, puzzles } = real();
    const puzzle = puzzles[1]!;
    const plate = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
    const drawn = new Set(plate.nodes);
    for (const word of plate.nodes) {
      if (word === puzzle.source || word === puzzle.target) continue;
      const degree = graph.neighbors(word).filter((n) => drawn.has(n)).length;
      // Every drawn word lies on a route, so it has a way in and a way out.
      expect(degree).toBeGreaterThanOrEqual(2);
    }
  });

  it('counts moves that lead off the board', () => {
    const { graph, puzzles } = real();
    const puzzle = puzzles[0]!;
    const plate = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
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
    const { graph, puzzles } = real();
    const puzzle = puzzles[0]!;
    const base = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));

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
      drawOptions(puzzle),
    );
    expect(grown.nodes).toContain(stray);
    // It is connected, not floating.
    expect(grown.edges.some((e) => e.a === stray || e.b === stray)).toBe(true);
    // And it has somewhere to go, or is at least placed vertically.
    expect(grown.distToTarget.has(stray)).toBe(true);
  });

  /**
   * The symptom: restoring a saved game drew some of the words found so far as
   * loose dots in the corner, joined to nothing.
   *
   * Being kept is not the same as being connected. A found word is never pruned,
   * but the *route* joining it to the rest of the board is ordinary board and gets
   * trimmed to the budget like anything else — and a restored game asks for every
   * word found so far at once, which is exactly when the budget runs out. It went
   * unnoticed because only words outside the corpus were being reattached, and
   * these were ordinary words the graph knew perfectly well.
   */
  it('never draws a word without an edge, however far the player strayed', () => {
    const { graph, puzzles } = real();
    const stranded: string[] = [];

    for (const puzzle of puzzles.slice(0, 20)) {
      const drawn = new Set(buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle)).nodes);

      // Walk several moves off the board, the way a restored game arrives: all at
      // once, rather than one word at a time with the board growing between.
      const revealed: Revealed[] = [{ word: puzzle.source, via: null, move: null, order: 0 }];
      let at = puzzle.source;
      for (let step = 1; step <= 3; step++) {
        const next = graph
          .neighbors(at)
          .find((w) => !drawn.has(w) && !revealed.some((r) => r.word === w));
        if (!next) break;
        revealed.push({ word: next, via: at, move: graph.findMove(at, next), order: step });
        at = next;
      }
      if (revealed.length < 3) continue;

      // Before the found words have been expanded, and after. Both are real
      // states the board is rendered in, a beat apart.
      for (const anchors of [new Set([puzzle.source]), undefined]) {
        const plate = buildPlate(graph, puzzle.source, puzzle.target, revealed, {
          ...drawOptions(puzzle),
          ...(anchors ? { anchors } : {}),
        });
        const degree = new Map(plate.nodes.map((word) => [word, 0]));
        for (const { a, b } of plate.edges) {
          degree.set(a, degree.get(a)! + 1);
          degree.set(b, degree.get(b)! + 1);
        }
        for (const word of plate.nodes) {
          if (degree.get(word) === 0) stranded.push(`${puzzle.source}: ${word}`);
        }
      }
    }

    expect(stranded).toEqual([]);
  });

  /**
   * The stronger version of the rule above, and the one a secret route needs.
   *
   * Every board with a secret failed this — 40 of 40 — while passing the orphan test, because
   * the step *back* from a rare word lands on a word that is already drawn and already joined
   * to its neighbours. Nothing was stranded, so nothing was attached, so the move the player
   * had just made was not on the board and its subword label had nowhere to be written.
   */
  it('draws an edge for every move the player made, including off the common graph', () => {
    const { graph, puzzles } = real();
    const missing: string[] = [];

    for (const puzzle of puzzles.slice(0, 40)) {
      // The legal route rather than the common one: on a puzzle with a secret it steps
      // outside the corpus and back, which is the case that was broken.
      const route = shortestPath(graph, puzzle.source, puzzle.target);
      if (!route || route.length < 3) continue;

      let state = newGame(puzzle);
      for (const word of route.slice(1)) {
        state = applyGuess(state, graph, word, graph.isWord).state;
      }

      const plate = buildPlate(graph, puzzle.source, puzzle.target, state.revealed.values(), {
        ...drawOptions(puzzle),
        anchors: new Set(state.revealed.keys()),
      });
      const drawn = new Set(plate.edges.map(({ a, b }) => `${a} ${b}`));
      for (const entry of state.revealed.values()) {
        if (entry.via === null) continue;
        const [a, b] = [entry.via, entry.word].sort();
        if (!drawn.has(`${a} ${b}`)) missing.push(`${puzzle.id}: ${a} ${b}`);
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * A word the player walked to shows every move it has to the board, not just the one it
   * arrived by. Drawn joined only to its parent, a rare word standing between three drawn
   * words reads as a spur off one of them.
   */
  it('draws every legal edge from a word the player walked to', () => {
    const { graph, puzzles } = real();
    const missing: string[] = [];

    for (const puzzle of puzzles.slice(0, 25)) {
      const route = shortestPath(graph, puzzle.source, puzzle.target);
      if (!route || route.length < 3) continue;
      let state = newGame(puzzle);
      for (const word of route.slice(1)) {
        state = applyGuess(state, graph, word, graph.isWord).state;
      }

      const plate = buildPlate(graph, puzzle.source, puzzle.target, state.revealed.values(), {
        ...drawOptions(puzzle),
        anchors: new Set(state.revealed.keys()),
      });
      const drawn = new Set(plate.nodes);
      const edges = new Set(plate.edges.map(({ a, b }) => `${a} ${b}`));

      for (const entry of state.revealed.values()) {
        if (entry.via === null) continue;
        for (const near of graph.neighbors(entry.word)) {
          if (!drawn.has(near)) continue;
          const [a, b] = [entry.word, near].sort();
          if (!edges.has(`${a} ${b}`)) missing.push(`${puzzle.id}: ${a} ${b}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('keeps a word the player found even if it is a dead end', () => {
    const { graph, puzzles } = real();
    const puzzle = puzzles[2]!;
    const first = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
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
      drawOptions(puzzle),
    );
    // Pruning must not erase where the player is standing.
    expect(plate.nodes).toContain(spur);
  });

  // The symptom this guards against: a board drawn as a bare line of four nodes
  // with nothing to choose between, because the neighbourhood overflowed and the
  // radius collapsed to zero instead of being trimmed.
  it('always shows alternatives, never just the shortest path', { timeout: 60_000 }, () => {
    const { graph, puzzles } = real();
    const bare: string[] = [];
    for (const puzzle of puzzles.slice(0, 25)) {
      const plate = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
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
    const { graph, puzzles } = real();
    const forced: string[] = [];
    const bare: string[] = [];
    for (const puzzle of puzzles.slice(0, 40)) {
      const plate = buildPlate(graph, puzzle.source, puzzle.target, [], drawOptions(puzzle));
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
    const { graph, puzzles } = real();
    // Warm the distance cache the way a real session would.
    buildPlate(graph, puzzles[0]!.source, puzzles[0]!.target, [], drawOptions(puzzles[0]!));

    const started = performance.now();
    for (let i = 0; i < 20; i++) {
      buildPlate(graph, puzzles[0]!.source, puzzles[0]!.target, [], drawOptions(puzzles[0]!));
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
