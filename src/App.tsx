/**
 * Wiring.
 *
 * Two things are worth knowing here. What gets drawn is decided by plate.ts, and
 * it grows: every word the player names becomes another anchor, so guessing off
 * the board pulls in the routes from there to the target. And guesses are judged
 * against the whole graph, not the drawn part — all 269k edges ship to the
 * client, so a legal move is legal whether or not it was on screen.
 *
 * Everything derived from the graph is memoised, without exception. The board's
 * force simulation re-renders this component on every tick, so anything computed
 * in the render body is computed sixty times a second: a bare `shortestPath`
 * call in the DevBar's props was a full breadth-first search of a 150k-word graph
 * per animation frame.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DevBar } from './components/DevBar';
import { GraphPlate } from './components/GraphPlate';
import { GuessBar } from './components/GuessBar';
import { Header } from './components/Header';
import { HowTo } from './components/HowTo';
import { Solved } from './components/Solved';
import { shortestPath } from './lib/graph';
import {
  applyGuess,
  inProgress,
  newGame,
  restore,
  select,
  snapshot,
  useHint,
  type GameState,
} from './lib/game';
import { loadGameData, type GameData } from './lib/data';
import { resolvePuzzle } from './lib/daily';
import { gameKey, loadGame, saveGame } from './lib/storage';
import { buildPlate } from './lib/plate';
import { useBoardLayout, type BoardSpec } from './lib/useBoardLayout';

/**
 * The plate's shape on screen, so the layout can fill it.
 *
 * The figure is confined to a frame with these proportions and that frame is the
 * viewBox, so knowing the shape is what lets the board be drawn at a known scale
 * instead of being shrunk to fit whatever the simulation happened to do.
 */
