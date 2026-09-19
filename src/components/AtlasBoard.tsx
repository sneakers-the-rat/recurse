/**
 * One open map: the board, the guess bar, the missions and the powers.
 *
 * The daily board's shell is App.tsx and this is the atlas's, and they are separate on
 * purpose — almost everything App does is about a puzzle, a day and a round, and none of that
 * exists here. What the two share is what a board *is*, and every piece of that is imported:
 * the plate and its words and moves, the guess bar, the camera, the gestures, the masthead.
 *
 * What is here is the shape of this game and nothing else. Four things happen on this screen:
 *
 * * **A guess** is free and uncounted. It reveals what it lands on.
 * * **Typing somewhere you have been** goes there instead of being refused. Fast travel.
 * * **A mission** names a word some distance out and pays what it promised.
 * * **A power** spends what a mission paid.
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
  take,
  travel,
  travelTo,
  wander,
  type Atlas,
  type Mission,
} from '../lib/atlas';
import { pack, writeAtlas, type AtlasRecord } from '../lib/atlasStore';
import type { Remembered } from '../lib/atlasLayout';
import {
  bringInto,
  clamp,
  fitCamera,
  GENEROUS_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  viewOf,
  type Box,
  type Camera,
  type Plate,
} from '../lib/camera';
import { visible, type Patch } from '../lib/detail';
import type { Sizes } from '../lib/atlasLayout';
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
import { usePanZoom } from '../lib/usePanZoom';
import { usePlateSize } from '../lib/usePlateSize';

/** How long after a change the map is written down. Long enough that typing does not thrash. */
const SAVE_AFTER = 900;

/** How long a refusal or a receipt stays up. */
const SAID_MS = 2600;

/**
 * The least time between two steps of a walk, whatever the last one brought in.
 *
 * A walk is paced by the arrival it is watching — the next guess waits for the last one to
 * finish coming out — and a guess that reveals nothing new has nothing to wait for. See `onWalk`.
 */
const LEAST_STEP = 220;

/**
 * What a drop costs, said as a rate.
 *
 * `dropCost` is the one place the price is decided, so the button quotes it rather than
 * writing a number of its own: one point per letter is `dropCost` of a one-letter word.
 */
const perLetter = `${dropCost('a')}/·`;

/**
 * The whole map in shot, but never drawn larger than the game draws a word.
 *
 * `fitCamera` alone would magnify a map of one word to four times life size, which is not a
 * view of anything — `GENEROUS_SCALE` is the ceiling the daily board already uses for exactly
 * this, and it means a new map opens at the size a board is read at and grows outward from
 * there.
 */
function whole(bounds: Box, plate: Plate): Camera {
  const fitted = fitCamera(bounds, plate);
  return { ...fitted, scale: Math.min(fitted.scale, GENEROUS_SCALE) };
}

/** Which power the player has armed, if any. */
type Armed = 'name' | 'drop' | null;

interface Props {
  record: AtlasRecord;
  /**
   * What the map remembered of its own layout, already unpacked.
   *
   * Its *identity* is what says a different map is on screen, so the caller keeps one object
   * per record rather than unpacking on every render — see `useAtlasLayout`.
   */
  settled: Remembered | null;
  atlas: Atlas;
  setAtlas: (next: Atlas) => void;
  graph: Graph;
  lexicon: Lexicon;
  regions: Regions;
  /** For the switch, which offers every board there is — see `Boards`. */
  bands: readonly Band[];
  games: readonly { name: string }[];
  ways: Ways;
  onPlay: (wanted: Playing) => void;
  /** To the list of maps, which is the one place the switch does not go. */
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
  const [follow, setFollow] = useState<string | null>(null);

  const [plateRef, plateSize, plateEl] = usePlateSize();

