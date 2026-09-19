/**
 * The line across the top of every screen that is a board: the wordmark, whatever the board
 * has to say about itself, and the ways off it.
 *
 * There is more than one game now and they say quite different things about themselves — the
 * daily board says a day number and a length, a map says how much of itself has been found —
 * but the ways off a board are the same four wherever you are, and a masthead that said them
 * twice would be two lists to keep in step. So what a board says about itself is a slot, and
 * the rest is here.
 *
 * **The open game is not one of the four**, and putting it there was the wrong shape twice
 * over: it is a game rather than a page about one, and a fifth destination took the row over
 * its measure so that it wrapped, which is twenty-one pixels of board the player does not get.
 * It is chosen where every other board is chosen — see `Boards`.
 *
 * On a phone the destinations fold into a hamburger, because written out they are two thirds
 * of the width and the row wraps. Both shapes are in the DOM at every width, which is what
 * `masthead()` in e2e/fixtures.ts relies on to take one either way.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { header } from '../i18n/messages/header';
import { Wordmark } from './marks';

/** Where a masthead can take you. Each is a page; see `Page` in route.ts. */
export interface Ways {
  onPuzzles: () => void;
  onStats: () => void;
  onTutorial: () => void;
  onHelp: () => void;
}

/**
 * Shut on Escape, or on a pointer going down anywhere else.
 *
 * `pointerdown` rather than `click`, because a menu left standing behind whatever the
 * player went on to do is worse than one that closes too eagerly — it should be gone
 * before the thing underneath it happens, not after.
 *
 * Every menu in the chrome uses this, and the ref goes on whatever counts as "inside".
 */
export function useDismiss(open: boolean, shut: () => void) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!box.current?.contains(event.target as Node)) shut();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shut();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, shut]);

  return box;
}

/** The chrome a masthead menu is drawn in: a hairline box, gilt when it is open. */
export const CONTROL =
  'label border-rule hover:border-gilt-dim hover:text-gilt flex items-center border px-1.5 py-1 leading-none transition-colors sm:px-2';

/** And the panel each one drops, on the page's own surface rather than the platform's. */
export const PANEL =
  'border-rule bg-noir-2 absolute top-full z-20 mt-1 border shadow-lg shadow-black/50';

/** One choice in such a panel. */
export const CHOICE =
  'label hover:bg-noir-3 w-full px-3 py-2 text-left whitespace-nowrap transition-colors';

/**
 * The ways off this board, on a phone.
 *
 * Three hairlines rather than a `☰`, which is not in either of the two subsets the faces
 * ship and would arrive in whatever the system fell back to. Rules are what this chrome is
 * drawn in anyway.
 */
function Menu(ways: Ways) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const box = useDismiss(
    open,
    useCallback(() => setOpen(false), []),
  );

  const item = (name: string, go: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        go();
      }}
      className={`${CHOICE} text-ash-lit hover:text-bone-dim block`}
    >
      {name}
    </button>
  );

  return (
    <div ref={box} data-tour="menu" className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={intl.formatMessage(header.menu)}
        className={`${CONTROL} justify-center ${
          open ? 'border-gilt-dim text-gilt' : 'text-bone-dim'
        }`}
      >
        {/* As tall as the caps beside it, so the two masthead controls are the same box. */}
        <span aria-hidden className="flex h-[0.6875rem] w-3.5 flex-col justify-between">
          <span className="h-px w-full bg-current" />
          <span className="h-px w-full bg-current" />
          <span className="h-px w-full bg-current" />
        </span>
      </button>

      {open && (
        <div role="menu" aria-label={intl.formatMessage(header.menu)} className={`${PANEL} right-0`}>
          {item(intl.formatMessage(header.puzzles), ways.onPuzzles)}
          {item(intl.formatMessage(header.stats), ways.onStats)}
          {item(intl.formatMessage(header.tutorial), ways.onTutorial)}
          {item(intl.formatMessage(header.howToPlay), ways.onHelp)}
        </div>
      )}
    </div>
  );
}

export function Masthead({
  title,
  lead,
  ways,
}: {
  /**
   * What this board is *called*, inside the heading with the wordmark: a day number, an
   * atlas's name. Part of the heading rather than beside it, because "ReCurse № 12" is one
   * thing to read out and two would be a heading with an orphan next to it.
   */
  title?: ReactNode;
  /** A control that picks among boards, beside the heading. */
  lead?: ReactNode;
  ways: Ways;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2.5 sm:gap-x-4">
      {/*
        Title, then whatever this board is: one line, read left to right, because that is the
        order of the questions — which game, then which board of it. What a board says about
        itself is grouped with the title rather than with the menu, since it is a fact about
        what is on screen and the menu is ways off it.
      */}
      <span className="flex items-center gap-2 sm:gap-3">
        <h1 className="flex items-baseline gap-2">
          <Wordmark />
          {title}
        </h1>
        {lead}
      </span>

      {/* Written out where there is room for them, and behind the button where there is not. */}
      <span className="hidden items-center gap-4 sm:flex">
        <button onClick={ways.onPuzzles} className="label hover:text-gilt transition-colors" type="button">
          <FormattedMessage {...header.puzzles} />
        </button>
        <button onClick={ways.onStats} className="label hover:text-gilt transition-colors" type="button">
          <FormattedMessage {...header.stats} />
        </button>
        <button onClick={ways.onTutorial} className="label hover:text-gilt transition-colors" type="button">
          <FormattedMessage {...header.tutorial} />
        </button>
        <button onClick={ways.onHelp} className="label hover:text-gilt transition-colors" type="button">
          <FormattedMessage {...header.howToPlay} />
        </button>
      </span>
      <Menu {...ways} />
    </div>
  );
}
