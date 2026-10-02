/**
 * One word on a plate: everything about it except where it is.
 *
 * Memoised; the caller positions it on an outer group, so a frame of layout re-renders nothing
 * here. Quietest to loudest:
 *
 *   unrevealed     a small ash dot
 *   on the route   the same dot in gilt: on a shortest path
 *   hinted once    ring holding the letter count
 *   hinted more    the letters asked for, dim, with a dot per letter still unknown
 *   revealed       full circle, filled and labelled, ringed gilt on the route and bone off it
 *   an endpoint    bone, double ring, named from the start
 *   selected       gilt outer ring, where the next guess comes from
 *
 * Size is how much is known about the word, and also its degree on a board that passes
 * `degree`. The daily-only props (`onRoute`, `isSource`, `isTarget`, `onSecret`, `spurs`)
 * default to off.
 *
 * The visible mark is the button. Pointers that miss it go to `surface` in usePointing. Every
 * decoration is `pointer-events: none`, since `pointerenter`/`pointerleave` do not bubble and
 * a decoration over the mark would make the word unhoverable.
 */

import { memo } from 'react';
import { useIntl } from 'react-intl';
import { board as says } from '../../i18n/messages/board';
import { Said } from '../marks';
import { fullyHinted, hintLabel } from '../../lib/hints';
import type { Lexicon } from '../../lib/lexicon';
import { insideLabel, LABEL_CLEAR, LABEL_SIZE, markRadius } from '../../lib/sizes';
import { DOT_R, NODE_R, SPUR_LEN, SPUR_SHOWN_MAX } from './sizes';

/** The parts of a pointer event the plate uses. `buttons` is for `held` in usePointing. */
export type At = {
  clientX: number;
  clientY: number;
  currentTarget: Element;
  buttons?: number;
};

/** How far the selected ring stands off its mark, whatever the mark's size. */
const RING_CLEAR = 5;

/**
 * Moves that lead off the board, drawn as a fan of ticks aimed at `awayFrom`. One tick per
 * doubling, since counts range from a few to over a hundred.
 */