  /**
   * What is on the board: everywhere the player has been, and one step of what is next.
   *
   * Memoised on the *count* of what has been found rather than on the map itself, because the
   * revealed map is rebuilt by every step and a figure is a pass over the graph. Nothing can
   * change the figure without changing how many words are on it — a guess that reveals nothing
   * does not, and neither does a hint or a mission.
   */
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
   * What has just come onto the board, and when each of it gets to make its entrance.
   *
   * **Worked out by comparing the figure with the one drawn a moment ago**, rather than taken
   * off whatever the player did. A guess reveals one word and brings a whole rim of unnamed dots
   * behind it; the rim is a fact about the figure and not about the guess, and a set of revealed
   * words — which is what this used to be handed — left every one of those dots popping into
   * place unanimated. Reading it off the figure answers for a guess, a drop, a walk and a
   * restored map by one rule, and cannot disagree with what is on screen.
   *
   * **A map opening is not an arrival.** Every word of a restored map is new to a board that has
   * drawn nothing, and animating nine thousand of them in over a minute is not a welcome.
   *
   * **Idempotent by value, which is what makes writing to a ref from a memo safe here.** Asked
   * twice over — which StrictMode does, and which a second render with a rebuilt figure does —
   * the second pass finds every word already accounted for and hands back the schedule the first
   * one made, rather than concluding that nothing arrived. Comparing the figure by *identity*
   * would not survive either case.
   */
  const seen = useRef<{ map: string; words: ReadonlySet<string>; timed: Entrances }>({
    map: '',
    words: new Set(),
    timed: NO_ENTRANCE,
  });

  const arrivals = useMemo<Entrances>(() => {
    const last = seen.current;
    if (last.map !== record.id) {
      seen.current = { map: record.id, words: new Set(figure.nodes), timed: NO_ENTRANCE };
      return NO_ENTRANCE;
    }
    const coming = figure.nodes.filter((word) => !last.words.has(word));
    // Nothing new — a refused guess, a travel, or this pass running a second time — so whatever
    // is already playing goes on playing.
    if (coming.length === 0) return last.timed;
    const timed = entrances(new Set(coming), (word) => revealed.has(word), figure.edges);
    seen.current = { map: record.id, words: new Set(figure.nodes), timed };
    return timed;
  }, [figure, record.id, revealed]);

  /**
   * How big every word on this board is drawn, which the layout has to agree with.
   *
   * A found word is sized by its *whole* degree — every move it has, which on this board is
   * every move drawn, since revealing a word draws its rim. An unfound one is a dot whatever
   * its degree: sizing the rim would say where the hubs are before anyone had been to them,
   * and it would make the lightest things on the board heavy. See `markRadius` and `mobility`.
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

  /** Territories, as rectangles a whole crowd of words can be culled against at once. */
  const patches = useMemo<Patch[]>(
    () =>
      (laid?.territories ?? []).map((one) => ({
        words: one.words,
        at: one.at,
        radius: one.radius,
      })),
    [laid?.territories],
  );

