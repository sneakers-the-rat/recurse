/**
 * The maps this browser holds, and how to start another.
 *
 * Deliberately not an archive. `/puzzles` lists boards the *game* has made and offers dates to
 * open; this lists boards the *player* has made and has no dates in it at all — a map is a
 * thing you come back to rather than a thing that came round.
 *
 * A new map is a word and a game, in that order, because the word is the decision: the game
 * only says which alphabet the word will be read in.
 */

import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { gameName } from '../i18n/bands';
import { explore as says } from '../i18n/messages/explore';
import { Masthead, type Ways } from './Masthead';
import type { AtlasCard } from '../lib/atlasStore';
import type { RawManifest } from '../lib/data';

interface Props {
  manifest: RawManifest;
  cards: readonly AtlasCard[];
  /**
   * Which game to be ready to make one of, when the path asked for a game with no map yet.
   * Null when the list was simply opened.
   */
  game: string | null;
  /** A refusal from the last attempt to start one, already said. */
  refusal: string | null;
  ways: Ways;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onStart: (mode: number, word: string) => void;
}

export function Atlases({
  manifest,
  cards,
  game,
  refusal,
  ways,
  onOpen,
  onRemove,
  onRename,
  onStart,
}: Props) {
  const intl = useIntl();
  // Whichever game was asked for, when one was: arriving from the switch with no letters map
  // means the next thing you do is make one, so the form is already set to make it.
  const [mode, setMode] = useState(() =>
    Math.max(0, manifest.modes.findIndex((one) => one.name === game)),
  );
  const [word, setWord] = useState('');

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-rule border-b">
        <Masthead ways={ways} />
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <h2 className="label text-bone text-lg">
          <FormattedMessage {...says.title} />
        </h2>
        <p className="text-ash-lit mt-2 max-w-prose text-sm">
          <FormattedMessage {...says.blurb} />
        </p>

        <form
          className="border-rule mt-6 flex flex-wrap items-end gap-3 border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (word.trim() === '') return;
            onStart(mode, word);
            setWord('');
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="label text-ash-lit">
              <FormattedMessage {...says.which} />
            </span>
            {/*
              A native select, which the length switch on the masthead deliberately is not —
              the argument there is that a menu arriving in the platform's own type sits badly
              in the middle of a Deco masthead. This is a form on a page of forms, and the
              platform's control is the right one here.
            */}
            <select
              value={mode}
              onChange={(event) => setMode(Number(event.target.value))}
              className="border-rule bg-noir-2 text-bone border px-2 py-1"
            >
              {manifest.modes.map((one, index) => (
                <option key={one.name} value={index}>
                  {gameName(intl, one.name)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="label text-ash-lit">
              <FormattedMessage {...says.startFrom} />
            </span>
            <input
              value={word}
              onChange={(event) => setWord(event.target.value)}
              placeholder={intl.formatMessage(says.startHint)}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={refusal !== null}
              className={`word border bg-transparent px-2 py-1 ${
                refusal ? 'border-blood-lit' : 'border-rule'
              }`}
            />
          </label>

          <button
            type="submit"
            disabled={word.trim() === ''}
            className="label border-rule hover:border-gilt-dim hover:text-gilt border px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <FormattedMessage {...says.begin} />
          </button>

          <p className="text-blood-lit basis-full text-sm" role="status" aria-live="polite">
            {refusal}
          </p>
        </form>

        <ul className="mt-6 flex flex-col gap-2">
          {cards.length === 0 && (
            <li className="text-ash-lit text-sm">
              <FormattedMessage {...says.noMaps} />
            </li>
          )}
          {cards.map((card) => (
            <li
              key={card.id}
              className="border-rule hover:border-gilt-dim flex flex-wrap items-baseline gap-x-4 gap-y-1 border p-3 transition-colors"
            >
              <button
                type="button"
                onClick={() => onOpen(card.id)}
                className="word text-bone hover:text-gilt text-lg transition-colors"
              >
                {card.name}
              </button>
              <span className="label text-ash-lit">{gameName(intl, card.mode)}</span>
              <span className="label text-ash-lit">
                <FormattedMessage
                  {...says.held}
                  values={{ found: card.found, regions: card.regions }}
                />
              </span>
              {/* ISO, like every other date here: it is an address as much as a caption. */}
              <span className="label text-ash-lit">
                <FormattedMessage {...says.touched} values={{ date: card.touched }} />
              </span>
              <span className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    const wanted = window.prompt(intl.formatMessage(says.rename), card.name);
                    if (wanted !== null && wanted.trim() !== '') onRename(card.id, wanted.trim());
                  }}
                  className="label text-ash-lit hover:text-bone transition-colors"
                >
                  <FormattedMessage {...says.rename} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(intl.formatMessage(says.reallyRemove, { name: card.name })))
                      onRemove(card.id);
                  }}
                  className="label text-ash-lit hover:text-blood-lit transition-colors"
                >
                  <FormattedMessage {...says.remove} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
