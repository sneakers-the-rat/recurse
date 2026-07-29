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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Result, Round } from './components/Completed';
import { Opening } from './components/Opening';
import { DevBar } from './components/DevBar';
import { GraphPlate } from './components/GraphPlate';
import { GuessBar } from './components/GuessBar';
import { Header } from './components/Header';
import { HowTo } from './components/HowTo';
import { shortestPath } from './lib/graph';
import {
  applyGuess,
  hintCount,
  newGame,
  restore,
  select,
  snapshot,
  useHint,
  worthKeeping,
  type GameState,
} from './lib/game';
import { loadGameData, loadShard, type GameData } from './lib/data';
import { dateForDay, dayIndex, puzzleForDay, resolvePuzzle, type DailyPuzzle } from './lib/daily';
import { idFromPath, pathFor, shareUrl } from './lib/route';
import { markGuesses, shareText } from './lib/share';
import { gameKey, loadGame, saveGame } from './lib/storage';
import { buildPlate } from './lib/plate';
import { useBoardLayout, type BoardSpec } from './lib/useBoardLayout';
import { openingCamera, playCamera, viewOf, type Camera, type Plate } from './lib/camera';
import { usePanZoom } from './lib/usePanZoom';

/**
 * The plate's size on screen, in pixels.
 *
 * The camera needs the real thing, not a ratio: scale is pixels per graph unit, and
 * that is what keeps a word the same size on a bare board and a crowded one.
 */