  /**
   * Where the map is looked at from.
   *
   * There is no spine to frame, so the opening view is the one the player left — a map is a
   * place you come back to, and dropping them somewhere else throws away the only thing a
   * large board gives you, which is knowing where you are. A map with no remembered view is
   * framed whole, held to the size the daily board draws a word at so that a map of one word
   * does not arrive magnified.
   */
  const bounds = laid?.figure ?? { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const framing = useCallback(
    (): Camera =>
      record.camera
        ? {
            cx: record.camera.cx,
            cy: record.camera.cy,
            scale: clamp(record.camera.scale, MIN_SCALE, MAX_SCALE),
          }
        : whole(bounds, plateSize),
    [record.camera, bounds, plateSize],
  );

  const { camera, jumpTo, glideTo, handlers, engaged } = usePanZoom(
    framing(),
    plateSize,
    bounds,
    plateEl,
  );

  /*
    And framed *once the plate has been measured*, which is not the same moment.

    `usePanZoom` takes its opening camera at mount and owns it from then on, and at mount the
    plate is zero pixels wide because the board has not been laid out yet — so `fitCamera`
    divides by nothing, clamps to the smallest scale there is, and the map opens drawn at a
    fifth of the size with every word three pixels across. The daily board has the same problem
    and answers it with the title card; this has nothing to hide behind, so it simply jumps as
    soon as there is something to jump to.
  */
  const framed = useRef<string | null>(null);
  useEffect(() => {
    if (!laid || plateSize.width <= 0 || framed.current === record.id) return;
    framed.current = record.id;
    jumpTo(framing());
    // `framing` closes over the bounds, which move as the map grows; this only ever runs on
    // the first frame a map is measurable, so re-running it on every change would undo the
    // player's own panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, plateSize.width, record.id, jumpTo]);
  const view = useMemo(() => viewOf(camera, plateSize), [camera, plateSize]);

  /** Only what is in shot. See detail.ts, which is where the rest of this eventually goes. */
  const drawn = useMemo(
    () => (laid ? visible(figure, laid.positions, patches, view) : figure),
    [figure, laid, patches, view],
  );

  // Bring a word that has just been landed on into shot, once it has a place to be brought to.
  useEffect(() => {
    if (!follow || !laid) return;
    const at = laid.positions.get(follow);
    if (!at) return;
    setFollow(null);
    glideTo(bringInto(camera, at, plateSize), 380);
    // Reading the camera here rather than depending on it: this answers a landing, and a
    // dependency on the camera would make it answer every pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, laid, plateSize, glideTo]);

  useEffect(() => {
    if (said === null) return;
    const timer = setTimeout(() => setSaid(null), SAID_MS);
    return () => clearTimeout(timer);
  }, [said]);

  /**
   * How far out everything unfound is, which is what an offer is priced at.
   *
   * One walk per change to what has been found, and the offers read their payouts straight off
   * it — so a guess toward a word on the table makes it visibly worth less, and the number on
   * an offer is never one that was true a hundred moves ago. Memoised on `revealed`, which is
   * the only thing it depends on.
   */
  const hops = useMemo(() => hopsFrom(graph, regions, revealed), [graph, regions, revealed]);

  /** Offers are topped back up whenever one is taken, reached or stranded. */
  useEffect(() => {
    const next = refresh(atlas, hops);
    if (next !== atlas) setAtlas(next);
  }, [atlas, hops, setAtlas]);

  /**
   * Write the map down, on a pause rather than on every keystroke.
   *
   * The layout goes with it, which is what makes opening a map of three thousand words instant
   * — see `useAtlasLayout`. So does the camera, because coming back to a map you know and
   * being put somewhere else in it is the same as being given a different map.
   */
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
        layout: pack(here.settled.offsets, here.settled.centres, here.settled.radii ?? new Map()),
        camera: { cx: at.cx, cy: at.cy, scale: at.scale },
      });
    }, SAVE_AFTER);
    return () => clearTimeout(timer);
  }, [atlas, camera, laid]);

  // --- what the player can do ------------------------------------------------

  const answer = useCallback(
    (out: ReturnType<typeof guess>) => {
      setAtlas(out.atlas);
      setSaid(out.refusal ? say(intl, out.refusal) : null);
      if (out.landed) setFollow(out.landed);
    },
    [intl, setAtlas],
  );

  /**
   * A typed word.
   *
   * **Fast travel is a stand you can type**, and this is the whole of it: the guess is tried
   * first, and only when nothing plays is the word looked for on the map. A word that is both
   * a move from here and somewhere already found is a move — playing it also takes you there,
   * so there is nothing to choose between.
   */
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

  /** Asked by the guess bar of whatever is in the field, before Guess is pressed. */
  const going = useCallback(
    (typed: string) => travelTo(atlas, typed, lexicon),
    [atlas, lexicon],
  );

  /** Tapping a word: stand on it if you have been there, otherwise ask what it is. */
  const onSelect = useCallback((word: string) => answer(travel(atlas, word)), [atlas, answer]);
  const onAsk = useCallback(
    (word: string) => {
      if (armed !== 'name') return;
      setArmed(null);
      answer(name(atlas, word, lexicon.label));
    },
    [armed, atlas, lexicon, answer],
  );

  /** Accepting an offer, which is what fixes what it pays. See `take`. */
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
   * A run of guesses, played rather than faked, and **one at a time**.
   *
   * Everything a walk does goes through `guess`, so the map it leaves behind is one the layout,
   * the territories and the plates have no way of telling from a played one — which is the whole
   * reason it exists. Played *sequentially* it is also a picture of the thing the instrument is
   * mostly for judging: what a guess looks like arriving. Made all at once, a thousand words are
   * one arrangement and one ooze, and every question about how a hub unfolds is unanswerable
   * from it.
   *
   * **Paced by the arrival it is watching**, not by a fixed beat: the next guess waits out
   * whatever the last one brought in, so a guess onto a leaf is over in a moment and a guess onto
   * a hub is given its several seconds. The step is counted down whether or not it revealed
   * anything, and a walk that runs out of anywhere to go stops.
   *
   * `fill` is the same run with none of that — see `onFill`.
   */
  const [walking, setWalking] = useState(0);
  const onWalk = useCallback(
    (steps: number) => setWalking((now) => (now > 0 ? 0 : steps)),
    [],
  );

  useEffect(() => {
    if (walking <= 0) return;
    const timer = setTimeout(() => {
      const next = wander(atlas, graph, lexicon, 1);
      setWalking((now) => (next === atlas ? 0 : now - 1));
      if (next === atlas) return;
      setAtlas(next);
      setFollow(next.selected);
    }, Math.max(arrivals.span, LEAST_STEP));
    return () => clearTimeout(timer);
  }, [walking, arrivals.span, atlas, graph, lexicon, setAtlas]);

  /** The whole run at once, for getting a large map in hand rather than watching one grow. */
  const onFill = useCallback(
    (steps: number) => {
      setWalking(0);
      const next = wander(atlas, graph, lexicon, steps);
      if (next === atlas) return;
      setAtlas(next);
      setFollow(next.selected);
    },
    [atlas, graph, lexicon, setAtlas],
  );

  return (
    <div className="flex h-dvh flex-col">
      {devMode && (
        <AtlasDevBar
          found={revealed.size}
          figure={figure.nodes.length}
          shown={drawn.nodes.length}
          regions={laid?.territories.length ?? 0}
          points={atlas.points}
          at={atlas.selected}
          lexicon={lexicon}
          walking={walking}
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
          <Figure label={says.regions} value={laid?.territories.length ?? 0} />
          <Figure label={says.mana} value={atlas.points} tone="text-gilt" />
          {/*
            The list, which is the one screen the switch cannot reach: it offers *boards*, and
            a list of maps is not one. So it hangs off the map it would take you away from.
          */}
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
            figure={drawn}
            sizes={sizes}
            positions={laid.positions}
            territories={laid.territories}
            revealed={revealed}
            selected={atlas.selected}
            hints={atlas.hints}
            log={atlas.log}
            lexicon={lexicon}
            arrivals={arrivals}
            view={view}
            gestures={handlers}
            engaged={engaged}
            onSelect={onSelect}
            onAsk={onAsk}
          />
        )}
        {/*
          At the top, which is the one corner nothing else on this board wants: the powers have
          the bottom line of the plate and what an armed one says can run to two lines above
          them. The daily board keeps it at the bottom because its top is where the source stands
          and where the title card lands, and a map has neither.
        */}
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
        onSubmit={onGuess}
        onClearError={noop}
      />
    </div>
  );
}

