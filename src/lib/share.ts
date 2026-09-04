/**
 * The thing a player pastes somewhere after a round.
 *
 * Four lines, and every one of them is answering a question somebody asked about a
 * score they were sent:
 *
 *     ReCurse Words · Day 3 · short · 2026-07-29   which puzzle, and when
 *     5 guesses · par 4 · 2 hints            how it went
 *     🟨🟨🟩🟥🟨                              the shape of the route taken
 *     https://…/recurse/2ed94464             where to go and try it
 *
 * The emoji are the interesting part. One per guess, in the order they were made:
 *
 *     ⭐ star   — a word on a shortcut: a way through shorter than par
 *     🟨 gold   — a word on a shortest route: dead on the line
 *     🟩 green  — a word on the board but not on a shortest route: an alternative
 *     🟥 red    — any other word: off exploring
 *
 * Which means the trail reads as a story — a run of gold is someone who saw it, a
 * red then gold is someone who went wandering and came back, a star is someone who
 * found a corner nobody expected to be cut — without naming a single word, so
 * nothing here spoils the puzzle for whoever reads it.
 *
 * "The board" is the board **as first drawn**, never as it ended up. The board grows
 * to follow a player who strays (see plate.ts), so judging against the final one
 * would quietly turn their own detours into "alternatives that were always there"
 * and nothing would ever come out red.
 *
 * The text is deliberately built from plain data rather than from `GameState`: the
 * completed view renders it, a test asserts on it, and neither should have to build
 * a game to ask what a share string looks like.
 *
 * **It is translated, and it takes a `Phrasebook` to do it.** A player reading the game in
 * another language pastes that language. This module has no React in it and is tested in
 * node, so the words arrive as a parameter rather than out of a hook: a component hands it
 * the `intl` it already has, a test hands it one built by `createIntl`. The marks and the
 * link are the same in every language, so a trail still reads across a mixed thread.
 */

import type { Phrasebook } from '../i18n/format';
import { round as says } from '../i18n/messages/round';

/** What a guessed word was, in relation to the answer. */
export type Mark = 'shortcut' | 'route' | 'alternate' | 'stray';

const EMOJI: Record<Mark, string> = {
  shortcut: '⭐',
  route: '🟨',
  alternate: '🟩',
  stray: '🟥',
};

/**
 * Which mark each guessed word earns.
 *
 * Strongest fact first, because a word can be several of these at once. A word on a
 * shortcut is a star even when it is also on the board, and a word on a shortest route
 * beats an alternative — every node on a shortest route is also a node on the board.
 *
 * `shortcut` is the words of a route shorter than par: the whole of it, not only the rare
 * word that made it possible, because the shortcut is the line and not one step on it.
 * Endpoints are excluded by the caller, being on every way through.
 */
export function markGuesses(
  words: readonly string[],
  routeNodes: ReadonlySet<string>,
  boardNodes: ReadonlySet<string>,
  shortcutNodes: ReadonlySet<string> = new Set(),
): Mark[] {
  return words.map((word) =>
    shortcutNodes.has(word)
      ? 'shortcut'
      : routeNodes.has(word)
        ? 'route'
        : boardNodes.has(word)
          ? 'alternate'
          : 'stray',
  );
}

export function emojiTrail(marks: readonly Mark[]): string {
  return marks.map((mark) => EMOJI[mark]).join('');
}

export interface Result {
  /** Days since the epoch: what the game calls this puzzle. */
  day: number;
  /**
   * Which of the day's three lengths this was — "short", "medium", "long".
   *
   * Named, because a day offers three and a score without it cannot be placed: two people
   * posting "Day 42 · 6 guesses" may not have played the same board at all.
   */
  band: string;
  /** That day's date, `YYYY-MM-DD`. See `dateForDay`. */
  date: string;
  guesses: number;
  par: number;
  hints: number;
  marks: readonly Mark[];
  /** The whole link, as `shareUrl` builds it. */
  url: string;
}

/**
 * The score line.
 *
 * Beating par gets said out loud, because it is the best thing that can happen in a
 * round: par is the best route through ordinary words, so going under it means a
 * rarer word cut a corner nobody expected to be cut.
 */
function scoreLine(intl: Phrasebook, { guesses, par, hints }: Result): string {
  return intl.formatMessage(says.shareScore, {
    guesses,
    par,
    hints,
    under: String(guesses < par),
  });
}

/** The whole thing, ready for a clipboard. */
export function shareText(intl: Phrasebook, result: Result): string {
  const lines = [
    intl.formatMessage(says.shareTitle, {
      day: result.day,
      band: result.band,
      date: result.date,
    }),
    scoreLine(intl, result),
    emojiTrail(result.marks),
    result.url,
  ];
  // A round solved in nothing but the two words it started with has no trail; an
  // empty line in the middle of a paste reads as something having gone wrong.
  return lines.filter((line) => line.length > 0).join('\n');
}
