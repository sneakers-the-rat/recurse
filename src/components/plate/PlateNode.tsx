/**
 * One word on a plate: everything about it except where it is.
 *
 * Split out and memoised because of what a settle costs. A layout redraws the plate on every
 * frame it moves, and on each of those frames the only thing that has changed about a word is
 * its position — yet the whole mark was being rebuilt: five booleans, a ladder of colours, a
 * hint label, a sentence of accessible text, ten elements. Ninety words of that, sixty times a
 * second, was the single largest cost in the game. So position lives on the group *outside*
 * this, which is the one attribute a frame touches, and everything in here is given as plain
 * values that a frame does not change.
 *
 * **The grammar is the game's, not one board's.** Quietest to loudest:
 *
 *   unrevealed     a small ash dot — a word that exists here and is unnamed
 *   on the route   the same dot in gilt — this one lies on a shortest path
 *   hinted once    ring holding the letter count
 *   hinted more    the letters asked for, dim, with a dot per letter still unknown
 *   revealed       full circle, filled and labelled, ringed gilt on the route and bone off it
 *   an endpoint    bone, double ring, named from the start
 *   selected       gilt outer ring, where the next guess comes from
 *
 * Size tracks *knowledge* first: a named word is a full circle and an unnamed one a dot. On a
 * board that passes `degree` it tracks structure as well, a busy word being a bigger circle
 * than a quiet one — which the daily board deliberately does not do, having one meaning on that
 * channel already. **A node's colour is about the route, never about the move that reached it**
 * — see `ring`.
 *
 * The props an open board has no use for — `onRoute`, `isSource`, `isTarget`, `onSecret`,
 * `spurs` — all default to nothing, so a plate with no answer and no ends simply does not pass
 * them and gets the plain grammar: dots, names, hints, and a ring where you stand.
 */

import { memo } from 'react';
import { useIntl } from 'react-intl';
import { board as says } from '../../i18n/messages/board';
import { Said } from '../marks';
import { fullyHinted, hintLabel } from '../../lib/hints';
import type { Lexicon } from '../../lib/lexicon';
import { insideLabel, LABEL_CLEAR, LABEL_SIZE, markRadius } from '../../lib/sizes';
import { DOT_R, NODE_R, REACH, SPUR_LEN, SPUR_SHOWN_MAX } from './sizes';

/** Where a pointer event happened, which is all of one that any of this needs. */
export type At = { clientX: number; clientY: number; currentTarget: Element };

/**
 * Moves that lead off the board, drawn as a small fan of ticks.
 *
 * A word's unexplored moves are worth knowing about — they are what makes it a
 * hub — but as full nodes they swamped the routes they hang off, four to one. As
 * ticks they cost almost no space and still read at a glance as "lots of options
 * here". The fan is aimed away from the board's centre line so it does not
 * collide with the edges already drawn.
 *
 * Ticks count doublings, not moves. The range is enormous — four moves off one
 * word, a hundred and ten off another — so one tick each is impossible and a
 * printed number beside the node was just a stray digit on the plate. A fan that
 * grows by one tick per doubling stays a picture, and the comparison it invites
 * (this word branches more than that one) is the true one.
 */
function SpurFan({ count, awayFrom }: { count: number; awayFrom: number }) {
  if (count <= 0) return null;
  const shown = Math.min(Math.round(Math.log2(count)) + 1, SPUR_SHOWN_MAX);
  // Widen the fan as there are more of them, but never past a quadrant either
  // side: the fan has to stay clear of the label above the node.
  const spread = Math.min(0.34 + shown * 0.17, 1.5);
  const ticks = [];
  for (let i = 0; i < shown; i++) {
    const t = shown === 1 ? 0.5 : i / (shown - 1);
    const angle = awayFrom - spread / 2 + t * spread;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    ticks.push(
      <line
        key={i}
        x1={cos * (NODE_R + 2)}
        y1={sin * (NODE_R + 2)}
        x2={cos * (NODE_R + 2 + SPUR_LEN)}
        y2={sin * (NODE_R + 2 + SPUR_LEN)}
        stroke="var(--color-ash)"
        strokeWidth="1"
        strokeLinecap="round"
      />,
    );
  }
  return (
    <g aria-hidden opacity="0.9">
      {ticks}
    </g>
  );
}

