/**
 * The walkthrough, drawn over a real board.
 *
 * App puts one particular puzzle on screen — the lesson's, by id — and plays it exactly
 * as it plays any other. This adds three things and nothing else: a spotlight on whatever
 * the current step is about, a panel of prose beside it, and the rule that a step gives
 * way once the player has done what it asked. The board underneath is the game; nothing
 * here fakes a move, and every prompt is answered by playing.
 *
 * **driver.js does the cutout; everything else is ours.** What the library is genuinely
 * good at is an overlay with a hole in it that tracks an element through resizes and
 * repositions a panel beside it, which is fiddly geometry nobody should write twice. What
 * it is not built for is a target that moves sixty times a second under a camera — so the
 * cutout is refreshed on every frame the board is settling, and only while the step is
 * pointing at something on the plate.
 *
 * Two deliberate departures from how the library is usually driven:
 *
 * - **The tour never takes the page hostage.** driver.js's default is that everything but
 *   the highlighted element stops responding, which is right for a product tour over a
 *   form and wrong here: this is a game, and a player who wants to pan the board or type
 *   a different word must be able to. So the overlay is purely a picture — see the
 *   `driver-active` overrides in index.css — and a step that is wandered away from is
 *   simply a step still waiting.
 * - **The panel is React, portalled into the popover's own description.** Not the
 *   library's title-and-description strings, because the panel sets words in the game's
 *   mono and colours a `+` gilt and a `−` blood, and that grammar is the thing being
 *   taught. driver.js deliberately leaves events inside the description alone, so the
 *   arrows in it behave like ordinary buttons.
 *
 * Navigation is `lib/tutorial.ts`'s: forward once the prompt is answered, back always.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import {
  atEnd,
  beatKey,
  canGoBack,
  canGoOn,
  goBack,
  goOn,
  isCleared,
  observe,
  place,
  runFrom,
  selectorsFor,
  stageAt,
  startRun,
  stepAt,
  type Lesson,
  type Moment,
  type Run,
  type Spotlight,
} from '../lib/tutorial';
import { snapshot, worthKeeping } from '../lib/game';
import { clearTutorial, loadTutorial, saveTutorial } from '../lib/storage';
import { fitCamera, type Camera, type Plate } from '../lib/camera';
import type { Point } from '../lib/types';

interface Props {
  lesson: Lesson;
  /** The board actually on screen, so a lesson pointed at a puzzle that is gone can say so. */
  board: string;
  /** Everything a step's question is allowed to ask about. See `Moment`. */
  moment: Moment;
  /** Where each word is, for framing a step on a few of them. */
  positions: ReadonlyMap<string, Point>;
  plate: Plate;
  /** The view the round is played at, which `look: board` goes back to. */
  play: Camera;
  /** True while the camera is moving on its own, so the board is a new object each frame. */
  camera: Camera;
  onLook: (camera: Camera) => void;
  /**
   * The opening sequence is over and the board has settled.
   *
   * Nothing starts before this: the title card owns the first second of a fresh board and
   * a spotlight drawn under it points at words that are about to move.
   */
  ready: boolean;
  onLeave: () => void;
  /** Put the board back to its opening position, for a lesson being taken again. */
  onRestart: () => void;
}

/** Air left around the words a step frames, in graph units. Room for a name and its halo. */
const LOOK_MARGIN = 70;

/**
 * Air left around what is lit, in pixels, and the smallest hole worth cutting.
 *
 * The floor is what makes a `−` sign on an edge findable: the glyph is about ten pixels
 * across, and a ten-pixel hole in a dark overlay is not a spotlight, it is a smudge. Held
 * to a thumb's worth either way and grown about the target's own centre.
 */
const STAGE_PAD = 24;
const MIN_STAGE = 44;

/**
 * How long the box keeps chasing what it is over, after anything at all changes.
 *
 * Long enough to cover the camera move a beat starts (`LOOK_AFTER` plus the glide) and the
 * layout settling behind it. Both of those move the board on their own clocks — a timer and
 * a force simulation — and neither reliably re-renders this component on the frame it
 * finishes, so waiting to be told is how the panel ended up placed against a word that had
 * since slid a hundred and fifty pixels left, sitting on top of the very thing it was
 * pointing at.
 */
