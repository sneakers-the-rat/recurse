/**
 * One game's own rules: `/rules/{mode}`.
 *
 * **Not the rules of ReCurse.** Those are `HowTo`, they are true of every game, and they are a
 * dialog over the board because they are read once and dismissed. This page answers the other
 * question — what is different about *this* game — for a player who has understood adding and
 * removing words and not yet understood that a word here is a sound.
 *
 * **A page rather than a panel, because it is a thing to send somebody.** The address carries
 * the mode (`rules/phonemes`), so a link to it opens the same page for whoever receives it,
 * and it does not depend on which board happens to be up. That is also why the mode comes off
 * the URL rather than off the board on screen.
 *
 * **Most games will not have one, and that is the design.** `RULES` below is the list of games
 * with something to say; the letters game is deliberately absent, because a word being its
 * spelling is what everybody already assumes and a page saying so says nothing. A game missing
 * from the list draws no marker on the masthead and, if its page is reached by a stale link,
 * says so in a sentence rather than showing an error.
 *
 * Every word of it is in `i18n/messages/rules.ts`, which is where to write them — what is here
 * is the shape: which paragraph sits under which heading.
 */

import { FormattedMessage, useIntl, type MessageDescriptor } from 'react-intl';
import { gameName } from '../i18n/bands';
import { rules as says } from '../i18n/messages/rules';
import { Close, GameIcon } from './marks';

/**
 * The games with rules of their own, and what those rules say.
 *
 * Keyed on the mode's name as the manifest writes it, the same way `GAME_ICONS` and the
 * translations are — so adding a game means adding a key here and nothing else notices.
 * `hasModeRules` is what the masthead asks before drawing its marker, which is what keeps the
 * marker and the page from ever disagreeing about whether there is anything to read.
 */
interface Section {
  /** Absent on the opening paragraph, which sits under the page's own title. */
  heading?: MessageDescriptor;
  body: MessageDescriptor;
}

interface Rules {
  title: MessageDescriptor;
  sections: Section[];
}

const RULES: Record<string, Rules> = {
  phonemes: {
    title: says.phonemesTitle,
    sections: [
      { body: says.phonemesIntro },
      { heading: says.phonemesTypingTitle, body: says.phonemesTyping },
      { heading: says.phonemesWordsTitle, body: says.phonemesWords },
    ],
  },
};

/** Whether this game has anything of its own to say. See `RULES`. */
export function hasModeRules(mode: string): boolean {
  return mode in RULES;
}

interface Props {
  /** The game these rules are for, named as the manifest names it. Straight off the URL. */
  mode: string;
  onClose: () => void;
}

export function ModeRules({ mode, onClose }: Props) {
  const intl = useIntl();
  const found = RULES[mode];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16">
      <div className="border-rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b py-4">
        <h1 className="text-bone flex items-center gap-2.5 text-2xl font-semibold">
          <GameIcon game={mode} />
          {found ? <FormattedMessage {...found.title} /> : gameName(intl, mode)}
        </h1>
        {/*
          A cross rather than the words, which the archive and the stats screen still use.
          This page is one paragraph read once — it is not somewhere a player navigates
          *within*, so the way out wants to be the smallest thing that unmistakably is one,
          and a line of caps beside a title reads as part of the title. The words are still
          there as the label, because a cross alone says "not this" rather than where it goes.

          Drawn as the same hairline box the masthead's controls are, for the same reason:
          quiet type on this ground does not read as a control until it is in a box.
        */}
        <button
          onClick={onClose}
          title={intl.formatMessage(says.back)}
          aria-label={intl.formatMessage(says.back)}
          className="border-rule text-ash-lit hover:border-gilt-dim hover:text-gilt flex size-7 shrink-0 items-center justify-center border text-lg leading-none transition-colors"
          type="button"
        >
          <Close />
        </button>
      </div>

      {found ? (
        <div className="text-bone-dim mt-6 space-y-4 text-[0.9375rem] leading-relaxed">
          {found.sections.map((section, at) => (
            // The heading's own id would do as a key, and the opening paragraph has no
            // heading — so the position, which is fixed for a given game.
            <div key={at} className="space-y-1.5">
              {section.heading && (
                <h2 className="text-bone mt-6 text-xl font-semibold">
                  <FormattedMessage {...section.heading} />
                </h2>
              )}
              <p>
                <FormattedMessage {...section.body} />
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-bone-dim mt-8 text-sm">
          <FormattedMessage {...says.missing} />
        </p>
      )}
    </div>
  );
}