function usePlateAspect() {
  // A callback ref, not a ref object: the plate does not exist on the first
  // render — the game is still loading its data — so an effect that reads
  // ref.current once on mount finds null and never looks again, which is how the
  // board ended up laid out for a phone on a desktop.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [aspect, setAspect] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setAspect(width / height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, aspect] as const;
}

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  // Where in the bank we are, and what number to call it. They differ: `day` is
  // days since the epoch, `index` is that wrapped into the bank.
  const [at, setAt] = useState<{ index: number; day: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showRoute, setShowRoute] = useState(true);

  // On by default while developing, and available in a deployed build via ?dev
  // so a real device can be inspected. `?dev=0` forces it off, which is what the
  // screenshot tests use to capture the game without the instrument panel.
  const devMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('dev');
    if (flag !== null) return flag !== '0' && flag !== 'false';
    return import.meta.env.DEV;
  }, []);

  // Legality lives on the graph now: it carries the whole dictionary.
  const isWord = data ? data.graph.isWord : null;

  useEffect(() => {
    loadGameData()
      .then((loaded) => {
        setData(loaded);
        const chosen = resolvePuzzle(loaded.puzzles, window.location.search);
        setAt({ index: chosen.index, day: chosen.day });
        // Pick up wherever this puzzle was left, which for a reload is normally
        // mid-game. See storage.ts.
        setState(restore(chosen.puzzle, loadGame(gameKey(chosen.puzzle))));
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  /**
   * Found words whose onward routes have been worked out.
   *
   * A word is drawn the instant it is named, but expanding it — pulling in every
   * route from there to the target — is deferred a beat. That keeps the reveal
   * immediate and lets the new paths ease in afterwards, rather than making the
   * player wait for a search before seeing their own move land.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!state) return;
    const pending = [...state.revealed.keys()].filter((w) => !expanded.has(w));
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      setExpanded((previous) => new Set([...previous, ...pending]));
    }, 320);
    return () => clearTimeout(timer);
  }, [state, expanded]);

  // A fresh puzzle starts with nothing expanded.
  useEffect(() => setExpanded(new Set()), [state?.puzzle]);

  /** What to draw. Grows as the player names words off the board — see plate.ts. */
  const plate = useMemo(() => {
    if (!data || !state) return null;
    return buildPlate(data.graph, state.puzzle.source, state.puzzle.target, state.revealed.values(), {
      slack: data.drawSlack,
      maxDrawn: data.drawMax,
      anchors: expanded,
    });
  }, [data, state, expanded]);

  const [plateRef, aspect] = usePlateAspect();

  const spec: BoardSpec | null = useMemo(() => {
    if (!plate || !state) return null;
    const parentOf = new Map<string, string>();
    for (const entry of state.revealed.values()) {
      if (entry.via) parentOf.set(entry.word, entry.via);
    }
    return {
      source: state.puzzle.source,
      target: state.puzzle.target,
      // The graph's own best, not the advertised par: on a puzzle with a secret
      // they differ, and the spine has to match the routes drawn against it.
      par: plate.best,
      nodes: plate.nodes,
      edges: plate.edges,
      distToTarget: plate.distToTarget,
      distFromSource: plate.distFromSource,
      routeNodes: plate.routeNodes,
      parentOf,
      named: new Set(state.revealed.keys()),
      aspect,
    };
  }, [plate, state, aspect]);

  const laid = useBoardLayout(spec);

  const clearError = useCallback(() => setError(null), []);

  function handleGuess(raw: string) {
    if (!data || !state) return;
    const outcome = applyGuess(state, data.graph, raw, isWord);
    setState(outcome.state);
    setError(outcome.kind === 'rejected' ? outcome.judgement.message : null);
  }

  /**
   * Remember the game after every move.
   *
   * Keyed on the puzzle, so moving between boards keeps each one's progress
   * separate. A board nobody has touched is not worth a slot in the store, and
   * writing `null` for it is also how starting over forgets the old game.
   */
  useEffect(() => {
    if (!state) return;
    saveGame(gameKey(state.puzzle), inProgress(state) ? snapshot(state) : null);
  }, [state]);

  /** Dev only: step the bank by index, which is then also the number shown. */
  const goToPuzzle = useCallback(
    (next: number) => {
      const puzzle = data?.puzzles[next];
      if (!puzzle) return;
      setAt({ index: next, day: next });
      setState(restore(puzzle, loadGame(gameKey(puzzle))));
      setError(null);
    },
    [data],
  );

  /** Dev only: throw this board's saved progress away and start it again. */
  const resetPuzzle = useCallback(() => {
    if (!state) return;
    saveGame(gameKey(state.puzzle), null);
    setState(newGame(state.puzzle));
    setError(null);
  }, [state]);

  /**
   * A best route, for the dev bar and its solve button.
   *
   * Memoised on the puzzle, not computed per render: see the note at the top.
   */
  const bestRoute = useMemo(
    () =>
      data && state
        ? (shortestPath(data.graph, state.puzzle.source, state.puzzle.target) ?? [])
        : [],
    [data, state?.puzzle],
  );

  /**
   * Dev helper: name every word on the board at once.
   *
   * Judging whether a puzzle is worth offering means reading the words around the
   * answer, and tapping thirty of them one at a time is not reading.
   */
  const nameAll = useCallback(() => {
    setState((current) => {
      if (!current || !plate) return current;
      return { ...current, hinted: new Set([...current.hinted, ...plate.nodes]) };
    });
  }, [plate]);

  /** Dev helper: walk a shortest path so a board can be seen in its solved state. */
  const solveIt = useCallback(() => {
    if (!data || !state || bestRoute.length === 0) return;
    let next = newGame(state.puzzle);
    for (const word of bestRoute.slice(1)) {
      next = applyGuess(next, data.graph, word, null).state;
    }
    setState(next);
    setError(null);
  }, [data, state, bestRoute]);

  if (loadError) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-bone mb-2 text-xl">The puzzle didn’t load</h1>
          <p className="text-bone-dim text-sm">{loadError}</p>
          <p className="label mt-4">Run npm run data to rebuild it</p>
        </div>
      </main>
    );
  }

  if (!data || !state || !plate || !laid || !at) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="label">Shuffling</p>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {devMode && (
        <DevBar
          index={at.index}
          total={data.puzzles.length}
          puzzle={state.puzzle}
          drawn={plate.nodes.length}
          path={bestRoute}
          guesses={state.guesses}
          onGo={goToPuzzle}
          onSolve={solveIt}
          onNameAll={nameAll}
          onReset={resetPuzzle}
        />
      )}

      <Header
        source={state.puzzle.source}
        target={state.puzzle.target}
        par={state.puzzle.par}
        day={at.day}
        guesses={state.guesses}
        onHelp={() => setShowHelp(true)}
      />

      <main ref={plateRef} className="relative min-h-0 flex-1">
        <GraphPlate
          state={state}
          nodes={laid.drawn}
          edges={laid.edges}
          positions={laid.positions}
          routeNodes={plate.routeNodes}
          spurCount={plate.spurCount}
          showRoute={showRoute}
          beatPar={state.solved && state.guesses < state.puzzle.par}
          namesWords={devMode}
          extent={laid.extent}
          onSelect={(word) => setState((s) => (s ? select(s, word) : s))}
          onHint={(word) => setState((s) => (s ? useHint(s, word) : s))}
        />

        <button
          type="button"
          onClick={() => setShowRoute((v) => !v)}
          className="label hover:text-gilt absolute right-3 bottom-2 transition-colors"
          aria-pressed={showRoute}
        >
          {showRoute ? 'Hide route' : 'Show route'}
        </button>
      </main>

      {state.solved ? (
        <Solved state={state} onPlayAgain={devMode ? () => goToPuzzle(at.index + 1) : undefined} />
      ) : (
        <GuessBar
          from={state.selected}
          graph={data.graph}
          isWord={isWord}
          error={error}
          onSubmit={handleGuess}
          onClearError={clearError}
        />
      )}

      {showHelp && (
        <HowTo
          minWord={data.graph.params.minWord}
          minSub={data.graph.params.minSub}
          onClose={() => setShowHelp(false)}
        />
      )}
    </div>
  );
}