const CHASE_MS = 1500;

/**
 * How long the lesson waits before framing what it wants to talk about.
 *
 * The game answers the player's own move first: a guess brings the word it landed on into
 * shot, and it does that once the layout has put the word somewhere, which is a beat after
 * the guess itself. A step that a guess just advanced would otherwise start its own glide
 * and have it cancelled half way — leaving the board at whatever scale the two moves met
 * at, which is neither view. Measured as the whole spine framed at the previous step's
 * zoom, with the word the step is about off the top of the screen.
 *
 * Comfortably past App's `FOLLOW_MS`, so the lesson always speaks second. For a step
 * reached by the arrows there is nothing pending and this is a beat before the board moves,
 * which is no bad thing either.
 */
const LOOK_AFTER = 480;

export function Tutorial({
  lesson,
  board,
  moment,
  positions,
  plate,
  play,
  camera,
  onLook,
  ready,
  onLeave,
  onRestart,
}: Props) {
  /**
   * Where the player got to last time, if they have been here before.
   *
   * A lesson is long enough to be interrupted, and a reload that drops somebody back at
   * "a word inside a word" after they had worked through half of it is the tutorial
   * throwing away work. App restores the board from the same record; this restores the
   * place in the lesson. See `loadTutorial`.
   */
  const [run, setRun] = useState<Run>(() => runFrom(lesson, loadTutorial(lesson.puzzle)));
  const step = stepAt(lesson, run);
  // Memoised because `beatsOf` builds the card's first beat rather than storing it, so this
  // is a fresh object every render — and the panel is memoised on it. The board re-renders
  // this component on every frame it is moving; the panel must not follow.
  const stage = useMemo(() => stageAt(lesson, run), [lesson, run]);

  /**
   * The board the lesson was written against, or nothing.
   *
   * A puzzle's address is a digest of its answer, so a rebuild that changes the answer
   * changes the id and this lesson's steps — which name that answer's own words — are
   * about a board nobody can open any more. App's ordinary fallback for a dead id is
   * today's puzzle, which here would mean teaching `showing + ad = shadowing` over whatever
   * came up this morning. So the tutorial refuses instead, and says which id to fix.
   */
  const wrongBoard = board !== lesson.puzzle;

  /**
   * The moment the current beat opened.
   *
   * Both halves of what a beat's question is asked against: the baseline for "has
   * anything new happened", and the reading that decides whether the beat was satisfied
   * before the player ever saw it — see `observe`. Per beat and not per card, or the
   * second half of "tap this, then name that" would be judged against the moment before
   * the tap and count itself already answered.
   */
  const here = beatKey(run);
  const entered = useRef<Moment>(moment);
  const openedAt = useRef<string | null>(null);
  if (openedAt.current !== here) {
    openedAt.current = here;
    entered.current = moment;
  }

  // Every change to the game is a chance for the beat to be answered. `observe` returns
  // the run unchanged when nothing happened, so this costs nothing on the frames — most
  // of them — where the board merely moved.
  useEffect(() => {
    setRun((was) => observe(lesson, was, moment, entered.current));
  }, [lesson, moment]);

  const cleared = isCleared(lesson, run);
  const forward = canGoOn(lesson, run);
  const backward = canGoBack(lesson, run);
  const last = atEnd(lesson, run);
  const through = place(lesson, run);

  /**
   * Write down where the player is, both halves of it.
   *
   * **One writer.** The place in the lesson is this component's and the board is App's, but
   * they are one fact — a card that says "now name wing" is nonsense against a board
   * where nothing has been named — so they are saved together, from the one place that can
   * see both. App only reads it, when it opens the lesson.
   *
   * Not while the lesson is refusing to run: a save stamped with the board on screen would
   * be a save for the wrong puzzle.
   */
  useEffect(() => {
    if (wrongBoard) return;
    saveTutorial({
      puzzle: lesson.puzzle,
      at: run.at,
      beat: run.beat,
      cleared: [...run.cleared],
      game: worthKeeping(moment.state) ? snapshot(moment.state) : null,
    });
  }, [wrongBoard, lesson.puzzle, run, moment]);

  const onOn = useCallback(() => {
    if (last) wheel.current?.destroy();
    else setRun((was) => goOn(lesson, was));
  }, [lesson, last, onLeave]);

  const onBack = useCallback(() => setRun((was) => goBack(lesson, was)), [lesson]);

  /** Take it again from the top: the lesson back to its first card, the board to an empty one. */
  const onAgain = useCallback(() => {
    clearTutorial();
    setRun(startRun());
    onRestart();
  }, [onRestart]);

  /**
   * The arrow keys turn the cards.
   *
   * They are free to: the board's own keyboard controls are Enter and space on a word, and
   * `allowKeyboardControl` is off so the library is not listening either. What they are
   * *not* free to take is a text cursor — a player editing a guess is moving through their
   * own letters — so a field with the focus keeps them. Everything with a modifier is a
   * shortcut belonging to the browser.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const focused = document.activeElement;
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        (focused instanceof HTMLElement && focused.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      // Right on the last beat does nothing. The arrows move through the lesson; leaving it
      // is a decision, and one a stray keypress should not be able to make.
      if (event.key === 'ArrowLeft') setRun((was) => goBack(lesson, was));
      else setRun((was) => goOn(lesson, was));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lesson]);

  /**
   * Where to look while this beat is up.
   *
   * Keyed on the beat and on whether the words it wants are placed yet, never on
   * `positions` itself — that is a new map on every frame of a settle, and framing the
   * board sixty times a second is a camera that never arrives. A beat that asks for a
   * word the layout has not put down yet simply waits for it.
   */
  const wanted = stage?.look;
  const placed =
    wanted?.at === 'words' ? wanted.words.every((word) => positions.has(word)) : true;

  const where = useRef(positions);
  where.current = positions;

  useEffect(() => {
    if (!ready || wrongBoard || !wanted || !placed || plate.width <= 0) return;
    const timer = setTimeout(() => {
      if (wanted.at === 'board') {
        onLook(play);
        return;
      }
      // Read now rather than when the effect was set up: a word named by the guess that
      // advanced the step has only just been given somewhere to be.
      const points = wanted.words
        .map((word) => where.current.get(word))
        .filter((point): point is Point => point !== undefined);
      if (points.length === 0) return;
      onLook(
        fitCamera(
          {
            minX: Math.min(...points.map((p) => p.x)),
            maxX: Math.max(...points.map((p) => p.x)),
            minY: Math.min(...points.map((p) => p.y)),
            maxY: Math.max(...points.map((p) => p.y)),
          },
          plate,
          LOOK_MARGIN,
        ),
      );
    }, LOOK_AFTER);
    return () => clearTimeout(timer);
    // `wanted` is the current beat's, which `here` stands for; `positions` is read
    // through a ref, and `placed` is the part of it this waits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here, ready, wrongBoard, placed, plate, play, onLook]);

  /** The library's instance, and the element it is currently drawing our panel into. */
  const wheel = useRef<Driver | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  /**
   * The thing the library is actually pointed at: a box of our own, over what a beat lights.
   *
   * It exists for three reasons, and each of them was a bug that had to be looked at to be
   * believed.
   *
   * - **A spotlight is often more than one element.** A move is a line *and* the two words
   *   it runs between, and the library takes a single element — so "this is what a move
   *   looks like" lit the middle of the line and cut both words in half. This is the union
   *   of everything `selectorsFor` finds.
   * - **A hole in a dark overlay is not visible on a dark board.** The undimmed area over a
   *   four-pixel dot is a slightly-less-black square, which reads as nothing at all. So the
   *   box is drawn as well as measured: a gilt hairline sits exactly on the edge of the
   *   cutout, which is why `stagePadding` is zero and the padding is added here instead.
   * - **A tiny target needs a floor.** See `MIN_STAGE`.
   *
   * A plain DOM node rather than something React renders, because it is instrument and not
   * content: it has to exist before the first `highlight` call and be written to on frames
   * that must not cost a render.
   */
  const stageBox = useRef<HTMLDivElement | null>(null);

  /** Where the box was put last, so a frame that changes nothing costs nothing. */
  const framed = useRef('');

  /**
   * Put the box over what this beat lights, and say what happened.
   *
   * `gone` when nothing is found — a mark not yet bought, a word not yet drawn — and the
   * caller then lets the library centre the panel over no cutout at all. `moved` only when
   * the box is somewhere new, which is what decides whether the library is asked to
   * reposition: `refresh` cancels its own pending frame, so calling it every frame of a
   * settle means it never actually runs.
   */
  const frame = useCallback((spot: Spotlight | undefined): 'gone' | 'same' | 'moved' => {
    const box = stageBox.current;
    if (!box) return 'gone';

    const rects = (spot ? selectorsFor(spot) : [])
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 || rect.height > 0);

    if (rects.length === 0) {
      box.style.display = 'none';
      framed.current = '';
      return 'gone';
    }

    let left = Math.min(...rects.map((r) => r.left)) - STAGE_PAD;
    let top = Math.min(...rects.map((r) => r.top)) - STAGE_PAD;
    let width = Math.max(...rects.map((r) => r.right)) + STAGE_PAD - left;
    let height = Math.max(...rects.map((r) => r.bottom)) + STAGE_PAD - top;
    // Grown about its own centre, so a floor never drags the hole off the thing it is over.
    if (width < MIN_STAGE) {
      left -= (MIN_STAGE - width) / 2;
      width = MIN_STAGE;
    }
    if (height < MIN_STAGE) {
      top -= (MIN_STAGE - height) / 2;
      height = MIN_STAGE;
    }

    // Rounded before comparing, so a settle that jitters a word by a hundredth of a pixel
    // does not count as movement and keep the library repositioning for ever.
    const where = [left, top, width, height].map(Math.round).join(',');
    box.style.display = 'block';
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    if (where === framed.current) return 'same';
    framed.current = where;
    return 'moved';
  }, []);

  useEffect(() => {
    const box = document.createElement('div');
    box.className = 'recurse-stage';
    box.setAttribute('aria-hidden', 'true');
    document.body.appendChild(box);
    stageBox.current = box;

    const it = driver({
      // No tween on the cutout. The stage is only tracked as `__activeElement` once a
      // transition finishes, so an animated move plus a `refresh` on every frame of a
      // board settle fights itself: the refresh recomputes the hole from the element the
      // driver has not finished leaving. The motion the tutorial does want is the
      // camera's, and that is ours.
      animate: false,
      allowClose: false,
      allowScroll: true,
      // The game listens for bare keystrokes and sends them to the guess field. Arrow
      // keys and Escape belong to the board, not to the tour.
      allowKeyboardControl: false,
      overlayColor: 'var(--color-noir)',
      overlayOpacity: 0.68,
      // Zero, because the padding is in the box itself — the hole and the hairline drawn
      // round it have to be the same rectangle or the border floats inside the light.
      stagePadding: 0,
      stageRadius: 2,
      popoverClass: 'recurse-tour',
      showButtons: [],
      showProgress: false,
      onPopoverRender: (dom) => {
        // Not a dialog: nothing here is modal, nothing is trapped, and the board behind
        // it stays live. Saying otherwise is both a lie to a screen reader and a real
        // bug — GuessBar stops sending stray keystrokes to the guess field while a
        // `[role="dialog"]` is open, so the tutorial would have quietly broken typing.
        dom.wrapper.setAttribute('role', 'complementary');
        // `aria-labelledby` beats `aria-label`, and the library points it at a title
        // element this never fills in — so without these two removals the panel announces
        // itself as "Popover Title".
        dom.wrapper.removeAttribute('aria-labelledby');
        dom.wrapper.removeAttribute('aria-describedby');
        dom.wrapper.setAttribute('aria-label', 'Tutorial');
        // And the element itself goes, rather than being left hidden with the library's
        // placeholder in it: it is a `<header>`, so every test that reaches for the
        // masthead by tag finds two, and the second one says "Popover Title".
        dom.title.remove();
        setHost(dom.description);
      },
    });
    wheel.current = it;
    return () => {
      it.destroy();
      box.remove();
      stageBox.current = null;
      wheel.current = null;
      setHost(null);
    };
  }, []);

  /**
   * Point the spotlight at whatever this beat is about.
   *
   * A beat with nothing to point at still goes through `highlight`: the library puts the
   * panel in the middle of the screen over a cutout of no size, which is exactly what a
   * card about the game rather than about a part of it wants. A selector that finds
   * nothing does the same, which is the right answer for a mark that has not been bought
   * yet.
   */
  const spot = wrongBoard ? undefined : stage?.spotlight;
  useEffect(() => {
    const it = wheel.current;
    if (!it || !ready) return;
    // Forgotten, so the box counts as having moved into place for the new beat even when it
    // happens to land exactly where the last one was.
    framed.current = '';
    const lit = frame(spot) !== 'gone';
    it.highlight({
      // Left off entirely when there is nothing to point at, rather than passed as
      // undefined: the library then uses its own centred stand-in, which is what a card
      // about the game as a whole wants.
      ...(lit && stageBox.current ? { element: stageBox.current } : {}),
      // A description the library will not hide. The panel is portalled into it.
      popover: { description: '<div></div>', side: 'bottom', align: 'center' },
    });
  }, [here, spot, ready, frame]);

  /**
   * Place the panel again once there is something in it.
   *
   * The library decides which side of the target to sit on by measuring the popover, and
   * it measures it at the moment it is created — when the description holds the empty div
   * the panel is about to be portalled into. So every step was placed as if it were sixty
   * pixels tall, which came out wrong in exactly the case the game most needs right: a
   * step pointing at the guess bar found "room below" at the foot of the screen, and put
   * its own arrows off the bottom of the viewport.
   *
   * A refresh re-measures and re-places, and by the time this effect runs the panel is in
   * the DOM at its real height. `cleared` is here because a tick appearing in the prompt
   * changes that height too.
   */
  useEffect(() => {
    if (host) wheel.current?.refresh();
  }, [host, here, cleared]);

  /**
   * Keep the hole over a word that is moving, by chasing it rather than being told.
   *
   * The plate has no scroll and no resize when its contents move — the force layout settles
   * on its own clock and the camera glides on a timer — so none of the events the library
   * watches for fire. Watching React for it does not work either, and that was the bug: the
   * one render this component saw between a beat opening and the board arriving somewhere
   * new came *before* the camera had moved, so the panel was placed against a word that then
   * slid a hundred and fifty pixels left, and the tutorial's own prose ended up sitting on
   * the word it had just told the player to click.
   *
   * So for a short window after anything changes, the box is re-measured every frame and the
   * library asked to reposition only when it has actually moved. Only when a beat is pointing
   * at the plate: the chrome holds still, and this would be a rectangle measured sixty times
   * a second to get the same answer.
   */
  const onPlate = spot !== undefined && spot.on !== 'chrome';
  useEffect(() => {
    if (!onPlate) return;
    let left = Math.ceil(CHASE_MS / 16);
    let raf = requestAnimationFrame(function chase() {
      // The box is put back over the target *before* the refresh, because the box is what
      // the library measures: a refresh alone would move the hole to where our own stale
      // rectangle still was.
      if (frame(spot) === 'moved') wheel.current?.refresh();
      if (--left > 0) raf = requestAnimationFrame(chase);
    });
    return () => cancelAnimationFrame(raf);
  }, [onPlate, spot, frame, positions, camera]);

  const panel = useMemo(() => {
    if (wrongBoard) {
      return (
        <div className="space-y-3">
          <h2 className="text-bone text-lg leading-tight font-semibold">
            The tutorial’s board is not in this bank
          </h2>
          <p className="text-bone-dim text-sm leading-relaxed">
            It is taught on one particular puzzle,{' '}
            <span className="word text-bone">{lesson.puzzle}</span>, and a rebuild that
            changed that puzzle’s answer changed its address. Point{' '}
            <span className="word text-bone">LESSON.puzzle</span> at a board that is still
            there, and rewrite the steps that name its words.
          </p>
          <button type="button" onClick={onLeave} className={QUIET}>
            Back to today
          </button>
        </div>
      );
    }
    if (!step) return null;

    return (
      // Named, so a test can say which card and which beat it is looking at without
      // reading the prose.
      <div data-step={step.id} data-beat={run.beat} className="space-y-3">
        <h2 className="text-bone text-lg leading-tight font-semibold">{step.title}</h2>

        <div className="text-bone-dim space-y-2 text-sm leading-relaxed">{step.body}</div>

        {/*
          The prompt, set apart from the prose and ticked when it is answered. Apart
          because it is the one line that is an instruction rather than an explanation,
          and a player skimming for what to do next should find it without reading. It is
          the beat's, not the card's: the prose stays put while a two-part instruction
          works through its halves.
        */}
        {stage?.ask && (
          <p
            className={`border-l-2 py-1 pl-3 text-sm leading-snug transition-colors ${
              cleared ? 'border-gilt text-gilt' : 'border-gilt-dim text-bone'
            }`}
            role="status"
          >
            {cleared && (
              <span aria-hidden className="mr-1.5">
                ✓
              </span>
            )}
            {stage.ask.prompt}
          </p>
        )}

        <div className="border-rule flex items-center justify-between gap-3 border-t pt-3">
          {/*
            Padded out to a tappable height on a phone, where these sit beside the arrows.
            Starting again is offered wherever the lesson is picked up, because the reason
            it can be picked up at all is that it remembers — and a lesson that remembers
            needs a way to forget.
          */}
          <span className="flex items-center gap-3">
            <button type="button" onClick={onLeave} className={QUIET}>
              leave
            </button>
            {run.at > 0 && (
              <button type="button" onClick={onAgain} className={QUIET}>
                start over
              </button>
            )}
          </span>

          <span className="flex items-center gap-2">
            <span className="label text-ash-lit">
              {through.at}/{through.of}
            </span>
            <button
              type="button"
              onClick={onBack}
              disabled={!backward}
              aria-label="Previous step"
              className={ARROW}
            >
              ‹
            </button>
            <button
              type="button"
              onClick={onOn}
              // The forward arrow is the prompt's gate: a beat that says "type shadowing"
              // and can be clicked past has taught nothing. The last one is always
              // pressable, because finishing is not a thing to be gated.
              disabled={!forward && !last}
              aria-label={last ? 'Finish the tutorial' : 'Next step'}
              className={last ? DONE : ARROW}
            >
              {last ? 'Done' : '›'}
            </button>
          </span>
        </div>
      </div>
    );
  }, [
    wrongBoard,
    lesson,
    step,
    stage,
    run.at,
    run.beat,
    through,
    cleared,
    backward,
    forward,
    last,
    onBack,
    onOn,
    onLeave,
    onAgain,
  ]);

  if (!host) return null;
  return createPortal(panel, host);
}

/**
 * The controls, sized for a thumb first.
 *
 * A phone is the target and these are the only things on the panel that are pressed, so
 * they are a proper target there and shrink to the chrome's own scale on a wide screen —
 * where there is a pointer, and where a 44-pixel arrow beside eleven-point caps looks like
 * a mistake.
 */
const QUIET =
  'label text-ash-lit hover:text-bone-dim -mx-2 px-2 py-3 transition-colors sm:mx-0 sm:px-0 sm:py-0';

const ARROW =
  'border-rule text-bone hover:border-gilt hover:text-gilt disabled:text-ash-lit ' +
  'disabled:hover:border-rule flex h-11 w-11 items-center justify-center border text-xl ' +
  'leading-none transition-colors disabled:cursor-not-allowed sm:h-7 sm:w-7 sm:text-base';

const DONE =
  'label border-gilt-dim text-gilt hover:border-gilt hover:bg-gilt-dim/15 border px-4 py-3.5 ' +
  'leading-none transition-colors sm:px-3 sm:py-1.5';