function usePlateSize() {
  // A callback ref, not a ref object: the plate does not exist on the first
  // render — the game is still loading its data — so an effect that reads
  // ref.current once on mount finds null and never looks again, which is how the
  // board ended up laid out for a phone on a desktop.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<Plate>({ width: 0, height: 0 });

  useEffect(() => {
    if (!element) return;

    /**
     * Take a size, and say nothing if it is the size we already had.
     *
     * Both halves matter. A fresh `{width, height}` object every time is a new prop
     * for the camera and a new view for the plate, so re-reporting an unchanged size
     * re-rendered the board for nothing — and the plate is resized by ordinary play,
     * because the error line under the guess bar reserves its space and the header's
     * statement fades in.
     */
    const report = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    };

    const box = element.getBoundingClientRect();
    report(box.width, box.height);

    // The observer's own `contentRect`, never `getBoundingClientRect` again: asking the
    // element forces a synchronous layout of the whole document, and the document
    // contains a thousand-element SVG. Measured at 80ms of the first second of a page
    // load, for a number the observer had already worked out and handed over.
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      if (rect) report(rect.width, rect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  // The element itself as well as its size: the wheel is listened for on it directly,
  // because React's own `wheel` is passive and cannot refuse a scroll. See usePanZoom.
  return [setElement, size, element] as const;
}

/**
 * Whether the instrument panel is showing, and a way to turn it off *in place*.
 *
 * On by default while developing, and available in a deployed build via `?dev` so a
 * real device can be inspected. `?dev=0` forces it off, which is what the screenshot
 * tests use to capture the game without the panel.
 *
 * Toggling matters because the whole point of the panel is judging the game, and
 * some of that is judging what a player sees — which cannot be done from behind the
 * instruments. Ctrl+D flips it either way, so the view can be checked and come back
 * without losing the board or the game in progress; the `dev` parameter is kept in
 * step so a reload holds whichever was chosen. Ctrl rather than a bare key because
 * GuessBar sends unmodified keystrokes to the guess field, where a shortcut would
 * arrive as a letter.
 */
function useDevMode(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    const flag = new URLSearchParams(window.location.search).get('dev');
    if (flag !== null) return flag !== '0' && flag !== 'false';
    return import.meta.env.DEV;
  });

  const toggle = useCallback(() => {
    setOn((was) => {
      const next = !was;
      const url = new URL(window.location.href);
      url.searchParams.set('dev', next ? '1' : '0');
      window.history.replaceState(null, '', url);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      event.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return [on, toggle];
}

/** How long the whole board is held in shot, and how long the camera takes to close. */
const OPENING_HOLD = 1100;
const OPENING_CLOSE = 900;

/**
 * The opening sequence, as a phase and a camera.
 *
 * Three states: `wide` while the whole puzzle is in shot under its title card,
 * `closing` while the camera moves in and the card travels to the header, and null
 * when the board is simply being played. Everything about it is skippable, and
 * everything skips it:
 *
 *  - A game already under way, or already finished. Coming back to a board to check
 *    your score should not make you sit through a title.
 *  - `prefers-reduced-motion`, which is a request, not a hint.
 *  - Any key or any pointer. A player who has started typing has read the words.
 *
 * The camera is moved by exactly two calls, both here, so the rule that the view only
 * ever moves when the player or the opening asks still holds.
 */
function useOpening({
  key,
  fresh,
  wide,
  play,
  jumpTo,
  glideTo,
}: {
  key: string | null;
  fresh: boolean;
  wide: Camera;
  play: Camera;
  jumpTo: (camera: Camera) => void;
  glideTo: (camera: Camera, ms: number) => void;
}): 'wide' | 'closing' | null {
  const [phase, setPhase] = useState<'wide' | 'closing' | null>(null);
  const started = useRef<string | null>(null);

  // Read in the effect, not at render: `matchMedia` is a browser thing and this hook
  // has to be safe to render on the way to a test that never shows a board.
  useEffect(() => {
    if (key === null || started.current === key) return;
    started.current = key;

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!fresh || still) {
      setPhase(null);
      jumpTo(play);
      return;
    }

    setPhase('wide');
    jumpTo(wide);
    const timers = [
      setTimeout(() => {
        setPhase('closing');
        glideTo(play, OPENING_CLOSE);
      }, OPENING_HOLD),
      setTimeout(() => setPhase(null), OPENING_HOLD + OPENING_CLOSE),
    ];
    return () => timers.forEach(clearTimeout);
    // `wide` and `play` are read once, when the sequence starts; a later change to
    // either must not restart it. That is what `started` is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fresh, jumpTo, glideTo]);

  // Cut it short on any input. Capture, so it happens whatever the target does with
  // the event, and passive, so this never delays a scroll or a tap.
  useEffect(() => {
    if (phase === null) return;
    const skip = () => {
      setPhase(null);
      jumpTo(play);
    };
    const options = { capture: true, passive: true } as const;
    document.addEventListener('keydown', skip, options);
    document.addEventListener('pointerdown', skip, options);
    return () => {
      document.removeEventListener('keydown', skip, options);
      document.removeEventListener('pointerdown', skip, options);
    };
  }, [phase, jumpTo, play]);

  return phase;
}

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  // Where in the bank we are, and what number to call it. They differ: `day` is
  // days since the epoch, `index` is that wrapped into the bank.
  // Which day is on screen. The calendar position and the day number are the same
  // thing: the builder assigns a day to every puzzle, so there is no separate index
  // into a bank — only one shard of it is ever in memory.
  const [at, setAt] = useState<{ day: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showRoute, setShowRoute] = useState(true);

  const [devMode, toggleDev] = useDevMode();

  // Legality lives on the graph now: it carries the whole dictionary.
  const isWord = data ? data.graph.isWord : null;

  /**
   * Open a board, and make the URL say which one.
   *
   * Every arrival goes through here, so the address bar always holds the puzzle's
   * own id — the link a player copies is the board in front of them, whether they
   * came in on `/`, on a stale id, or by stepping through the bank in dev mode.
   *
   * `replace` for arriving and for the back button, `push` for stepping: stepping
   * is navigation and should be undoable, while rewriting `/` to today's id must
   * not put an entry in the history that goes straight back to `/`.
   */
  const show = useCallback((chosen: DailyPuzzle, how: 'push' | 'replace') => {
    setAt({ day: chosen.day });
    // Pick up wherever this puzzle was left, which for a reload is normally
    // mid-game. See storage.ts.
    setState(restore(chosen.puzzle, loadGame(gameKey(chosen.puzzle))));
    setError(null);
    // The query string is carried over, because `?dev` has to survive a step.
    const url = pathFor(chosen.puzzle.id, window.location.search);
    if (how === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    // The path decides which shard is fetched, so the loader is told the id up front
    // rather than being asked for a board it did not bring.
    const asked = idFromPath(window.location.pathname);
    loadGameData(asked === null ? undefined : { id: asked })
      .then((loaded) => {
        setData(loaded);
        const chosen = resolvePuzzle(loaded.puzzles, window.location.pathname, loaded.manifest.days);
        if (!chosen) {
          // The shard arrived but does not hold the day it was fetched for, which means
          // the client and the builder disagree about the shard arithmetic.
          setLoadError('the puzzle data is out of step with the app: rebuild it');
          return;
        }
        show(chosen, 'replace');
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [show]);

  /**
   * The back button, which moves between boards rather than out of the game.
   *
   * Resolved from the path the same way the first load is, so going back to `/`
   * lands on today rather than on nothing.
   */
  useEffect(() => {
    if (!data) return;
    const onPop = () => {
      const chosen = resolvePuzzle(data.puzzles, window.location.pathname, data.manifest.days);
      if (chosen) show(chosen, 'replace');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [data, show]);

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

  /**
   * Words dev mode has spelled out, by right-clicking or by `name all`.
   *
   * Kept here rather than in `GameState` because it is not part of the game: no hint
   * is paid for it, nothing is written down, and it starts empty on every board.
   */
  const [spelled, setSpelled] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => setSpelled(new Set()), [state?.puzzle]);

  /**
   * What to draw. Grows as the player names words off the board — see plate.ts.
   *
   * Memoised on the words found rather than on the game, because most of what happens
   * to a game does not change what is on the board: a hint, a tap to move the cursor, a
   * refused guess. Depending on `state` rebuilt the whole board — two graph searches,
   * forty-odd milliseconds — every time any of those happened.
   */
  const revealedKey = state ? [...state.revealed.keys()].join(' ') : '';
  // Which words are spelled out on the plate, and so how much room each one takes. Hints
  // and dev mode's reading-aloud both change it, and both are supposed to nudge the board.
  const labelKey = state
    ? [...state.hints].filter(([, l]) => l >= 2).map(([w]) => w).sort().join(' ') +
      '|' +
      [...spelled].sort().join(' ')
    : '';
  const plate = useMemo(() => {
    if (!data || !state) return null;
    return buildPlate(data.graph, state.puzzle.source, state.puzzle.target, state.revealed.values(), {
      board: state.puzzle.board,
      anchors: expanded,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state?.puzzle, revealedKey, expanded]);

  const [plateRef, plateSize, plateEl] = usePlateSize();

  /**
   * The board, as the layout needs to see it.
   *
   * Memoised on the same things the plate is, and deliberately *not* on the game: a
   * revealed word's entry never changes once it is written (see game.ts), so the list
   * of names is all that can alter `parentOf` or `named`. Depending on `state` made
   * this a new object whenever anything at all happened — a hint, a tap on a word, a
   * refused guess — and a new object here re-runs the whole layout effect, which
   * rebuilds four forces and re-links every edge to decide it has nothing to do.
   */
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
      distFromSource: plate.distFromSource,
      routeNodes: plate.routeNodes,
      parentOf,
      named: new Set(state.revealed.keys()),
      // What is actually showing its whole spelling, which is what the layout has to leave
      // room for. A hint or a reveal therefore *does* reach the layout now, and is meant to:
      // the word's box grows and it shoulders its neighbours aside. See `boxOf`.
      labelled: new Set([
        state.puzzle.source,
        state.puzzle.target,
        ...state.revealed.keys(),
        ...[...state.hints].filter(([, level]) => level >= 2).map(([word]) => word),
        ...spelled,
      ]),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, state?.puzzle, revealedKey, labelKey]);

  const laid = useBoardLayout(spec);

  /**
   * Where the board is looked at from.
   *
   * The play view is framed on the answer — source, target and the route between them
   * — at a scale that keeps a word readable, so the words are the same size whether
   * the board has ten of them or sixty. Everything else is off the edges, and dragging
   * or pinching is how it is reached.
   */
  const spineHeight = laid?.spineHeight ?? 1;
  const figure = laid?.figure ?? { minX: 0, maxX: 0, minY: 0, maxY: spineHeight };
  const play = useMemo(() => playCamera(spineHeight, plateSize), [spineHeight, plateSize]);
  const { camera, jumpTo, glideTo, engaged, handlers } = usePanZoom(
    play,
    plateSize,
    figure,
    plateEl,
  );

  /**
   * Frame the board when it changes, and only then.
   *
   * A new puzzle, or the plate being measured for the first time, is the game setting
   * up; everything after that is the player's, so nothing here recentres a board
   * somebody has panned away from — a word arriving must never tug the view.
   *
   * A board nobody has touched yet opens on the whole puzzle and closes on the answer,
   * with a title card over it; anything else — a game in progress, a finished one, a
   * player who would rather not have the motion — goes straight to the answer.
   */
  const opening = useOpening({
    // Keyed on the board, so stepping through the bank in dev mode opens each one, and
    // a re-measured plate does not start the sequence again.
    key: state && plateSize.height > 0 ? `${state.puzzle.id} ${plateSize.width}` : null,
    fresh: !!state && !worthKeeping(state),
    wide: useMemo(() => openingCamera(figure, spineHeight, plateSize), [figure, spineHeight, plateSize]),
    play,
    jumpTo,
    glideTo,
  });

  const view = useMemo(() => viewOf(camera, plateSize), [camera, plateSize]);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Everything the plate and the bars are handed, as callbacks that keep their
   * identity.
   *
   * Not tidiness: the components below are memoised, and a memoised component handed a
   * fresh arrow function every render is a component that re-renders every render. The
   * board redraws on every frame of a settle, and that used to take the header, the
   * guess bar and its readout with it.
   */
  const handleGuess = useCallback(
    (raw: string) => {
      if (!data || !state) return;
      const outcome = applyGuess(state, data.graph, raw, isWord);
      setState(outcome.state);
      setError(outcome.kind === 'rejected' ? outcome.judgement.message : null);
    },
    [data, state, isWord],
  );

  const selectWord = useCallback((word: string) => {
    setState((s) => (s ? select(s, word) : s));
  }, []);

  const hintWord = useCallback((word: string) => {
    setState((s) => (s ? useHint(s, word) : s));
  }, []);

  const spellWord = useCallback((word: string) => {
    setSpelled((current) => new Set(current).add(word));
  }, []);

  const openHelp = useCallback(() => setShowHelp(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);
  const toggleRoute = useCallback(() => setShowRoute((v) => !v), []);

  /**
   * Remember the game after every move.
   *
   * Keyed on the puzzle, so moving between boards keeps each one's progress
   * separate. A board nobody has touched is not worth a slot in the store, and
   * writing `null` for it is also how starting over forgets the old game.
   *
   * Finished games are kept as well as half-played ones — that is what makes the
   * completed view come back on a later visit rather than an empty guess bar.
   */
  useEffect(() => {
    if (!state) return;
    saveGame(gameKey(state.puzzle), worthKeeping(state) ? snapshot(state) : null);
  }, [state]);

  /**
   * Dev only: step the calendar, the order the survey lists and the game plays. The
   * URL that results is still the puzzle's id — the day is how dev mode moves, never
   * how a board is addressed.
   *
   * Asynchronous because consecutive days are deliberately in different shards: day
   * `N` lives in shard `N % 256`, which is what lets any day be found with one fetch
   * and no index, and means every step of the arrows asks for another 42KB file. Cheap
   * on a dev machine, and paid once per shard for the session.
   */
  const goToPuzzle = useCallback(
    (next: number) => {
      if (!data) return;
      const day = dayIndex(next, data.manifest.days);
      void loadShard(day % data.manifest.shards, data.manifest.version).then((bank) => {
        const chosen = puzzleForDay(bank, day, data.manifest.days);
        if (chosen) show(chosen, 'push');
      });
    },
    [data, show],
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
   *
   * Nothing here touches the game: `spelled` is a view of the board, not progress on
   * it, so it costs no hints, is not written down, and goes away with the puzzle.
   * Spending hint levels on it made the tally in the header meaningless.
   */
  const nameAll = useCallback(() => {
    if (plate) setSpelled(new Set(plate.nodes));
  }, [plate]);

  /**
   * The finished round, as something to paste.
   *
   * Only computed once the round is over, because the marks need the board *as
   * first drawn* — a second full plate build, ~100ms — and the board the player is
   * looking at has grown to follow wherever they went. Judging their own detours
   * against the grown board would call every one of them an alternative that was
   * always there. See share.ts.
   *
   * Gold is `routeNodes` and green is the rest of that board, which is the whole of
   * the rule: on the shortest route, on the board, or neither.
   */
  const result = useMemo(() => {
    if (!data || !state?.solved || !at) return null;
    const { source, target } = state.puzzle;
    const first = buildPlate(data.graph, source, target, [], { board: state.puzzle.board });
    const marks = markGuesses(
      state.log.map((entry) => entry.to),
      first.routeNodes,
      new Set(first.nodes),
    );
    const date = dateForDay(at.day);
    const url = shareUrl(state.puzzle.id, window.location.origin);
    return {
      day: at.day,
      date,
      marks,
      text: shareText({
        day: at.day,
        date,
        guesses: state.guesses,
        par: state.puzzle.par,
        hints: hintCount(state),
        marks,
        url,
      }),
    };
  }, [data, state, at]);

  /** Dev only: on to the next board, once this one is done with. */
  const playAgain = useCallback(() => {
    if (at) goToPuzzle(at.day + 1);
  }, [at, goToPuzzle]);

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

  // The round is over *and* there is a result to show for it. Both, because `result` is
  // a second plate build and everything below keys off it existing.
  const finished = state.solved && result !== null;
  const beatPar = state.solved && state.guesses < state.puzzle.par;

  return (
    /**
     * One screen, and then the page.
     *
     * While there is playing to do this is the whole of it: chrome, board, guess bar,
     * fixed to the viewport so nothing scrolls and the board is whatever is left over.
     * When the round ends the board keeps that screen — it is the record of what the
     * player did, and the one thing that must not be squeezed to make room for a summary
     * of itself — and the account of the round follows it as ordinary page.
     *
     * So the result goes *above* the board, into the space the guess bar has just given
     * up, and the move list goes below the fold. The alternative was what this used to
     * do: dock the summary under the plate, let it take 62% of the viewport, and leave
     * the board a strip with both of the puzzle's own words clipped off the ends.
     */
    <>
      <div className="flex h-dvh flex-col">
        {devMode && (
          <DevBar
            index={at.day}
            total={data.manifest.days}
            puzzle={state.puzzle}
            drawn={plate.nodes.length}
            path={bestRoute}
            guesses={state.guesses}
            onGo={goToPuzzle}
            onSolve={solveIt}
            onNameAll={nameAll}
            onReset={resetPuzzle}
            onHide={toggleDev}
          />
        )}

        <Header
          source={state.puzzle.source}
          target={state.puzzle.target}
          par={state.puzzle.par}
          day={at.day}
          guesses={state.guesses}
          hints={hintCount(state)}
          // The card holds the statement while it is up, and hands it over as it goes.
          quiet={opening !== null}
          finished={finished}
          beatPar={beatPar}
          onHelp={openHelp}
        />

        {/* Above the board, so finishing is unmissable and the figure is untouched. */}
        {finished && result && (
          <Result state={state} marks={result.marks} text={result.text} />
        )}

        {/*
          The lit border is how the board says the wheel is now its own (see DWELL_MS).
          The border is always there and only changes colour, so engaging cannot resize
          the plate and move the camera — which would be a strange reward for holding
          still.
        */}
        <main
          ref={plateRef}
          className={`relative min-h-0 flex-1 border-y transition-colors ${
            engaged ? 'border-gilt-dim' : 'border-transparent'
          }`}
        >
          <GraphPlate
            state={state}
            nodes={laid.drawn}
            edges={laid.edges}
            positions={laid.positions}
            routeNodes={plate.routeNodes}
            distToTarget={plate.distToTarget}
            spurCount={plate.spurCount}
            showRoute={showRoute}
            beatPar={beatPar}
            namesWords={devMode}
            spelled={spelled}
            view={view}
            gestures={handlers}
            engaged={engaged}
            onSelect={selectWord}
            // One level per click, always: the letter count, then a letter at a time.
            onHint={hintWord}
            onSpell={spellWord}
          />

          {opening && result === null && (
            <Opening
              source={state.puzzle.source}
              target={state.puzzle.target}
              day={at.day}
              date={dateForDay(at.day)}
              phase={opening}
            />
          )}

          <button
            type="button"
            onClick={toggleRoute}
            className="label hover:text-gilt absolute right-3 bottom-2 transition-colors"
            aria-pressed={showRoute}
          >
            {showRoute ? 'Hide route' : 'Show route'}
          </button>
        </main>

        {!finished && (
          <GuessBar
            from={state.selected}
            graph={data.graph}
            isWord={isWord}
            error={error}
            onSubmit={handleGuess}
            onClearError={clearError}
          />
        )}
      </div>

      {/* Below the fold, in the same document: what you read after the figure. */}
      {finished && result && (
        <Round
          state={state}
          day={result.day}
          date={result.date}
          onPlayAgain={devMode ? playAgain : undefined}
        />
      )}

      {showHelp && (
        <HowTo
          minWord={data.graph.params.minWord}
          minSub={data.graph.params.minSub}
          onClose={closeHelp}
        />
      )}
    </>
  );
}
