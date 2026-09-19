/**
 * Masthead and the puzzle statement.
 *
 * The day number is the only number here that is decoration-adjacent, and it
 * earns its place: it is the real puzzle index, the thing a share string will
 * quote, and how players talk about a daily game.
 *
 * Memoised, like every other component App renders beside the plate. The board's
 * layout re-renders App on every frame it is moving, and the header has nothing to
 * do with any of them: it was being rebuilt eighty-odd times per guess to arrive at
 * the same two words and the same two numbers.
 */

import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { FormattedMessage, useIntl, type MessageDescriptor } from 'react-intl';
import { bandName, boardName, gameName } from '../i18n/bands';
import { header } from '../i18n/messages/header';
import { rules as rulesSays } from '../i18n/messages/rules';
import { Diamond, Query } from './marks';
import { Boards, type Band, type Playing } from './Boards';
import { Masthead, type Ways } from './Masthead';

/** One row of the tally: what it is called, the number, and how to say the name. */
interface Row {
  /**
   * A stable handle for the row, which is what a test asks for.
   *
   * The label is language and moves with the catalog; the figure beside it is the thing worth
   * asserting on. `tally()` in e2e/fixtures.ts is the other half — before this, a spec read the
   * whole header as one string and matched "1 guessed", which is a claim about the *phrasing*
   * of a message and broke the moment the line became a table.
   */
  name: string;
  label: MessageDescriptor;
  /** For the label's own agreement, where its language has any: "1 hint", "2 hints". */
  count: number;
  value: number;
  /** Ink for the figure, where it is saying something. Bone unless given. */
  tone?: string;
}

/**
 * One column of the tally: labels down the left edge, figures down the right.
 *
 * A definition list because that is what it is — each row is a term and its value — and the
 * pairs are wrapped in a `div` apiece, which is the one way HTML allows a `dl` to be laid out
 * in rows without the grouping being a lie about the markup.
 */
