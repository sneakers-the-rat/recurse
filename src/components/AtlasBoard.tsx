/**
 * One open map: the board, the guess bar, the missions and the powers. The open game's
 * counterpart to App.tsx, sharing its plate, guess bar, camera and masthead pieces.
 * The rules of the game are in atlas.ts.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormattedMessage, useIntl, type MessageDescriptor } from 'react-intl';
import { explore as says } from '../i18n/messages/explore';
import { AtlasDevBar } from './AtlasDevBar';
import { AtlasPlate } from './AtlasPlate';
import { GuessBar } from './GuessBar';
import { Masthead, type Ways } from './Masthead';
import { Boards, type Band, type Playing } from './Boards';
import { ResetView } from './ResetView';
import {
  abandon,
  collect,
  drop,
  dropCost,
  guess,
  hopsFrom,
  name,
  NAME_COST,
  openAtlas,
  refresh,
  saveAtlas,
  spread,
  take,
  travel,
  travelTo,
  wander,
  type Atlas,
  type Mission,
} from '../lib/atlas';
import { pack, writeAtlas, type AtlasRecord } from '../lib/atlasStore';
import type { Remembered, Territory } from '../lib/atlasLayout';
import {
  clamp,
  fitCamera,
  GENEROUS_SCALE,
  MAX_SCALE,
  leastScale,
  grown,
  OVERDRAW,
  inView,
  lookAt,
  showBox,
  viewOf,
  type Box,
  type Camera,
  type Plate,
} from '../lib/camera';
import { reachOf } from '../lib/forces';
import { roomFor, type Sizes } from '../lib/atlasLayout';
import { markRadius } from '../lib/sizes';
import { DOT_R } from './plate/sizes';
import { say } from '../i18n/format';
import { Caret, Plus, Query } from './marks';
import type { Lexicon } from '../lib/lexicon';
import { atlasFigure } from '../lib/plate';
import type { Regions } from '../lib/regions';
import { entrances, NO_ENTRANCE, type Entrances } from '../lib/sprout';
import type { Graph } from '../lib/types';
import { useAtlasLayout } from '../lib/useAtlasLayout';
import { useDevMode } from '../lib/useDevMode';
import { walk, type Way } from '../lib/trail';
import { useTrail } from '../lib/useTrail';
import { usePanZoom } from '../lib/usePanZoom';
import { usePlateSize } from '../lib/usePlateSize';

/** Debounce before the map is saved, in ms. */
const SAVE_AFTER = 900;

/** How long a refusal or a receipt stays up. */
const SAID_MS = 2600;

/** Least time between two steps of a walk, for steps that reveal nothing. See `onWalk`. */
const LEAST_STEP = 220;

/** Slack after an arrival's `span` before its animation markup is removed. See its use. */
const GRACE = 300;

/** The drop price as a per-letter rate, taken from `dropCost` so there is one price. */
const perLetter = `${dropCost('a')}/·`;

/** Fit the whole map, but no larger than `GENEROUS_SCALE`, so a tiny map is not magnified. */
function whole(bounds: Box, plate: Plate): Camera {
  const fitted = fitCamera(bounds, plate);
  return { ...fitted, scale: Math.min(fitted.scale, GENEROUS_SCALE) };
}

/** Which power the player has armed, if any. */
type Armed = 'name' | 'drop' | null;

interface Props {
  record: AtlasRecord;
  /**
   * The saved layout, unpacked. Its identity is how `useAtlasLayout` tells a different map has
   * opened, so the caller must keep one object per record.
   */
  settled: Remembered | null;
  atlas: Atlas;
  setAtlas: (next: Atlas) => void;
  graph: Graph;
  lexicon: Lexicon;
  regions: Regions;
  /** For the board switch. See `Boards`. */
  bands: readonly Band[];
  games: readonly { name: string }[];
  ways: Ways;
  onPlay: (wanted: Playing) => void;
  /** Go to the list of maps. */
  onMaps: () => void;
}

