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
import { Puzzles } from './components/Puzzles';
import { Toast } from './components/Toast';
import { shortestPath, shortestRoutes } from './lib/graph';
import {
  applyGuess,
  hintCount,
  newGame,
  restore,
  select,
  snapshot,
  useHint,
  useMoveHint,
  worthKeeping,
  type GameState,
} from './lib/game';
import {
  BANDS,
  bandOf,
  idForDay,
  loadCalendar,
  loadGameData,
  loadPairs,
  loadShard,
  type RawCalendar,
  shardOf,
  type GameData,
  type Pair,
} from './lib/data';
import {
  dateForDay,
  dayIndex,
  dayNumber,
  puzzleById,
  resolvePuzzle,
  type DailyPuzzle,
} from './lib/daily';
import { archivePath, idFromPath, isArchive, pathFor, shareUrl } from './lib/route';
import { markGuesses, shareText } from './lib/share';
import { gameKey, loadBand, loadGame, saveBand, saveGame } from './lib/storage';
import { buildPlate } from './lib/plate';
import { useBoardLayout, type BoardSpec } from './lib/useBoardLayout';
import { openingCamera, playCamera, viewOf, type Camera, type Plate } from './lib/camera';
import { usePanZoom } from './lib/usePanZoom';
import type { Puzzle } from './lib/types';

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
 * Whether the instrument panel is showing, and a way to turn it on and off *in place*.
 *
 * **Off unless asked for, everywhere.** It used to come up by itself in a development
 * build, which meant the game as written was never the game as seen: every `npm run dev`
 * page load, and most of what gets looked at while working, arrived with a bar of
 * instruments across the top of it.
 *
 * Asking is `?dev`, the switch in the help panel, or Ctrl+D, and all three are the same
 * toggle. The keystroke needs a keyboard and the parameter needs a URL bar, so on a phone
 * the switch is the only one of the three there is — and inspecting a real board on a real
 * phone is most of what the panel is for.
 *
 * The `dev` parameter is kept in step either way, so a reload holds whichever was chosen and
 * the state of the instruments is a thing that can be sent to somebody. Ctrl rather than a
 * bare key because GuessBar sends unmodified keystrokes to the guess field, where a shortcut
 * would arrive as a letter.
 */