function Tally({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="flex flex-col gap-y-0.5">
      {rows.map((row) => (
        <div key={row.name} className="flex items-baseline justify-between gap-x-4">
          <dt className="text-ash-lit">
            <FormattedMessage {...row.label} values={{ count: row.count }} />
          </dt>
          <dd data-tally={row.name} className={`tabular-nums ${row.tone ?? 'text-bone'}`}>
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface Props {
  source: string;
  target: string;
  par: number;
  /**
   * How many ways through there are that are *shorter* than par, which exist because a rarer
   * word cuts a corner. Said out loud from the start: that a shortcut exists is the hook, and
   * which words it runs through is the puzzle. Zero on most boards, and then not shown.
   */
  shortcuts?: number;
  /**
   * Every board a day offers — both games' three lengths — and which one is on screen.
   *
   * From the manifest, so what each holds is that mode's own `bandCuts` rather than anything
   * decided here. The switch is the only way between them on a phone: the band is
   * deliberately not in the URL — a board is addressed by its id and nothing else.
   */
  bands: readonly Band[];
  /** The games those bands belong to, in the manifest's order. */
  games: readonly { name: string }[];
  /**
   * The game this board is of, named as the manifest names it — or null when that game has
   * nothing of its own to say, which is the letters game and every game like it.
   *
   * Null rather than a second boolean prop, because "which game" and "is it worth a marker"
   * are one question: the marker names the game, and there is nothing to name it for. App
   * asks `hasModeRules`, which is the same list the page itself reads.
   */
  game: string | null;
  /** To that game's rules page. See `ModeRules`. */
  onModeRules: () => void;
  /** Which board is on screen, for the switch. See `Boards`. */
  at: Playing;
  onPlay: (wanted: Playing) => void;
  day: number;
  guesses: number;
  /** Hints asked for. Shown beside the guesses: it is the other half of a score. */
  hints: number;
  /**
   * The opening card is showing the statement, so this one waits its turn — the card
   * ends up here, and two copies of the same two words fading past each other reads as
   * a glitch rather than a hand-off.
   */
  quiet?: boolean;
  /**
   * The round is over. Said in the chrome as well as in the result panel, so a board
   * you come back to is visibly a board you have already played before you have read a
   * word of it.
   */
  finished?: boolean;
  /** And they beat par, which is the one outcome louder than finishing. */
  beatPar?: boolean;
  /**
   * Put a link to this board, as it stands, on the clipboard — or absent, and then no button.
   *
   * **A thing done to this board, not a way off it**, so it lives in the tally: that row is
   * what the board's state is said in, and a link that carries the state belongs beside the
   * figures describing it. It is deliberately not among the four destinations, which fold into
   * the hamburger on a phone — a share that costs opening a menu first is a share nobody makes.
   *
   * Absent on somebody else's board. The round on screen is not this player's to hand on, and
   * `SharedBoard` already offers the one thing there is to do with it.
   *
   * Copying is App's, not this component's: the header renders, and where a receipt is said is
   * a question about the screen rather than about the masthead. See `shareBoard` there.
   */
  onShare?: (() => void) | undefined;
  /** The ways off this board, which are the same five wherever you are. See `Masthead`. */
  ways: Ways;
}

export const Header = memo(function Header({
  source,
  target,
  par,
  shortcuts = 0,
  bands,
  games,
  game,
  onModeRules,
  at,
  onPlay,
  day,
  guesses,
  hints,
  quiet = false,
  finished = false,
  beatPar = false,
  onShare,
  ways,
}: Props) {
  const intl = useIntl();

  /**
   * The bar's own colour, which is a statement about the round rather than decoration.
   *
   * Gilt, because gilt is what this game means by *arrived* — letters arriving, a word on
   * the route, a secret found. Dim gilt for a round finished, full gilt for one that beat
   * par, and the ordinary rule while there is still playing to do. Nothing else changes:
   * the two words and the tally are the same two words and the same tally.
   */
  const rule = finished ? (beatPar ? 'border-gilt' : 'border-gilt-dim') : 'border-rule';

  return (
    <header data-tour="masthead" className={`border-b ${rule} ${finished ? 'bg-noir-2' : ''}`}>
      <Masthead
        title={
          <span className="label text-ash-lit">
            <FormattedMessage {...header.day} values={{ day }} />
          </span>
        }
        lead={<Boards bands={bands} games={games} at={at} onPlay={onPlay} />}
        ways={ways}
      />

      {/* The statement, set like a Deco title page: rule, line, rule. */}
      {/*
        Out at once, back in slowly. The card is the same two words in the same place, so
        a *fade* out means both are on screen together for a moment, which reads as a
        glitch; coming back is the hand-off and wants the time.
      */}
      <div
        className={`border-t ${rule} transition-opacity ${
          quiet ? 'opacity-0 duration-0' : 'opacity-100 duration-700'
        }`}
      >
        <div className="mx-auto max-w-2xl px-4 py-4 text-center">
          {/*
            The size on this line is the ceiling, not the size: `.statement` in index.css
            shrinks the two words from here until the longer of them fits the measure on
            one line, which the longest words in the bank do not do at 3xl on a phone.
            Hence `--chars`, which is all that rule needs to know about them.
          */}
          <p
            data-tour="statement"
            className="statement flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-2xl sm:text-3xl"
            style={{ '--chars': Math.max(source.length, target.length) } as CSSProperties}
          >
            <span className="word text-bone">{source}</span>
            <Diamond />
            <span className="word text-bone">{target}</span>
          </p>
          {/*
            Which game this is, spelled out, and the way to what makes it different.

            Only for a game that *has* rules of its own — see `hasModeRules`. The letters game
            has none, on purpose: a word being its spelling is what everyone assumes, and a
            marker pointing at a page that says so is a marker pointing at nothing. So this is
            not a fixture of the header; it is the header saying that there is something here
            worth knowing, and it is absent whenever there is not.

            **The whole marker is the link, `?` and all.** The words name the thing there is
            something to read about, so they are the thing to click: a `?` that was the only
            live part of the phrase left the phrase itself looking like a caption with a button
            stuck to it, and made the target one small circle. The ring is still drawn, because
            a wavy underline says "there is a note on this" and the `?` says what kind of note,
            but it is a mark inside the link rather than a control beside it.

            **It brightens on hover, text and squiggle together**, which is the only thing that
            says "link" here — there is no other underlined text on this screen and nothing else
            to compare it to. Both from the button, so they cannot get out of step.

            The squiggle has to be `decoration-*` utilities rather than a border: an underline
            follows the text across a line break and a border draws a box round it. It is on the
            words alone, and the ring is outside that span — a wavy line under a circle reads as
            a mistake.

            Between the two words and the tally because that is the reading order — what the
            puzzle is, what game it is played by, how it is scored.
          */}
          {game !== null && (
            <p className="label mt-2 flex items-center justify-center">
              <button
                type="button"
                onClick={onModeRules}
                // The tooltip says what it opens; the accessible name is the visible phrase,
                // which is what a player would say out loud to ask for it.
                title={intl.formatMessage(rulesSays.open, { game: gameName(intl, game) })}
                // `uppercase` restated: the caps come from `.label` on the paragraph, and
                // Tailwind's preflight resets `text-transform` on a button — so the phrase
                // came out in sentence case in the middle of a line of small caps.
                //
                // The same ink as the tally at rest, brighter on hover. Dimmer than the
                // caption around it would be a link that recedes, which is backwards.
                className="group text-bone-dim hover:text-bone flex items-center gap-1.5 uppercase transition-colors"
              >
                <span className="decoration-gilt-dim group-hover:decoration-gilt underline decoration-wavy underline-offset-4 transition-colors">
                  <FormattedMessage
                    {...rulesSays.marker}
                    values={{ game: gameName(intl, game) }}
                  />
                </span>
                {/*
                  `tracking-normal` because the caps around it are letter-spaced, and letter
                  spacing is added *after* each glyph — so a `?` centred in a flex box sat half
                  a letter-space left of the middle of its own ring.
                */}
                <span
                  aria-hidden
                  className="border-rule group-hover:border-gilt-dim group-hover:text-gilt flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.625rem] leading-none tracking-normal transition-colors"
                >
                  <Query />
                </span>
              </button>
            </p>
          )}
          {/*
            The tally, as a table rather than a sentence.

            Two kinds of number are being said and they are not the same kind: **the puzzle's
            own figures** on the left, fixed before anybody arrived, and **the player's** in the
            middle, which move with every guess. Run together on one line separated by dots they
            read as one list of four, and the reader has to know which is which to make sense of
            any of it. In columns the distinction is the layout's to carry.

            Values on their own right edge, so the digits line up under each other and a score
            can be read at a glance rather than found in a sentence. Labels stay left for the
            same reason — the eye runs down the words on one edge and the figures on the other.

            Sharing goes in a column of its own, which is the answer to it having sat in the
            masthead line beside the length switch: this is the row about the state of the board,
            and a link that carries the board is a thing to do with that state. It is narrow
            because it is one control against two columns of figures.
          */}
          <div
            data-tour="tally"
            className="label mx-auto mt-2.5 flex max-w-md items-start justify-center gap-x-8 gap-y-1 text-left"
          >
            <Tally
              rows={[
                { name: 'par', label: header.par, count: par, value: par },
                // The board's own promise, and the one figure here that is gilt: that a shorter
                // way exists is the hook of the puzzle. Absent when there is none.
                ...(shortcuts > 0
                  ? [
                      {
                        name: 'shortcuts',
                        label: header.shortcuts,
                        count: shortcuts,
                        value: shortcuts,
                        tone: 'text-gilt-dim',
                      },
                    ]
                  : []),
              ]}
            />
            <Tally
              rows={[
                { name: 'guessed', label: header.guesses, count: guesses, value: guesses },
                // Only once any have been asked for: a nought here would read as a score to
                // protect, and hints are not something to be stingy with.
                ...(hints > 0
                  ? [{ name: 'hints', label: header.hints, count: hints, value: hints }]
                  : []),
              ]}
            />
            {onShare && (
              <button
                type="button"
                onClick={onShare}
                className="label text-bone-dim hover:text-gilt shrink-0 underline decoration-dotted underline-offset-4 transition-colors"
              >
                <FormattedMessage {...header.shareBoard} />
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});