export function AtlasBoard({
  record,
  settled,
  atlas,
  setAtlas,
  graph,
  lexicon,
  regions,
  bands,
  games,
  ways,
  onPlay,
  onMaps,
}: Props) {
  const intl = useIntl();
  const [armed, setArmed] = useState<Armed>(null);
  const [said, setSaid] = useState<string | null>(null);
  /** The word the camera goes to once the layout stops: centred on it, or just bringing it in. */
  const [follow, setFollow] = useState<{ word: string; centre: boolean } | null>(null);

  const [plateRef, plateSize, plateEl] = usePlateSize();

  // What is drawn: every found word and its rim. See `atlasFigure` in plate.ts.
  const revealed = useMemo(() => new Set(atlas.revealed.keys()), [atlas.revealed]);
  const figure = useMemo(
    () =>
      atlasFigure(
        graph,
        (word) => regions.has(word),
        revealed,
        atlas.log.map(({ from, to }) => ({ from, to })),
      ),
    [graph, regions, revealed, atlas.log],
  );

  /**
   * The arrival schedule (see sprout.ts) for words new to the figure since the last render.
   * Opening a map is not an arrival. The ref is compared by value, so running the memo twice
   * (StrictMode) returns the same schedule. It is cleared once `span` has passed, because the
   * animation markup is costly to keep on a large map.
   */
  const seen = useRef<{ map: string; words: ReadonlySet<string>; timed: Entrances }>({
    map: '',
    words: new Set(),
    timed: NO_ENTRANCE,
  });
  // Bumped when the schedule has finished, to re-render and drop its markup.
  const [spent, setSpent] = useState(0);

  const arrivals = useMemo<Entrances>(() => {
    const last = seen.current;
    if (last.map !== record.id) {
      seen.current = { map: record.id, words: new Set(figure.nodes), timed: NO_ENTRANCE };
      return NO_ENTRANCE;
    }
    const coming = figure.nodes.filter((word) => !last.words.has(word));
    if (coming.length === 0) return last.timed;
    const timed = entrances(new Set(coming), (word) => revealed.has(word), figure.edges);
    seen.current = { map: record.id, words: new Set(figure.nodes), timed };
    return timed;
  }, [figure, record.id, revealed, spent]);

  // `GRACE` past `span`: a CSS animation ends on a frame, not a timer, and a walk's next step
  // (due at `span`) should replace the schedule before this fires.
  useEffect(() => {
    if (arrivals === NO_ENTRANCE) return;
    const timer = setTimeout(() => {
      seen.current = { ...seen.current, timed: NO_ENTRANCE };
      setSpent((n) => n + 1);
    }, arrivals.span + GRACE);
    return () => clearTimeout(timer);
  }, [arrivals]);

  /**
   * A found word is sized by its common-graph degree; an unfound one is a dot, so the rim does
   * not give away where the hubs are. See `markRadius` in sizes.ts.
   */
  const sizes = useMemo<Sizes>(
    () => ({
      radius: (word) => (revealed.has(word) ? markRadius(graph.commonNeighbors(word).length) : DOT_R),
      degree: (word) => (revealed.has(word) ? graph.commonNeighbors(word).length : 1),
      revealed: (word) => revealed.has(word),
    }),
    [revealed, graph],
  );

  const laid = useAtlasLayout(figure, regions, sizes, settled, arrivals);

  // A stable-identity view onto the latest layout, so the plate's memos can hold. What tells
  // them something moved is a territory's `shape`.
  const live = useRef(laid);
  live.current = laid;
  const reading = useMemo(
    () => ({
      get: (word: string) => live.current?.place(word),
      place: (word: string) => live.current?.place(word),
      offset: (word: string) => live.current?.offset(word),
      scale: (word: string) => live.current?.scale(word) ?? 1,
      homeOf: (word: string) => live.current?.homeOf(word) ?? -1,
      territories: () => live.current?.territories() ?? NO_GROUND,
      // Safe to forward: `onTick` keeps its painters in a ref for the life of the hook.
      onTick: (paint: () => void) => live.current?.onTick(paint) ?? noop,
    }),
    [],
  );

  // A fresh list per call, so asked once per render.
  const territories = laid?.territories() ?? NO_GROUND;

  // The opening view is the saved camera, or else the whole map.
  const bounds = laid?.figure ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const framing = useCallback(
    (): Camera =>
      record.camera
        ? {
            cx: record.camera.cx,
            cy: record.camera.cy,
            // The same floor a gesture has on this board, which can be below `MIN_SCALE`.
            scale: clamp(record.camera.scale, leastScale(bounds, plateSize), MAX_SCALE),
          }
        : whole(bounds, plateSize),
    [record.camera, bounds, plateSize],
  );

  const { camera, drawnFrom, nudge, dragging, jumpTo, glideTo, handlers, engaged } = usePanZoom(
    framing(),
    plateSize,
    bounds,
    plateEl,
  );

  // `usePanZoom` takes its camera at mount, when the plate has no size yet, so frame again once
  // it has been measured.
  const framed = useRef<string | null>(null);
  useEffect(() => {
    if (!laid || plateSize.width <= 0 || framed.current === record.id) return;
    framed.current = record.id;
    jumpTo(framing());
    // Once per map: re-running as the bounds grow would undo the player's panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, plateSize.width, record.id, jumpTo]);
  // `view` is the current window; `frame` is what the surface was last drawn for, which lags a
  // drag and overhangs by `OVERDRAW`. See `nudgeOf` in camera.ts.
  const view = useMemo(() => viewOf(camera, plateSize), [camera, plateSize]);
  const overhang = dragging ? OVERDRAW : 0;
  const frame = useMemo(
    () => viewOf(drawnFrom, grown(plateSize, overhang)),
    [drawnFrom, plateSize, overhang],
  );

  /** How far each word's drawing extends from its centre (`reachOf`), cached per `sizes`. */
  const reach = useMemo(() => {
    const room = roomFor(sizes);
    const held = new Map<string, number>();
    return (word: string) => {
      let far = held.get(word);
      if (far === undefined) {
        far = reachOf(room(word));
        held.set(word, far);
      }
      return far;
    };
  }, [sizes]);

  /**
   * After a guess, bring the word and everything that arrived with it into view (`showBox` in
   * camera.ts). Waits until the layout has stopped moving, since until then nobody knows where
   * the arrival will end up.
   */
  useEffect(() => {
    if (!follow || !laid || laid.moving) return;
    const at = laid.place(follow.word);
    if (!at) return;
    setFollow(null);
    if (follow.centre) {
      glideTo(lookAt(camera, at), 380);
      return;
    }
    const box: Box = {
      minX: at.x - reach(follow.word),
      maxX: at.x + reach(follow.word),
      minY: at.y - reach(follow.word),
      maxY: at.y + reach(follow.word),
    };
    for (const word of arrivals.nodes.keys()) {
      const spot = laid.place(word);
      if (!spot) continue;
      const far = reach(word);
      box.minX = Math.min(box.minX, spot.x - far);
      box.maxX = Math.max(box.maxX, spot.x + far);
      box.minY = Math.min(box.minY, spot.y - far);
      box.maxY = Math.max(box.maxY, spot.y + far);
    }
    glideTo(showBox(camera, box, plateSize), 380);
    // Not keyed on the camera, or every pan would re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, laid, plateSize, glideTo, arrivals, reach]);

  useEffect(() => {
    if (said === null) return;
    const timer = setTimeout(() => setSaid(null), SAID_MS);
    return () => clearTimeout(timer);
  }, [said]);

  /** Distance of every unfound word from the found ones, which prices offers. See `hopsFrom`. */
  const hops = useMemo(() => hopsFrom(graph, regions, revealed), [graph, regions, revealed]);

  // Top up the offers whenever one is taken, reached or stranded.
  useEffect(() => {
    const next = refresh(atlas, hops);
    if (next !== atlas) setAtlas(next);
  }, [atlas, hops, setAtlas]);

  // Save the map, its layout and the camera after a pause. The layout is read through the ref
  // rather than depended on: it changes every frame of an arrival, which would keep resetting
  // the timer.
  const latest = useRef({ atlas, laid, camera, record });
  latest.current = { atlas, laid, camera, record };
  useEffect(() => {
    const timer = setTimeout(() => {
      const { atlas: now, laid: here, camera: at, record: held } = latest.current;
      if (!here) return;
      void writeAtlas({
        ...held,
        touched: new Date().toISOString().slice(0, 10),
        save: saveAtlas(now),
        layout: pack(here.settled()),
        camera: { cx: at.cx, cy: at.cy, scale: at.scale },
      });
    }, SAVE_AFTER);
    return () => clearTimeout(timer);
  }, [atlas, camera]);

  // --- what the player can do ------------------------------------------------

  const answer = useCallback(
    (out: ReturnType<typeof guess>, centre = false) => {
      setAtlas(out.atlas);
      setSaid(out.refusal ? say(intl, out.refusal) : null);
      if (out.landed) setFollow({ word: out.landed, centre });
    },
    [intl, setAtlas],
  );

  /** A typed word: tried as a guess first, and only if refused, as travel to a found word. */
  const onGuess = useCallback(
    (raw: string) => {
      if (armed === 'drop') {
        setArmed(null);
        answer(drop(atlas, graph, regions, raw, lexicon));
        return;
      }
      const going = travelTo(atlas, raw, lexicon);
      const out = guess(atlas, graph, raw, lexicon);
      if (out.refusal && going) return answer(travel(atlas, going));
      answer(out);
    },
    [armed, atlas, graph, regions, lexicon, answer],
  );

  /** Where the guess bar's current text would travel to, if anywhere. */
  const going = useCallback(
    (typed: string) => travelTo(atlas, typed, lexicon),
    [atlas, lexicon],
  );

  // Tapping a found word stands on it; tapping a rim word with a power armed names it.
  const onSelect = useCallback((word: string) => answer(travel(atlas, word)), [atlas, answer]);
  const onStep = useCallback(
    (way: Way) => {
      const next = walk(atlas, way);
      if (next === atlas) return;
      // Centred on only if it is off screen.
      const at = laid?.place(next.selected);
      const seen = at !== undefined && inView(camera, at, plateSize);
      answer(seen ? { atlas: next } : { atlas: next, landed: next.selected }, true);
    },
    [atlas, answer, laid, camera, plateSize],
  );
  const steps = useTrail(atlas.stood, onStep);
  const onAsk = useCallback(
    (word: string) => {
      if (armed !== 'name') return;
      setArmed(null);
      answer(name(atlas, word, lexicon.label));
    },
    [armed, atlas, lexicon, answer],
  );

  /** Taking an offer fixes what it pays. See `take`. */
  const onTake = useCallback(
    (word: string) => setAtlas(take(atlas, { word, hops: hops.get(word) ?? 0 })),
    [atlas, hops, setAtlas],
  );
  const onAbandon = useCallback(
    (word: string) => setAtlas(abandon(atlas, word)),
    [atlas, setAtlas],
  );

  // A mission pays out the moment its word is on the map, however it got there.
  useEffect(() => {
    const { atlas: next, paid } = collect(atlas);
    if (!paid) return;
    setAtlas(next);
    setSaid(
      intl.formatMessage(says.missionDone, {
        word: lexicon.label(paid.word),
        points: paid.hops,
      }),
    );
  }, [atlas, intl, lexicon, setAtlas]);

  const resetView = useCallback(
    () => glideTo(whole(bounds, plateSize), 380),
    [bounds, plateSize, glideTo],
  );

  // --- the instruments -------------------------------------------------------

  const [devMode, toggleDev] = useDevMode();

  /**
   * Steps left in a dev-bar walk: guesses played one at a time, each waiting for the previous
   * arrival to finish (`arrivals.span`). A walk stops when there is nowhere left to go.
   */
  const [walking, setWalking] = useState(0);
  /** The found word a walk spreads out from, or null for a random walk. Fixed at the start. */
  const [walkFrom, setWalkFrom] = useState<string | null>(null);

  /** The found token a typed spelling names, or null. */
  const originOf = useCallback(
    (typed: string): string | null =>
      lexicon.parse(typed.trim().toLowerCase()).find((one) => revealed.has(one)) ?? null,
    [lexicon, revealed],
  );

  const onWalk = useCallback(
    (steps: number, from: string) => {
      const origin = from === '' ? null : originOf(from);
      if (from !== '' && origin === null) return;
      setWalkFrom(origin);
      setWalking((now) => (now > 0 ? 0 : steps));
    },
    [originOf],
  );

  useEffect(() => {
    if (walking <= 0) return;
    const timer = setTimeout(() => {
      const next =
        walkFrom === null
          ? wander(atlas, graph, lexicon, 1)
          : spread(atlas, graph, lexicon, 1, walkFrom);
      setWalking((now) => (next === atlas ? 0 : now - 1));
      if (next === atlas) return;
      setAtlas(next);
      setFollow({ word: next.selected, centre: false });
    }, Math.max(arrivals.span, LEAST_STEP));
    return () => clearTimeout(timer);
  }, [walking, walkFrom, arrivals.span, atlas, graph, lexicon, setAtlas]);

  /** The same run in one step, with no animation. */
  const onFill = useCallback(
    (steps: number, from: string) => {
      setWalking(0);
      const origin = from === '' ? null : originOf(from);
      if (from !== '' && origin === null) return;
      const next =
        origin === null
          ? wander(atlas, graph, lexicon, steps)
          : spread(atlas, graph, lexicon, steps, origin);
      if (next === atlas) return;
      setAtlas(next);
      setFollow({ word: next.selected, centre: false });
    },
    [atlas, graph, lexicon, originOf, setAtlas],
  );

  return (
    <div className="flex h-dvh flex-col">
      {devMode && (
        <AtlasDevBar
          found={revealed.size}
          figure={figure.nodes.length}
          regions={territories.length}
          points={atlas.points}
          at={atlas.selected}
          lexicon={lexicon}
          walking={walking}
          knows={(typed) => originOf(typed) !== null}
          onWalk={onWalk}
          onFill={onFill}
          onPay={(points) => setAtlas({ ...atlas, points })}
          onBlank={() => setAtlas(openAtlas(atlas.start))}
          onHide={toggleDev}
        />
      )}
      <header className="border-rule border-b">
        <Masthead
          title={<span className="label text-ash-lit">{record.name}</span>}
          lead={<Boards bands={bands} games={games} at={{ explore: record.mode }} onPlay={onPlay} />}
          ways={ways}
        />
        <div className="border-rule mx-auto flex max-w-2xl items-baseline gap-x-6 border-t px-4 py-2">
          <Figure label={says.found} value={revealed.size} />
          <Figure label={says.regions} value={territories.length} />
          <Figure label={says.mana} value={atlas.points} tone="text-gilt" />
          {/* The list of maps, which the board switch does not offer. */}
          <button
            type="button"
            onClick={onMaps}
            className="label text-ash-lit hover:text-gilt ml-auto transition-colors"
          >
            <FormattedMessage {...says.maps} />
          </button>
        </div>
      </header>

      <Missions
        offers={atlas.offers}
        taken={atlas.taken}
        slots={atlas.slots}
        hops={hops}
        lexicon={lexicon}
        onTake={onTake}
        onAbandon={onAbandon}
      />

      <main
        ref={plateRef}
        className={`relative min-h-0 flex-1 border-y transition-colors ${
          engaged ? 'border-gilt-dim' : 'border-transparent'
        }`}
      >
        {laid && (
          <AtlasPlate
            figure={figure}
            sizes={sizes}
            layout={reading}
            territories={territories}
            revealed={revealed}
            selected={atlas.selected}
            hints={atlas.hints}
            log={atlas.log}
            lexicon={lexicon}
            arrivals={arrivals}
            view={view}
            frame={frame}
            overhang={overhang}
            nudge={nudge}
            zoom={camera.scale}
            gestures={handlers}
            engaged={engaged}
            onSelect={onSelect}
            onAsk={onAsk}
          />
        )}
        {/* Top right, because the powers take the bottom of the plate. */}
        <ResetView at="right-2 top-2" onReset={resetView} />
        <Powers armed={armed} onArm={setArmed} said={said} />
      </main>

      <GuessBar
        from={atlas.selected}
        graph={graph}
        isWord={graph.isWord}
        lexicon={lexicon}
        error={null}
        travel={going}
        steps={steps}
        onSubmit={onGuess}
        onClearError={noop}
      />
    </div>
  );
}

function noop() {}

const NO_GROUND: readonly Territory[] = [];

/** A label and a number, on the line under the masthead. */
const Figure = memo(function Figure({
  label,
  value,
  tone = 'text-bone',
}: {
  label: MessageDescriptor;
  value: number;
  tone?: string;
}) {
  return (
    <span className="flex items-baseline gap-x-2">
      <span className="label text-ash-lit">
        <FormattedMessage {...label} />
      </span>
      <span className={`tabular-nums ${tone}`}>{value}</span>
    </span>
  );
});

// The dotted leader between a word and its figures: a border, so it stretches and is not read
// aloud.
const LEADER = (
  <span
    aria-hidden
    className="border-ash mb-1 min-w-4 grow self-end border-b border-dotted opacity-60"
  />
);

/**
 * The missions drawer, shut by default: every slot (filled or empty), then the offers, each row
 * a word, a leader, its distance and its pay in aligned columns. An offer's pay is its current
 * distance; a taken mission's pay is fixed. The distance never says which found word it is from.
 */
const Missions = memo(function Missions({
  offers,
  taken,
  slots,
  hops,
  lexicon,
  onTake,
  onAbandon,
}: {
  offers: readonly string[];
  taken: readonly Mission[];
  slots: number;
  /** Current distance of each unfound word. See `hopsFrom`. */
  hops: ReadonlyMap<string, number>;
  lexicon: Lexicon;
  onTake: (word: string) => void;
  onAbandon: (word: string) => void;
}) {
  const figures = (away: number, pays: number) => (
    <>
      <span className="label text-ash-lit shrink-0 tabular-nums">
        <FormattedMessage {...says.missionAway} values={{ hops: away }} />
      </span>
      <span className="text-gilt w-10 shrink-0 text-right tabular-nums">
        <FormattedMessage {...says.missionPays} values={{ points: pays }} />
      </span>
    </>
  );

  const intl = useIntl();
  const full = taken.length >= slots;
  const [open, setOpen] = useState(false);

  return (
    <div className="border-rule mx-auto w-full max-w-2xl border-b px-4 py-2">
      {/* The drawer's summary line, laid out like the rows under it. */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={intl.formatMessage(open ? says.shutMissions : says.openMissions)}
        className="label text-ash-lit hover:text-gilt flex w-full items-baseline gap-2 transition-colors"
      >
        <Caret className={`text-gilt-dim text-[0.5rem] ${open ? '' : '-rotate-90'}`} />
        <FormattedMessage {...says.missions} />
        {LEADER}
        <span className="text-ash shrink-0 tabular-nums">
          <FormattedMessage
            {...says.missionsHeld}
            values={{ taken: taken.length, slots, offers: offers.length }}
          />
        </span>
      </button>

      {open && (
        <>
          <ul className="mt-2 flex flex-col gap-0.5">
            {Array.from({ length: slots }, (_unused, slot) => {
              const mission = taken[slot];
              if (!mission) {
                return (
                  <li key={`slot-${slot}`} className="flex items-baseline gap-2">
                    <span className="label text-ash shrink-0">
                      <FormattedMessage {...says.slotEmpty} />
                    </span>
                    {LEADER}
                  </li>
                );
              }
              return (
                <li key={mission.word} className="flex items-baseline gap-2">
                  <span className="word text-bone shrink-0">{lexicon.label(mission.word)}</span>
                  {LEADER}
                  {figures(hops.get(mission.word) ?? 0, mission.hops)}
                  <button
                    type="button"
                    onClick={() => onAbandon(mission.word)}
                    className="label text-ash-lit hover:text-blood-lit w-16 shrink-0 text-right transition-colors"
                  >
                    <FormattedMessage {...says.abandon} />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-rule mt-2 border-t pt-2">
            {offers.length === 0 ? (
              <p className="label text-ash-lit">
                <FormattedMessage {...says.noMissions} />
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {offers.map((word) => (
                  <li key={word} className="flex items-baseline gap-2">
                    <span className="word text-ash-lit shrink-0">{lexicon.label(word)}</span>
                    {LEADER}
                    {figures(hops.get(word) ?? 0, hops.get(word) ?? 0)}
                    {/* Disabled, not hidden, while every slot is full. */}
                    <button
                      type="button"
                      disabled={full}
                      onClick={() => onTake(word)}
                      className="label text-gilt hover:text-bone disabled:text-ash w-16 shrink-0 text-right transition-colors"
                    >
                      <FormattedMessage {...says.take} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
});

/**
 * The two powers, `?` (count letters) and `+` (drop a word), as buttons over the bottom right of
 * the plate, aligned with the guess field. A power is armed first and spent by the next tap or
 * typed word, so its price is shown before anything is spent. Only the buttons take pointer
 * events, so the board can be dragged through the row.
 */
const Powers = memo(function Powers({
  armed,
  onArm,
  said,
}: {
  armed: Armed;
  onArm: (armed: Armed) => void;
  said: string | null;
}) {
  const intl = useIntl();

  const button = (
    which: Exclude<Armed, null>,
    label: MessageDescriptor,
    mark: React.ReactNode,
    price: string,
  ) => (
    <button
      type="button"
      onClick={() => onArm(armed === which ? null : which)}
      aria-pressed={armed === which}
      aria-label={intl.formatMessage(label)}
      title={intl.formatMessage(label)}
      className={`bg-noir/85 pointer-events-auto flex items-center gap-1.5 border px-2.5 py-1.5 leading-none backdrop-blur transition-colors ${
        armed === which
          ? 'border-gilt text-gilt'
          : 'border-rule text-bone hover:border-gilt-dim hover:text-gilt'
      }`}
    >
      <span aria-hidden className="text-base">
        {mark}
      </span>
      <span aria-hidden className="text-gilt-dim text-[0.65rem] tabular-nums whitespace-nowrap">
        {price}
      </span>
    </button>
  );

  const note =
    said ??
    (armed === 'name'
      ? intl.formatMessage(says.nameItHow)
      : armed === 'drop'
        ? intl.formatMessage(says.dropHow)
        : null);

  return (
    // The guess bar's padding and max width, so the buttons end where the field does.
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 px-4">
      <div className="mx-auto flex max-w-2xl flex-col items-end">
        {/* What an armed power wants, or the last result, on its own line for width. */}
        <span role="status" aria-live="polite" className="max-w-full">
          {note !== null && (
            <span className="label text-ash-lit bg-noir/85 border-rule mb-2 inline-block border px-2 py-1.5 text-right leading-snug backdrop-blur">
              {note}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {button('name', says.nameIt, <Query />, String(NAME_COST))}
          {button('drop', says.drop, <Plus />, perLetter)}
        </div>
      </div>
    </div>
  );
});