function useDevMode(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    const flag = new URLSearchParams(window.location.search).get('dev');
    return flag !== null && flag !== '0' && flag !== 'false';
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

  /**
   * Whether the archive is up, and the calendar years it has fetched.
   *
   * `/puzzles` is the one path that is not a board, so it is tracked here rather than through
   * `show` — which exists to put a *board* on screen and would have nothing to say about this
   * one. Kept in sync with the URL both ways: the button pushes, the back button pops.
   */
  const [archive, setArchive] = useState(() => isArchive(window.location.pathname));
  const [years, setYears] = useState<ReadonlyMap<number, RawCalendar>>(new Map());
  const needYear = useCallback(
    (year: number) => {
      if (!data) return;
      void loadCalendar(year, data.manifest.version)
        .then((calendar) => setYears((had) => new Map(had).set(year, calendar)))
        // A year that will not load costs that month's word pairs and nothing else.
        .catch(() => undefined);
    },
    [data],
  );

  const openArchive = useCallback(() => {
    window.history.pushState(null, '', archivePath(window.location.search));
    setArchive(true);
  }, []);

  /**
   * Out of the archive, to the board underneath.
   *
   * Not `history.back()`: the archive can be the first page of a visit — someone opened
   * `/puzzles` directly — and then back leaves the site rather than the page. Replacing the
   * address with the board's own is the same thing from either arrival.
   */
  const closeArchive = useCallback(() => {
    setArchive(false);
    if (state) {
      window.history.replaceState(null, '', pathFor(state.puzzle.id, window.location.search));
    }
  }, [state]);

  const [devMode, toggleDev] = useDevMode();

  /**
   * Which of the three lengths is being played.
   *
   * A day offers one short, one medium and one long board, and this says which of them "today"
   * means. It is not in the URL — a puzzle is addressed by its id and nothing else — so it
   * comes from the board on screen once there is one, and from what the player last chose
   * before that. Short on a first visit.
   */
  const [band, setBand] = useState(() => loadBand(BANDS));

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
    // Putting a board up takes the archive down: they are two paths and only one can be the URL.
    setArchive(false);
    setAt({ day: chosen.day });
    // The length on screen is the one the player is on, and the one a bare visit will open
    // next time. Read off the puzzle rather than tracked separately: a board knows which of
    // the three it is, including a board arrived at by link.
    setBand(chosen.puzzle.band);
    saveBand(chosen.puzzle.band);
    // Pick up wherever this puzzle was left, which for a reload is normally
    // mid-game. See storage.ts.
    setState(restore(chosen.puzzle, loadGame(gameKey(chosen.puzzle))));
    setError(null);
    // The query string is carried over, because `?dev` has to survive a step.
    const url = pathFor(chosen.puzzle.id, window.location.search);
    if (how === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);

  /**
   * The shard that can answer a path, fetched if it is not the one already in hand.
   *
   * Only a slice of the bank is ever in memory, and the slice that arrived with the graph is
   * the one the *first* URL of the session named. Two things follow, and both were bugs:
   *
   * - **A dead id brings its own shard, not today's.** `/deadbeef` fetched shard 222, which
   *   holds neither that id nor today's board, so the fallback found nothing and every link
   *   shared before a rebuild landed on "the puzzle data is out of step with the app" — an
   *   error page, in the one case the scheme is designed to survive.
   * - **A board reached by stepping is outside it too.** Consecutive days are deliberately in
   *   different shards, so the back button asked the opening shard about an id that was never
   *   in it and silently fell back to today.
   *
   * `loadShard` remembers what it has fetched, so going back over ground already walked costs
   * nothing.
   */
  const bankForPath = useCallback(
    async (loaded: GameData, path: string, band: number): Promise<Puzzle[]> => {
      const { manifest } = loaded;
      const asked = idFromPath(path);
      if (asked !== null) {
        const bank = puzzleById(loaded.puzzles, asked)
          ? loaded.puzzles
          : await loadShard(shardOf(asked), manifest.version);
        // Only if it is really there. An id that names nothing is a link from before a rebuild,
        // and the answer to that is today's board, from today's own shard.
        if (puzzleById(bank, asked)) return bank;
      }
      const today = await idForDay(band, dayNumber(new Date(), manifest.epoch), manifest);
      if (today !== null && puzzleById(loaded.puzzles, today)) return loaded.puzzles;
      return today === null ? loaded.puzzles : loadShard(shardOf(today), manifest.version);
    },
    [],
  );

  /** Which board a path names, once the shard that can say is in hand. */
  const boardForPath = useCallback(
    async (loaded: GameData, path: string, band: number) => {
      const { manifest } = loaded;
      const today = await idForDay(band, dayNumber(new Date(), manifest.epoch), manifest);
      return resolvePuzzle(await bankForPath(loaded, path, band), path, today);
    },
    [bankForPath],
  );

  useEffect(() => {
    // The path decides which shard is fetched, so the loader is told the id up front
    // rather than being asked for a board it did not bring. Failing an id, the band the
    // player last chose decides which of the day's three boards is fetched.
    const asked = idFromPath(window.location.pathname);
    // Whether the URL asked for the archive, captured before `show` rewrites it to a board's id.
    // A direct visit still needs a board resolved underneath — leaving the archive has to land
    // somewhere — so the board is loaded and then the address put back.
    const arrived = isArchive(window.location.pathname);
    loadGameData(asked === null ? { band: loadBand(BANDS) } : { id: asked })
      .then(async (loaded) => {
        setData(loaded);
        const chosen = await boardForPath(loaded, window.location.pathname, loadBand(BANDS));
        if (!chosen) {
          // Today's own shard does not hold the id the calendar named for today, which means
          // the year files and the shards are from different builds — see `idForDay`.
          setLoadError('the puzzle data is out of step with the app: rebuild it');
          return;
        }
        show(chosen, 'replace');
        if (arrived) {
          window.history.replaceState(null, '', archivePath(window.location.search));
          setArchive(true);
        }
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [show, boardForPath]);

  /**
   * The back button, which moves between boards rather than out of the game.
   *
   * Resolved from the path the same way the first load is — including the shard fetch, since
   * what is being gone back to is usually a board in another shard — so going back to `/`
   * lands on today and going back to a stepped board lands on that board.
   */
  useEffect(() => {
    if (!data) return;
    const onPop = () => {
      // The archive is a path too, so going back to it — or out of it — is this and not a
      // board lookup. Leaving it resolves the board underneath, which is what was on screen.
      if (isArchive(window.location.pathname)) {
        setArchive(true);
        return;
      }
      setArchive(false);
      void boardForPath(data, window.location.pathname, band).then((chosen) => {
        if (chosen) show(chosen, 'replace');
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [data, show, boardForPath, band]);

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
   * Memoised on the moves made rather than on the game, because most of what happens
   * to a game does not change what is on the board: a hint, a tap to move the cursor, a
   * refused guess. Depending on `state` rebuilt the whole board — two graph searches,
   * forty-odd milliseconds — every time any of those happened.
   *
   * The words found are *not* enough on their own. A move onto a word already named adds no
   * word and still has to be drawn, so the count of moves is part of the key: keyed on the
   * words alone, the move that joins a game played from both ends changed nothing here and
   * the winning move stayed off the figure.
   */
  const revealedKey = state
    ? `${state.log.length} ${[...state.revealed.keys()].join(' ')}`
    : '';
  // Which words are spelled out on the plate, and so how much room each one takes. Hints
  // and dev mode's reading-aloud both change it, and both are supposed to nudge the board.
  const labelKey = state
    ? [...state.hints].filter(([, l]) => l >= 2).map(([w]) => w).sort().join(' ') +
      '|' +
      [...spelled].sort().join(' ')
    : '';
  /**
   * The two answers a puzzle with a secret has, as node and edge sets.
   *
   * `answer` is the route through ordinary words — what par counts and what the board is
   * drawn as. `shortcut` is the shortest way through *at all*, which on these puzzles is
   * shorter because some rarer word cuts a corner; `puzzle.secret` is how short, so the
   * search is bounded at it. Null on the majority of puzzles, which have no shortcut.
   *
   * Both memoised on the puzzle: four bounded searches, once per board.
   */
  const answer = useMemo(() => {
    if (!data || !state) return null;
    const { source, target, par } = state.puzzle;
    return shortestRoutes(data.graph, source, target, par, data.graph.commonNeighbors);
  }, [data, state?.puzzle]);

  const shortcut = useMemo(() => {
    if (!data || !state || state.puzzle.secret === 0) return null;
    const { source, target, secret } = state.puzzle;
    return shortestRoutes(data.graph, source, target, secret);
  }, [data, state?.puzzle]);

  /**
   * Whether the player has found the shortcut, which is the only thing that puts it on the
   * board.
   *
   * Two ways to be on one, and both have to count. Usually it runs through a word no
   * ordinary answer uses, so naming that word is the discovery. But a shortcut can also be a
   * *move* between two words the board already draws — a rare subword joining them directly
   * — and then no word gives it away and only the move does. So: a named word or a walked
   * move that the shortcut has and the answer does not.
   *
   * The endpoints and the answer's own words say nothing, being on every way through.
   */
  const onSecret = useMemo(() => {
    if (!shortcut || !answer || !state) return false;
    for (const word of state.revealed.keys()) {
      if (shortcut.nodes.has(word) && !answer.nodes.has(word)) return true;
    }
    for (const { from, to } of state.log) {
      const key = from < to ? `${from} ${to}` : `${to} ${from}`;
      if (shortcut.edges.has(key) && !answer.edges.has(key)) return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut, answer, revealedKey]);

  /**
   * The shortcut **the player found**, which is not every shortcut there is.
   *
   * `shortcut` is the whole DAG of shortest legal routes, and a hub-ish puzzle has several:
   * `warming → wing → {sewing | shewing | sowing} → sing → scolding` is three. Drawing all of
   * them for landing on one hands over two the player never touched — so the trail is only the
   * routes that run through what they have actually named.
   *
   * Walked off the DAG's own depths rather than searched: from a word on it, step to a
   * neighbour one nearer the source until there are none, and one further until the target.
   * Alphabetical at a fork, so the same discovery draws the same line every time. No search,
   * which matters because this is recomputed on every guess.
   */
  const trail = useMemo(() => {
    if (!onSecret || !shortcut || !answer || !state || !data) return null;
    const { graph } = data;
    const { source, target } = state.puzzle;
    const nodes = new Set<string>();
    const edges = new Set<string>();

    const link = (a: string, b: string) => {
      nodes.add(a);
      nodes.add(b);
      edges.add(a < b ? `${a} ${b}` : `${b} ${a}`);
    };

    /** One way on from `word`, `step` being -1 toward the source and +1 toward the target. */
    const follow = (word: string, step: -1 | 1) => {
      let at = word;
      nodes.add(at);
      for (;;) {
        const depth = shortcut.depth.get(at);
        if (depth === undefined) return;
        if (step === -1 ? at === source : at === target) return;
        const next = graph
          .neighbors(at)
          .filter((near) => shortcut.depth.get(near) === depth + step)
          .sort()[0];
        if (next === undefined) return;
        link(at, next);
        at = next;
      }
    };

    /** The whole of the route through one word on the shortcut. */
    const routeThrough = (word: string) => {
      if (!shortcut.nodes.has(word)) return;
      follow(word, -1);
      follow(word, 1);
    };

    // Every word they named that the answer does not use — the ordinary case, one word off
    // the answer and the route that goes through it.
    for (const word of state.revealed.keys()) {
      if (!answer.nodes.has(word)) routeThrough(word);
    }
    // And the case with no such word: a *move* between two words the board already draws,
    // which the answer does not have. The route through that move is what was found.
    for (const { from, to } of state.log) {
      const key = from < to ? `${from} ${to}` : `${to} ${from}`;
      if (!shortcut.edges.has(key) || answer.edges.has(key)) continue;
      const near = shortcut.depth.get(from) ?? 0;
      const far = shortcut.depth.get(to) ?? 0;
      const [head, tail] = near < far ? [from, to] : [to, from];
      link(head, tail);
      follow(head, -1);
      follow(tail, 1);
    }

    return nodes.size > 0 ? { nodes, edges } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSecret, shortcut, answer, data, state?.puzzle, revealedKey]);

  const plate = useMemo(() => {
    if (!data || !state) return null;
    return buildPlate(data.graph, state.puzzle.source, state.puzzle.target, state.revealed.values(), {
      board: state.puzzle.board,
      anchors: expanded,
      moves: state.log,
      ...(trail ? { secret: trail.nodes } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, state?.puzzle, revealedKey, expanded, trail]);

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

  /**
   * A hint on a word only the shortcut draws, refused.
   *
   * The board shows those words because the player found the shortcut; selling their letters
   * would hand over the whole of what they found. So the mark says no — a cross, briefly —
   * and the tally is not touched, because a refused click bought nothing.
   *
   * A fresh object each time rather than the word alone: clicking the same word twice has to
   * cross it twice, and setting a state to the value it already holds does nothing.
   */
  const [refusal, setRefusal] = useState<{ word: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /**
   * Which words are the shortcut's alone.
   *
   * A word the puzzle declares is an ordinary board word and hints work on it as usual, even
   * if a shortcut happens to run through it. It is the ones the board would not be drawing at
   * all that are off limits.
   */
  const secretOnly = useMemo(() => {
    if (!trail || !state) return null;
    const declared = new Set([state.puzzle.source, state.puzzle.target, ...state.puzzle.board]);
    return new Set([...trail.nodes].filter((word) => !declared.has(word)));
  }, [trail, state?.puzzle]);

  /**
   * A click on an unnamed word, and which of the three things it buys.
   *
   * - A word only the shortcut draws: nothing. It says no and says why.
   * - **A word on the answer: the shape of one of its moves**, drawn on the edge — letters
   *   arriving or letters leaving. Its letters are not for sale at all: three of the seven in
   *   a word on a shortest route usually names it, which is the answer rather than a hint
   *   toward it. One more move per click, from the moves the board is drawing, until they have
   *   all been bought; name something else beside it and the new moves are there to buy too.
   * - Any other word: the letter ladder, as before. Spelling out an alternative costs the
   *   player a hint and tells them about a road they may not even want.
   */
  const hintWord = useCallback(
    (word: string) => {
      if (secretOnly?.has(word)) {
        setRefusal({ word });
        setToast('There are no hints on shortcuts!');
        return;
      }
      if (plate?.routeNodes.has(word)) {
        // The moves the *board* has, and **the ones along the answer first**: those are the
        // moves the question is usually about, and spending the first click on a detour is
        // spending it on the wrong thing. Alphabetical within each group, so the order stays
        // put as the board grows and a mark already paid for never moves to another edge.
        const near = plate.edges
          .filter(({ a, b }) => a === word || b === word)
          .map(({ a, b }) => (a === word ? b : a))
          .sort(
            (x, y) =>
              Number(plate.routeNodes.has(y)) - Number(plate.routeNodes.has(x)) ||
              x.localeCompare(y),
          );
        setState((s) => (s ? useMoveHint(s, word, near) : s));
        return;
      }
      setState((s) => (s ? useHint(s, word) : s));
    },
    [secretOnly, plate],
  );

  // Both go away on their own: the cross is over in under a second, the toast is read in two.
  useEffect(() => {
    if (!refusal) return;
    const timer = setTimeout(() => setRefusal(null), 900);
    return () => clearTimeout(timer);
  }, [refusal]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const spellWord = useCallback((word: string) => {
    setSpelled((current) => new Set(current).add(word));
  }, []);

  const openHelp = useCallback(() => setShowHelp(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);

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
   * One day of one length, whichever shard it is in.
   *
   * The whole of how a board other than the one on screen is reached: the header's three-way
   * switch keeps the day and changes the length, dev mode's arrows keep the length and change
   * the day. Neither can come up empty — every band fills every day, and `idForDay` wraps a
   * date past the last calendar year round to the start. Pushed, so the back button undoes it.
   */
  const openDay = useCallback(
    (day: number, wanted: number) => {
      if (!data) return;
      const { manifest } = data;
      const on = dayIndex(day, manifest.days);
      void idForDay(wanted, on, manifest).then((id) => {
        if (id === null) return;
        void loadShard(shardOf(id), manifest.version).then((bank) => {
          const chosen = puzzleById(bank, id);
          // The day being opened, not the puzzle's own first day: a band shorter than the
          // calendar cycles, so one puzzle answers to several dates.
          if (chosen) show({ puzzle: chosen.puzzle, day: on }, 'push');
        });
      });
    },
    [data, show],
  );

  /**
   * Dev only: step the calendar, the order the survey lists and the game plays. The
   * URL that results is still the puzzle's id — the day is how dev mode moves, never
   * how a board is addressed.
   *
   * Asynchronous because a date is a lookup in that year's calendar file and the board is then
   * in whichever shard its id names, so a step can cost two fetches. Both are cached for the
   * session, and consecutive days are in unrelated shards by construction.
   *
   * Stepping stays in the length being played. Moving between lengths is the header's job.
   */
  const goToPuzzle = useCallback((next: number) => openDay(next, band), [openDay, band]);

  /** Dev only: throw this board's saved progress away and start it again. */
  const resetPuzzle = useCallback(() => {
    if (!state) return;
    saveGame(gameKey(state.puzzle), null);
    setState(newGame(state.puzzle));
    setError(null);
  }, [state]);

  /**
   * The answer, for the dev bar and its solve button: the best route through *ordinary*
   * words, which is the one the board is drawn as and the one par counts.
   *
   * Memoised on the puzzle, not computed per render: see the note at the top.
   */
  const bestRoute = useMemo(
    () =>
      data && state
        ? (shortestPath(
            data.graph,
            state.puzzle.source,
            state.puzzle.target,
            data.graph.commonNeighbors,
          ) ?? [])
        : [],
    [data, state?.puzzle],
  );


  /**
   * A few of the shortcut's routes, for the dev bar to list under the answer.
   *
   * Walked off the DAG's own depths rather than searched again, and stopped at three: the
   * point is to read what the shortcut is made of, not to enumerate a hub's worth of ways
   * through it. Dev mode only, because nothing else asks.
   */
  const secretRoutes = useMemo(() => {
    if (!devMode || !shortcut || !data || !state) return [];
    const { source, target } = state.puzzle;
    const found: string[][] = [];
    const path: string[] = [source];
    const walk = (word: string) => {
      if (found.length >= 3) return;
      if (word === target) {
        found.push([...path]);
        return;
      }
      const depth = shortcut.depth.get(word) ?? 0;
      for (const near of data.graph.neighbors(word)) {
        if (shortcut.depth.get(near) !== depth + 1) continue;
        path.push(near);
        walk(near);
        path.pop();
      }
    };
    walk(source);
    return found;
  }, [devMode, shortcut, data, state?.puzzle]);

  /**
   * Dev only: the pair index, and a board opened by its address.
   *
   * The index is 3.7MB and nothing a player does fetches it — see `loadPairs`. So it is
   * requested by the lookup itself, on the first keystroke into it, and kept for the session.
   *
   * Opening by id is the same path an arriving link takes: fetch the shard the id names, find
   * the puzzle in it, show it. A step, so the back button undoes it.
   */
  const [pairs, setPairs] = useState<readonly Pair[] | null>(null);
  const needPairs = useCallback(() => {
    if (!data) return;
    void loadPairs(data.manifest.version).then(setPairs).catch(() => setPairs([]));
  }, [data]);

  const openById = useCallback(
    (id: string) => {
      if (!data) return;
      void loadShard(shardOf(id), data.manifest.version).then((bank) => {
        const chosen = puzzleById(bank, id);
        if (chosen) show(chosen, 'push');
      });
    },
    [data, show],
  );

  /**
   * What is left of the day: the other two lengths, unless they are finished.
   *
   * Worked out only once a round is over, because that is the only time it is shown and it
   * costs two lookups — the day's three boards have unrelated ids and so live in unrelated
   * shards. Their progress comes from storage, keyed by word pair
   * like every other saved game, so "3 in" is the real count and a solved one drops off the
   * list rather than being offered again.
   */
  const [others, setOthers] = useState<{ band: number; name: string; guesses: number }[]>([]);
  useEffect(() => {
    if (!data || !state?.solved || !at) {
      setOthers([]);
      return;
    }
    let live = true;
    const { manifest } = data;
    const wanted = manifest.bands.map((_, index) => index).filter((index) => index !== band);
    void Promise.all(
      wanted.map(async (index) => {
        const id = await idForDay(index, dayIndex(at.day, manifest.days), manifest);
        if (id === null) return null;
        const bank = await loadShard(shardOf(id), manifest.version);
        const found = puzzleById(bank, id);
        if (!found) return null;
        const saved = restore(found.puzzle, loadGame(gameKey(found.puzzle)));
        if (saved.solved) return null;
        return { band: index, name: bandOf(index, manifest).name, guesses: saved.guesses };
      }),
    )
      .then((found) => {
        if (live) setOthers(found.filter((one) => one !== null));
      })
      .catch(() => {
        // A fetch that fails costs the prompt and nothing else: the round is over either way.
        if (live) setOthers([]);
      });
    return () => {
      live = false;
    };
  }, [data, state?.solved, at, band]);

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
   * A star is a word on a shortcut, gold is `routeNodes`, green is the rest of that
   * board: the strongest true thing about each word, in that order.
   *
   * The two endpoints are left out of the shortcut set, because they are on every way
   * through and starring them would put a star on a round nobody cut a corner in.
   */
  const result = useMemo(() => {
    if (!data || !state?.solved || !at) return null;
    const { source, target } = state.puzzle;
    const first = buildPlate(data.graph, source, target, [], { board: state.puzzle.board });
    const starred = new Set(shortcut?.nodes ?? []);
    starred.delete(source);
    starred.delete(target);
    const marks = markGuesses(
      state.log.map((entry) => entry.to),
      first.routeNodes,
      new Set(first.nodes),
      starred,
    );
    const date = dateForDay(at.day);
    const url = shareUrl(state.puzzle.id, window.location.origin);
    return {
      day: at.day,
      date,
      marks,
      text: shareText({
        day: at.day,
        band: bandOf(state.puzzle.band, data.manifest).name,
        date,
        guesses: state.guesses,
        par: state.puzzle.par,
        hints: hintCount(state),
        marks,
        url,
      }),
    };
  }, [data, state, at, shortcut]);

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

  /**
   * The archive instead of the board, when the URL says so.
   *
   * Before the board's own return rather than beside it: everything below assumes a game on
   * screen, and the archive is the one screen that is about the bank rather than about a board.
   * The board's state is untouched while it is up, so leaving goes back to exactly what was
   * being played.
   */
  if (archive) {
    return (
      <Puzzles
        manifest={data.manifest}
        today={dayNumber(new Date(), data.manifest.epoch)}
        pairs={pairs}
        onNeedPairs={needPairs}
        years={years}
        onNeedYear={needYear}
        onOpen={openById}
        onToday={() => openDay(dayNumber(new Date(), data.manifest.epoch), band)}
        onClose={closeArchive}
      />
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
            secrets={secretRoutes}
            pairs={pairs}
            onNeedPairs={needPairs}
            onOpenId={openById}
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
          shortcuts={shortcut?.count ?? 0}
          bands={data.manifest.bands}
          band={band}
          // The day is kept and the length changes: a link to Tuesday's short board leads to
          // Tuesday's long one, not to today's.
          onBand={(next) => openDay(at.day, next)}
          day={at.day}
          guesses={state.guesses}
          hints={hintCount(state)}
          // The card holds the statement while it is up, and hands it over as it goes.
          quiet={opening !== null}
          finished={finished}
          beatPar={beatPar}
          onHelp={openHelp}
          onPuzzles={openArchive}
        />

        {/* Above the board, so finishing is unmissable and the figure is untouched. */}
        {finished && result && (
          <Result
            state={state}
            marks={result.marks}
            text={result.text}
            others={others}
            onBand={(next) => openDay(at.day, next)}
          />
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
            secretNodes={trail?.nodes}
            secretEdges={trail?.edges}
            refused={refusal?.word ?? null}
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

      {toast !== null && <Toast message={toast} />}

      {showHelp && (
        <HowTo
          minWord={data.graph.params.minWord}
          minSub={data.graph.params.minSub}
          devMode={devMode}
          onToggleDev={toggleDev}
          onClose={closeHelp}
        />
      )}
    </>
  );
}
