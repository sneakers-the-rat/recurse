/** `/explore`: the maps this browser holds, and a form to start another from a word. */

import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { gameName } from '../i18n/bands';
import { explore as says } from '../i18n/messages/explore';
import { Masthead, type Ways } from './Masthead';
import type { AtlasCard } from '../lib/atlasStore';
import { dailyGames, type RawManifest } from '../lib/data';

interface Props {
  manifest: RawManifest;
  cards: readonly AtlasCard[];
  /** The game to preselect in the form, when the path named one with no map yet. */
  game: string | null;
  /** Why the last attempt to start a map was refused, as text. */
  refusal: string | null;
  ways: Ways;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** Start a map of `game` (a game's name, not its map's graph; see `mapMode` in data.ts). */
  onStart: (game: string, word: string) => void;
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
  // Games only: the explore graphs are modes too, but not games of their own.
  const games = dailyGames(manifest);
  const [mode, setMode] = useState(
    () => games.find((one) => one.name === game)?.name ?? games[0]?.name ?? '',
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
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
              className="border-rule bg-noir-2 text-bone border px-2 py-1"
            >
              {games.map((one) => (
                <option key={one.name} value={one.name}>
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