function SpurFan({ count, awayFrom }: { count: number; awayFrom: number }) {
  if (count <= 0) return null;
  const shown = Math.min(Math.round(Math.log2(count)) + 1, SPUR_SHOWN_MAX);
  // Capped so the fan stays clear of the label above the node.
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
    <g aria-hidden pointerEvents="none" opacity="0.9">
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
  standing = false,
  onRoute = false,
  level,
  inspected = false,
  spurs = 0,
  spurAngle = 0,
  onSecret = false,
  refused = false,
  degree = 1,
  showName = true,
  sprouting = false,
  delay = 0,
  grow = 0,
  onHover,
  onUnhover,
  onActivate,
  onInspect,
}: {
  word: string;
  /** Stable per mode, so the memo holds. */
  lexicon: Lexicon;
  isRevealed: boolean;
  isSource?: boolean;
  isTarget?: boolean;
  isSelected: boolean;
  /**
   * Show `isSelected` by filling the mark rather than ringing it. The map sets it; the daily
   * board already uses gilt fill for other things.
   */
  standing?: boolean;
  /** On a shortest route. See App's `hintWord` for what a click on one buys. */
  onRoute?: boolean;
  level: number;
  inspected?: boolean;
  spurs?: number;
  spurAngle?: number;
  onSecret?: boolean;
  refused?: boolean;
  /** Number of moves, drawn as size (`markRadius`). The daily board leaves it at 1. */
  degree?: number;
  /**
   * Whether a name beside the mark is drawn at this zoom (`showsName` in lib/sizes.ts). Passed
   * as a boolean so a zoom re-renders only the words whose answer changes.
   */
  showName?: boolean;
  /**
   * The word grows in, after `delay` over `grow` ms, both from `sprout.ts`. The animation is
   * `.sprout` in index.css.
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
  // Hinting a word promotes it from a dot to a small ring. Past the first hint, or when dev
  // mode has spelled it out, it is labelled above like a named word but dim.
  const spelled = level >= 2 || inspected;
  const named = isRevealed || isEndpoint || spelled;

  // Where you are standing, filled gilt with the name in the background colour. See `standing`.
  const inverted = standing && isSelected;

  const full = markRadius(degree);
  const r = isRevealed || isEndpoint ? full : hinted ? NODE_R - 3 : DOT_R;
  const ring = inverted
    ? 'var(--color-gilt)'
    : isEndpoint
      ? 'var(--color-bone)'
      : onRoute
        ? 'var(--color-gilt)'
        : isRevealed
          ? 'var(--color-bone)'
          : 'var(--color-ash-lit)';
  // A word on a found shortcut, still to be named: gilt, at its usual size.
  const secret = onSecret && !named;
  const fill = inverted
    ? 'var(--color-gilt)'
    : secret
      ? 'var(--color-gilt)'
      : named
        ? 'var(--color-noir-3)'
        : hinted
          ? 'var(--color-noir-2)'
          : onRoute
            ? 'var(--color-gilt-dim)'
            : 'var(--color-ash)';
  const weight = named ? 1.4 : hinted ? 1 : 0.8;
  const presence = inverted || named || secret ? 1 : onRoute ? 0.95 : 0.7;

  // A known word is drawn as its spelling, with its transcription beneath in a translated mode.
  const spelling = lexicon.label(word);
  const known = isRevealed || isTarget || inspected;
  const hint = known || onRoute ? null : hintLabel(spelling, level);

  // Named, or hinted all the way out.
  const whole = known || hint === spelling;
  const label = known ? spelling : hint;
  const beneath = whole && lexicon.translated ? lexicon.transcribe(word) : null;
  // A name that fits inside its mark goes inside it (`insideLabel`) and is never hidden; a name
  // beside it is hidden when `showName` is false.
  const within = known ? insideLabel(spelling.length, r) : null;
  const hidden = within === null && !showName;
  const labelY = within !== null ? 0 : named ? -r - LABEL_CLEAR : 3.5;
  const beneathY = within !== null ? r + within * 0.85 : labelY + 9.5;

  // Dev-mode names are dim. The inverted ink applies only to a name inside the mark; one beside
  // it lies on the background, where that colour would be invisible.
  const ink =
    inverted && within !== null
      ? 'var(--color-noir)'
      : spelled && !isRevealed
        ? 'var(--color-bone-dim)'
        : named
          ? 'var(--color-bone)'
          : 'var(--color-bone-dim)';

  return (
    <>
      {/*
        Its own group, inside the positioning one, because the animation's CSS transform would
        replace a `transform` attribute on the same element.
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
        {isRevealed && <SpurFan count={spurs} awayFrom={spurAngle} />}

        {/* Clear of the mark's stroke, half of which lies outside `r`. */}
        {isSelected && (
          <circle
            r={r + RING_CLEAR}
            fill="none"
            pointerEvents="none"
            stroke="var(--color-gilt)"
            strokeWidth="1"
            opacity={inverted ? 1 : 0.75}
          />
        )}

        {/* The mark, which is also the button. */}
        <circle
          r={r}
          fill={fill}
          stroke={secret ? 'var(--color-gilt)' : ring}
          strokeWidth={secret ? 1.2 : weight}
          opacity={presence}
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label={
            isRevealed
              ? intl.formatMessage(says.reached, { word, selected: String(isSelected) })
              : // The goal can be stood on from the start, so it is never hinted.
                isTarget
                ? intl.formatMessage(says.goal, { word, selected: String(isSelected) })
                : onRoute
                  ? intl.formatMessage(says.onRoute)
                  : !hinted
                    ? intl.formatMessage(says.unhinted)
                    : // Hints are always letters, so these read the spelling.
                      fullyHinted(word, level, lexicon.label)
                      ? intl.formatMessage(says.spelled, { word: spelling })
                      : // What the next click buys, since that is the decision.
                        intl.formatMessage(says.partly, {
                          count: spelling.length,
                          shown: level >= 2 ? (hintLabel(spelling, level) ?? 'none') : 'none',
                        })
          }
          // Hover or focus highlights the word's moves. The event is passed on so `nearest` in
          // usePointing can decide which word is meant; `pointermove` too, because inside a
          // big mark that answer can change without leaving it.
          onPointerEnter={(e) => onHover(word, e)}
          onPointerMove={(e) => onHover(word, e)}
          onPointerLeave={(e) => onUnhover(word, e)}
          onFocus={() => onHover(word, null)}
          onBlur={() => onUnhover(word, null)}
          onClick={(e) => onActivate(word, e)}
          // Dev mode only: reveal the word without counting a hint.
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

        {/* A refused hint: a cross over the mark that fades out (`.crossed` in index.css). */}
        {refused && (
          <g className="crossed" aria-hidden pointerEvents="none">
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
            pointerEvents="none"
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
            pointerEvents="none"
            fill="var(--color-gilt)"
          />
        )}

        {label !== null && !hidden && (
          <text
            y={labelY}
            textAnchor="middle"
            dominantBaseline={within !== null ? 'central' : undefined}
            pointerEvents="none"
            className="word"
            fontSize={within ?? (named ? LABEL_SIZE : 10)}
            fontWeight={isEndpoint ? 600 : 400}
            fill={ink}
            // No halo inside the mark; there is nothing under it but the disc.
            paintOrder={within !== null ? undefined : 'stroke'}
            stroke={within !== null ? undefined : 'var(--color-noir)'}
            strokeWidth={within !== null ? undefined : '3.5'}
            strokeLinejoin="round"
          >
            {label}
          </text>
        )}

        {beneath !== null && !hidden && (
          <text
            y={beneathY}
            textAnchor="middle"
            pointerEvents="none"
            // `ipa` sets the IPA font, since SVG cannot hold the `<span>` the `<ipa>` tag renders.
            className="word ipa"
            fontSize={9}
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

    </>
  );
});