function noop() {}

/** One figure on the line under the masthead: a label and a number. */
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

/*
  The leader between a word and its figures.

  A bottom border on a flexible cell rather than a run of dots in the text, so it stretches to
  whatever is left between a short word and the columns and cannot wrap, and so a screen reader
  is not read a line of punctuation. One element, rendered in every row: a React element is
  immutable, so there is no reason to build a fresh one per line.
*/
const LEADER = (
  <span
    aria-hidden
    className="border-ash mb-1 min-w-4 grow self-end border-b border-dotted opacity-60"
  />
);

/**
 * What there is to go and find, and what is already in hand.
 *
 * **A list and not a row of buttons**, set like a table of contents: the word on the left in
 * the ink of a word, then a leader of dots, then how far out it is and what it pays, both
 * right-aligned in their own columns. Three offers in a row of boxes read as three controls of
 * unrelated width with their numbers buried in the middle of them, and the one question a
 * player is actually asking — *which of these is worth it* — is a comparison down a column.
 * Aligning the figures is the whole of the answer.
 *
 * **A drawer, shut to begin with.** Two slots and three offers is five lines of table plus a
 * rule, and standing open that is a third of the height of a phone spent on a side errand while
 * the board — which is the whole game — gets what is left. So it folds, and the line it folds
 * into carries the two things worth knowing without opening it: how many slots are full, and how
 * many words are on the table. Shut rather than open by default because a map is opened to look
 * at the map.
 *
 * **Two lists and no headings.** The slots are on top, always all of them, an empty one drawn
 * as an empty line of the same table; below a rule are the offers, each with the button that
 * takes it. A heading over each would be two more lines of chrome over a board that wants the
 * height, and there is nothing for them to say that *Give up* and *Take* do not.
 *
 * **The two number columns are the same columns in both lists, and that is what shows the
 * lock.** An offer's distance and its payout are one figure said twice, because an offer pays
 * what it is worth now. A mission in hand shows how far there is still to go beside what it
 * agreed to pay, and the two coming apart as the player closes on it is the whole of what a
 * slot buys.
 *
 * **The distance is all it says.** Never which found word the distance is from, because working
 * that out is the game: a player told "five hops from `sparring`" has been given the route, and
 * one told "five away" has been given a question about their own map.
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
  /** How far out each unfound word is now, which is what an offer is worth. See `hopsFrom`. */
  hops: ReadonlyMap<string, number>;
  lexicon: Lexicon;
  onTake: (word: string) => void;
  onAbandon: (word: string) => void;
}) {
  /** The two figure columns, which every row of either list has in the same places. */
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
      {/*
        The line the drawer folds into, which is the same table row the lists below it are: a
        name on the left, a leader, and what is in it on the right. So opening it adds lines to
        something rather than replacing one thing with another.
      */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={intl.formatMessage(open ? says.shutMissions : says.openMissions)}
        className="label text-ash-lit hover:text-gilt flex w-full items-baseline gap-2 transition-colors"
      >
        {/* Down when it is open, and pointing at the line when it is not. */}
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
                    {/*
                      Disabled rather than gone while every slot is full: a button that vanished
                      would leave the offers looking like a list of facts, and the reason it
                      cannot be pressed is sitting two lines above it.
                    */}
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
 * What mana buys, as two marks over the board.
 *
 * A power is *armed* rather than applied: clicking it says what to do next, and the next tap
 * or the next word typed spends the points. Which is the only shape that works for both of
 * them — one wants a word on the board and the other wants a word typed — and it means the
 * price is read before anything is spent.
 *
 * **Two icon buttons and no drawer.** They were a labelled row of their own between the plate
 * and the guess bar, which cost the board a whole line of height to say two words it says again
 * in each button's accessible name. A mark and a price is as much as either needs: `?` for a
 * letter count and `+` for a word put on the map, both of which the game punctuates with
 * elsewhere. The price stays visible, because the price being readable before anything is spent
 * is the point of arming rather than applying.
 *
 * **Over the plate, right-aligned with the guess field.** The row itself has no ground under it,
 * so what lies over the board is two small boxes rather than a band across it; they are in the
 * same gutter as the field below them, so the powers, what is typed and what comes back read as
 * one column down the right of the screen. `pointer-events` are off for everything but the
 * buttons, so the board can still be dragged through the row.
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
    // The guess bar's own gutter, exactly: padding outside and the cap inside, so the buttons
    // end where the field below them ends however wide the window is.
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 px-4">
      <div className="mx-auto flex max-w-2xl flex-col items-end">
        {/*
          What an armed power wants next, and what the last one came to.

          **On its own line above the buttons**, because it is a sentence: beside them it had a
          phone's width less two buttons to be a sentence in, and what a player read was `Type any
          word. It costs one m`. It carries its own ground, a sentence over a map of words being
          unreadable without one — and nothing at all is drawn while there is nothing to say, so
          the board is clear in the state it is in most of the time.
        */}
        <span role="status" aria-live="polite" className="max-w-full">
          {note !== null && (
            <span className="label text-ash-lit bg-noir/85 border-rule mb-2 inline-block border px-2 py-1.5 text-right leading-snug backdrop-blur">
              {note}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {button('name', says.nameIt, <Query />, String(NAME_COST))}
          {/*
            A drop is priced per letter, so there is no one number to put on the button — what
            goes there is the rate, and `dropHow` beside it says what it is the rate of.
          */}
          {button('drop', says.drop, <Plus />, perLetter)}
        </div>
      </div>
    </div>
  );
});