export const PlateNode = memo(function PlateNode({
  word,
  lexicon,
  isRevealed,
  isSource = false,
  isTarget = false,
  isSelected,
  onRoute = false,
  level,
  inspected = false,
  spurs = 0,
  spurAngle = 0,
  onSecret = false,
  refused = false,
  degree = 1,
  sprouting = false,
  delay = 0,
  grow = 0,
  onHover,
  onUnhover,
  onActivate,
  onInspect,
}: {
  word: string;
  /**
   * How this word is written and said. A stable object per mode — `PLAIN` in the letters
   * game — so it compares by identity and the memo above still holds.
   */
  lexicon: Lexicon;
  isRevealed: boolean;
  isSource?: boolean;
  isTarget?: boolean;
  isSelected: boolean;
  /**
   * The word is on a shortest route: gilt, and its *letters* are not for sale — a click buys
   * the shape of one of its moves instead, drawn on the edge. See App's `hintWord`.
   */
  onRoute?: boolean;
  level: number;
  inspected?: boolean;
  spurs?: number;
  spurAngle?: number;
  onSecret?: boolean;
  refused?: boolean;
  /**
   * How many moves this word has, where the board draws that as size.
   *
   * One is what every word was before any board did, and is what the daily one still passes:
   * there, a mark says how much is *known* about a word and nothing else, and sizing by degree
   * would put a second meaning on the one channel that already has one. An open map has no such
   * grammar to protect and a great deal more graph to read, so on it a busy word is a big one.
   * See `markRadius`.
   */
  degree?: number;
  /**
   * This word has just arrived, so it grows into place rather than appearing in it.
   *
   * An open map gains a word and a ring of unfound ones with every guess, and a board that
   * simply had them all next frame read as a flicker rather than as something growing. `delay`
   * is when this one's turn comes and `grow` is how long it takes, both decided per word by
   * `sprout.ts` — so a guess onto a hub is a hundred and eighty dots coming out unevenly over
   * several seconds rather than a starburst. The same two numbers move the word *outward* in
   * `useAtlasLayout`; the fade and the journey are one gesture.
   *
   * The animation is `.sprout` in index.css, which is also where `prefers-reduced-motion` turns
   * it off. Left at nothing, the stylesheet's own defaults apply.
   */
  sprouting?: boolean;
  delay?: number;
  grow?: number;
  onHover: (word: string, at: At | null) => void;
  onUnhover: (word: string, at: At | null) => void;
  onActivate: (word: string, at: At | null) => void;
  onInspect: ((word: string, at: At) => void) | undefined;
}) {
  const intl = useIntl();
  const isEndpoint = isSource || isTarget;
  const hinted = level > 0;
  // Named words, and the two you are given, are drawn as circles; the rest
  // of the board is dots. Hinting a word promotes it halfway, because a
  // letter count needs somewhere to sit.
  //
  // Past the first hint the label is letters rather than a digit, so it
  // needs a word's worth of room and a word's legibility — set above the
  // node, like a named word, but dim, because it was given not found. A word
  // dev mode has spelled out is drawn the same way, for the same reason.
  const spelled = level >= 2 || inspected;
  const named = isRevealed || isEndpoint || spelled;

  // The whole visual grammar for one node, decided in one place. Left as
  // nested ternaries inside the JSX it was four separate ladders over the
  // same five booleans, and no two of them read the same way.
  const full = markRadius(degree);
  const r = isRevealed || isEndpoint ? full : hinted ? NODE_R - 3 : DOT_R;
  /**
   * A word is gilt because it lies on a shortest route, and bone because it does not.
   * That is the whole of what a node's colour says.
   *
   * It used to say how the word had been *reached* — gilt for one arrived at by adding
   * letters, blood for one arrived at by taking them away — which borrows the edges'
   * grammar for something it does not describe. An edge *is* a move, and a move genuinely
   * does add or remove; a word is only a word. So half of a perfectly played answer came
   * out blood red, including words sitting on the gilt route, and a correct move to a
   * shorter word was drawn in the colour this palette otherwise keeps for something being
   * lost. The move is still recorded, in the place that means it: the edge, in its colour,
   * with the subword on it.
   */
  const ring = isEndpoint
    ? 'var(--color-bone)'
    : onRoute
      ? 'var(--color-gilt)'
      : isRevealed
        ? 'var(--color-bone)'
        : 'var(--color-ash-lit)';
  // A word on a found shortcut, still to be named: gilt, and otherwise exactly what it was.
  // Size says how much is *known* about a word and nothing else on the board breaks that
  // rule, so this does not either — the shortcut is said in colour, and in the weight of the
  // line between one word and the next.
  const secret = onSecret && !named;
  const fill = secret
    ? 'var(--color-gilt)'
    : named
      ? 'var(--color-noir-3)'
      : hinted
        ? 'var(--color-noir-2)'
        : onRoute
          ? 'var(--color-gilt-dim)'
          : 'var(--color-ash)';
  const weight = named ? 1.4 : hinted ? 1 : 0.8;
  const presence = named || secret ? 1 : onRoute ? 0.95 : 0.7;
  // A word named by dev mode, rather than earned, is set dim: it is an
  // inspection of the board, not a move on it.
  const ink =
    spelled && !isRevealed
      ? 'var(--color-bone-dim)'
      : named
        ? 'var(--color-bone)'
        : 'var(--color-bone-dim)';

  /*
    What the plate writes, in one line or two.

    A word whose identity is known — named, the goal, or spelled out by dev mode — is drawn as
    its spelling with its transcription beneath, because in the phonemes game the spelling is
    what a player types and the transcription is what the puzzle is actually about, and it is
    the only thing telling two nodes apart when a word is said two ways.

    **A hint is drawn in letters, in both games, and that is the whole of the special case.**
    A hint is help naming the word; the count and the letters it turns up are of the
    *spelling*, because nobody knows how many phonemes `thought` has or what `/θɔt/` looks
    like — see `Spell` in hints.ts, which is where the rest of this lives. So the hint text is
    already written in the alphabet the player reads and must not be transcribed on its way
    out: it was, and a partly-hinted word came out as a row of IPA with dots in it.

    Which means nothing goes underneath a partial hint either. There is no transcription to
    put there that would not hand over the answer the hint is being paid for a letter at a
    time — and once the last letter is bought the word is simply there, and it gets the second
    line like any other named word.

    A word on the answer shows nothing at all: its hints are on its edges, and a level stored
    by a version that sold its letters must not surface them now.

    The letters game has nothing to say twice and draws exactly what it always did — `spell`
    is the identity there and `translated` is false.
  */
  const spelling = lexicon.label(word);
  const known = isRevealed || isTarget || inspected;
  const hint = known || onRoute ? null : hintLabel(spelling, level);
  /*
    Where the word sits: above the mark once it is a word, inside it while it is still a
    count or a row of dots — which is also true of a word bought letter by letter until it is
    whole, since that is a word nobody has *reached*.

    The transcription is one line under whichever of those it is, derived rather than written
    down twice. Given its own constant it agreed with the named case only: a word spelled out
    entirely by hints drew its letters inside the mark and how it is said above the mark, with
    the whole node between the two halves of one label.
  */
  // The word is on show — either because it is named, or because enough hints have been
  // bought that nothing is left dotted out. Both are the same thing to read.
  const whole = known || hint === spelling;
  const label = known ? spelling : hint;
  const beneath = whole && lexicon.translated ? lexicon.transcribe(word) : null;
  /*
    **A name big enough to sit inside its own mark sits inside it**, set to fit.

    Only where a board draws degree at all, since only there does a mark ever get big enough.
    A large disc with its name floating above it is two things where there should be one: the
    name is clear of the thing it names, and on a crowded map it is clear of it and over
    something else. Inside, the mark reads as a labelled place, and the type growing with the
    disc says how busy the word is twice over. See `insideLabel`, which is also what the layout
    asks so that a word with its name inside claims no room beside it.
  */
  const within = known ? insideLabel(spelling.length, r) : null;
  const labelY = within !== null ? 0 : named ? -r - LABEL_CLEAR : 3.5;
  // A transcription belongs with the spelling, so it follows it in or out.
  const beneathY = within !== null ? r + within * 0.85 : labelY + 9.5;

  return (
    <>
      {/*
        The reveal animation lives on its own group, inside the one that
        positions the node. Sharing a group meant the CSS transform of
        the animation replaced the SVG transform attribute that placed
        it, so every word being named flew in from the corner of the
        board instead of surfacing where it belongs.
      */}
      <g
        className={sprouting ? 'sprout' : isRevealed && !isSource ? 'surface' : undefined}
        style={
          sprouting
            ? ({
                '--delay': `${Math.round(delay)}ms`,
                ...(grow > 0 ? { '--grow': `${Math.round(grow)}ms` } : {}),
              } as React.CSSProperties)
            : undefined
        }
      >
        {/* Only where the player stands: a hub is news once you are on it. */}
        {isRevealed && <SpurFan count={spurs} awayFrom={spurAngle} />}

        {isSelected && (
          <circle
            r={r + 5}
            fill="none"
            stroke="var(--color-gilt)"
            strokeWidth="1"
            opacity="0.75"
          />
        )}

        <circle
          r={r}
          fill={fill}
          stroke={secret ? 'var(--color-gilt)' : ring}
          strokeWidth={secret ? 1.2 : weight}
          opacity={presence}
        />

        {/*
          A hint refused. Drawn over the mark rather than instead of it, and fading out on its
          own, so the word says no and then goes back to being what it was — a shortcut still
          waiting to be found — without the board moving or the mark changing size.
        */}
        {refused && (
          <g className="crossed" aria-hidden>
            <path
              d={`M${-r - 2} ${-r - 2}L${r + 2} ${r + 2}M${r + 2} ${-r - 2}L${-r - 2} ${r + 2}`}
              stroke="var(--color-blood-lit)"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </g>
        )}

        {/* Deco double ring marks the two words you are given. */}
        {isEndpoint && (
          <circle
            r={r - 3.5}
            fill="none"
            stroke={isRevealed ? 'var(--color-bone-dim)' : 'var(--color-bone)'}
            strokeWidth="0.6"
            opacity="0.8"
          />
        )}

        {/* The goal, still unreached: the same lozenge as the header. */}
        {isTarget && !isRevealed && (
          <rect
            x={-3.2}
            y={-3.2}
            width={6.4}
            height={6.4}
            transform="rotate(45)"
            fill="var(--color-gilt)"
          />
        )}

        {label !== null && (
          <text
            y={labelY}
            textAnchor="middle"
            // Centred on the mark when it is in it, and sitting on its own baseline when it is
            // above: a name inside a disc has to be middled vertically or it rides high.
            dominantBaseline={within !== null ? 'central' : undefined}
            // Not a target: the hit area below is, and a long word overhangs it by a good
            // deal. Left clickable, a tap on the tail of one word does nothing at all rather
            // than reaching whatever it is lying over.
            pointerEvents="none"
            className="word"
            fontSize={within ?? (named ? LABEL_SIZE : 10)}
            fontWeight={isEndpoint ? 600 : 400}
            fill={ink}
            // No halo inside the mark: the halo is there to punch a line or a neighbour out
            // from under a name, and inside a disc the only thing under it is the disc — which
            // it is already legible against, and which the halo would put a hole in.
            paintOrder={within !== null ? undefined : 'stroke'}
            stroke={within !== null ? undefined : 'var(--color-noir)'}
            strokeWidth={within !== null ? undefined : '3.5'}
            strokeLinejoin="round"
          >
            {label}
          </text>
        )}

        {/*
          The transcription, on the line immediately under the spelling.

          The two are one label and have to be read as one, so they are set as two lines of it
          rather than as two things at opposite ends of the mark. It was below the mark, which
          put the whole node — fourteen pixels of circle plus its ring — between a word and how
          it is said, and at that distance the eye pairs the transcription with whatever is
          under it instead.

          So it **overlaps the mark**, and that is the trade: the second line crosses the top of
          the circle. It costs nothing, because it is drawn before the hit area and so cannot
          take a click meant for the node — see the note there — and because the mark is a disc
          with nothing written on it.

          Smaller than the spelling and in the same ink: the size is what says which of the two
          lines is the word, and a second colour on top of that read as a footnote rather than
          as the other half of one label.
        */}
        {beneath !== null && (
          <text
            y={beneathY}
            textAnchor="middle"
            pointerEvents="none"
            // `ipa` after `word`, which is what puts it in the face that has the symbols —
            // see `--font-ipa`. SVG takes a class like anything else; what it cannot take is
            // the `<span>` the `<ipa>` message tag renders, which is why this says it here.
            className="word ipa"
            fontSize={9}
            // The same ink as the spelling above it, because the two are one label. Size is
            // what says which line is the word; a second colour on top of that made the
            // transcription read as a footnote to it rather than as the other half of it.
            fill={ink}
            paintOrder="stroke"
            stroke="var(--color-noir)"
            strokeWidth="3"
            strokeLinejoin="round"
          >
            <Said>{beneath}</Said>
          </text>
        )}
      </g>

      {/*
        Hit area sized for thumbs, larger than the drawn mark.

        **Last, so it is on top of both lines of the label.** SVG paints in document order and
        offers a click to whatever is uppermost, so the transcription crossing the mark is
        crossed *by* this in turn and a tap on it reaches the node. The parts of either line
        that overhang the circle are `pointer-events: none`, so they do not swallow a tap
        meant for whatever is behind them either.
      */}
      <circle
        r={Math.max(r + 8, REACH)}
        fill="transparent"
        className="cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label={
          isRevealed
            ? intl.formatMessage(says.reached, { word, selected: String(isSelected) })
            : // The goal is somewhere to stand from the first move, not something to ask
              // about: the moves into it are found by standing there and working backwards.
              isTarget
              ? intl.formatMessage(says.goal, { word, selected: String(isSelected) })
              : onRoute
                ? intl.formatMessage(says.onRoute)
                : !hinted
                  ? intl.formatMessage(says.unhinted)
                  : // Every one of these is about the *spelling*, because every one of them
                    // is about a hint and a hint is always letters — the count a level-1 hint
                    // bought, the letters after it, and the word once they are all bought.
                    // Read out in phonemes it would be a count of sounds and a row of IPA.
                    fullyHinted(word, level, lexicon.label)
                    ? intl.formatMessage(says.spelled, { word: spelling })
                    : // What the next click buys, since that is the decision.
                      intl.formatMessage(says.partly, {
                        count: spelling.length,
                        shown: level >= 2 ? (hintLabel(spelling, level) ?? 'none') : 'none',
                      })
        }
        // Hovering a word lifts every move from it out of the background, so
        // the question "what connects here" can be answered by pointing. Focus
        // does the same, since the board is usable from the keyboard.
        //
        // Every one of these hands the event on, because which word is being
        // pointed at is a question about distance and only the plate can answer
        // it — see `nearest`. `pointermove` as well as `pointerenter`, since two
        // words' reaches overlap and crossing from one to the other need not
        // leave the circle that is receiving the events.
        onPointerEnter={(e) => onHover(word, e)}
        onPointerMove={(e) => onHover(word, e)}
        onPointerLeave={(e) => onUnhover(word, e)}
        onFocus={() => onHover(word, null)}
        onBlur={() => onUnhover(word, null)}
        onClick={(e) => onActivate(word, e)}
        // Dev mode only: read the word without paying a hint for it.
        // Judging whether a puzzle is any good means reading the words around
        // the answer, and a right-click keeps that entirely out of the game —
        // spending hint levels to do it made the tally meaningless.
        onContextMenu={
          onInspect
            ? (e) => {
                e.preventDefault();
                onInspect(word, e);
              }
            : undefined
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate(word, null);
          }
        }}
      />
    </>
  );
});
