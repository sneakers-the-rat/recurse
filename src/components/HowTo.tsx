/**
 * The rules. Worth being precise about, because the central constraint — that
 * the piece you add or remove must itself be a word — is the whole game and is
 * easy to misread as "any letters".
 *
 * And, at the foot of it, the switch for the instrument panel. It is here because this is
 * the only dialog the game has, and because the other two ways in — `?dev` and Ctrl+D —
 * both need hardware a phone does not have, while looking at a real board on a real phone
 * is most of what the panel is for. Set apart below a rule and labelled for what it is, so
 * it reads as the back of the manual rather than as part of the game.
 *
 * Every word of it comes from `i18n/messages/howto.ts`. What is left here is the shape:
 * which rule sits under which heading, and where the figure goes. The inks — `<w>`,
 * `<add>`, `<cut>` — travel inside the messages, so a translator can move a coloured piece
 * to wherever their language puts it.
 */

import { FormattedMessage, useIntl } from 'react-intl';
import { howto as says } from '../i18n/messages/howto';

interface Props {
  minWord: number;
  minSub: number;
  /** Which SCOWL tiers the data was built from, for the word list section. */
  commonScowl: number;
  legalScowl: number;
  devMode: boolean;
  onToggleDev: () => void;
  onClose: () => void;
}

/** The link out to the word list project, and the one down to the section about it. */
const LINKS = {
  scowl: (chunks: React.ReactNode) => (
    <a href="https://wordlist.aspell.net/scowl_v1-readme/">{chunks}</a>
  ),
  wordlists: (chunks: React.ReactNode) => <a href="#wordlists">{chunks}</a>,
};

export function HowTo({
  minWord,
  minSub,
  commonScowl,
  legalScowl,
  devMode,
  onToggleDev,
  onClose,
}: Props) {
  const intl = useIntl();

  return (
    <div
      id="how-to"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="border-rule bg-noir-2 max-h-[85vh] w-full max-w-lg overflow-y-auto border p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="howto-title" className="text-bone mb-1 text-2xl font-semibold">
          <FormattedMessage {...says.title} />
        </h2>

        <div className="text-bone-dim space-y-4 text-[0.9375rem] leading-relaxed">
          <p>
            <span className="text-bone font-bold">
              <FormattedMessage {...says.goal} />
            </span>
          </p>

          <figure className="border-rule bg-noir-3 border p-3">
            <p className="word text-base">
              <FormattedMessage {...says.exampleAdd} />
            </p>
            <p className="word mt-1.5 text-base">
              <FormattedMessage {...says.exampleRemove} />
            </p>
          </figure>

          <h3 className="text-bone mb-1 text-xl font-semibold">
            <FormattedMessage {...says.rules} />
          </h3>
          <ul>
            <li>
              <FormattedMessage {...says.ruleActive} />
            </li>
            <li>
              <FormattedMessage {...says.ruleAddRemove} />
            </li>
            <li>
              <FormattedMessage {...says.ruleValidWord} />
            </li>
            <li>
              <FormattedMessage {...says.ruleContiguous} />
            </li>
            <li>
              <FormattedMessage {...says.ruleRemainder} />
            </li>
            <li>
              <FormattedMessage {...says.rulePosition} />
            </li>
            <li>
              <FormattedMessage {...says.ruleMinWord} values={{ min: minWord }} />
            </li>
            <li>
              <FormattedMessage {...says.ruleMinSub} values={{ min: minSub }} />
            </li>
          </ul>

          <h3 className="text-bone mb-1 text-xl font-semibold">
            <FormattedMessage {...says.graphTitle} />
          </h3>
          <p>
            <FormattedMessage {...says.graphSpine} values={LINKS} />
          </p>
          <p>
            <FormattedMessage {...says.graphAnyWord} />
          </p>

          <h3 className="text-bone mb-1 text-xl font-semibold">
            <FormattedMessage {...says.hintsTitle} />
          </h3>
          <p>
            <FormattedMessage {...says.hintsBody} />
          </p>

          <h3 className="text-bone mb-1 text-xl font-semibold">
            <FormattedMessage {...says.shortcutsTitle} />
          </h3>
          <p>
            <FormattedMessage {...says.shortcutsWhy} />
          </p>
          <p>
            <FormattedMessage {...says.shortcutsWhat} />
          </p>
          <p>
            <FormattedMessage {...says.shortcutsFound} />
          </p>

          <h3 id="wordlists" className="text-bone mb-1 text-xl font-semibold">
            <FormattedMessage {...says.wordListsTitle} />
          </h3>
          <p>
            <FormattedMessage {...says.wordListsIntro} values={LINKS} />
          </p>
          {/*
            The two tiers are read out of the shipped data rather than written down here,
            so the manual cannot disagree with the bank it is describing.
          */}
          <ul>
            <li>
              <FormattedMessage {...says.wordListCommon} values={{ size: commonScowl }} />
            </li>
            <li>
              <FormattedMessage {...says.wordListLegal} values={{ size: legalScowl }} />
            </li>
          </ul>
        </div>

        <button
          onClick={onClose}
          className="label border-rule text-bone hover:border-gilt hover:text-gilt mt-6 w-full border py-2.5 transition-colors"
          type="button"
        >
          <FormattedMessage {...says.begin} />
        </button>

        {/*
          The instruments. Not part of the rules, so it sits under a rule of its own, in the
          quietest ink the palette has — and it says which way it is going rather than what
          it currently is, because a switch that reads "dev mode: off" is ambiguous about
          which half of it is the state and which is the button.
        */}
        <div className="border-rule mt-6 flex items-center justify-between border-t pt-4">
          <p className="label text-ash-lit normal-case">
            <FormattedMessage {...(devMode ? says.devShowing : says.devOffer)} />
          </p>
          <button
            onClick={onToggleDev}
            className="label border-rule text-ash-lit hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
            type="button"
            aria-pressed={devMode}
            aria-label={intl.formatMessage(devMode ? says.devHide : says.devShow)}
          >
            <FormattedMessage {...(devMode ? says.devHide : says.devShow)} />
          </button>
        </div>
      </div>
    </div>
  );
}
