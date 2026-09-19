/**
 * The low score screen: how this round did against everybody else's, on this puzzle.
 *
 * **Below the board, beside the round.** The result strip above the plate is held to three short
 * rows on a phone for a reason — every pixel there is a pixel off the figure — so a table that
 * wants five or six lines belongs in the part of the page that scrolls. See Completed.tsx, which
 * is the argument in full.
 *
 * **It is a low score screen**, because in this game the number is a cost. Nothing here calls a
 * score high, and the heading says the direction so that the rest of the table can be plain.
 *
 * **A missing board is a quiet line and never a warning.** The server is optional, the round is
 * already safe on the player's own device, and something that looked like an error would be
 * saying the wrong thing about a puzzle they just solved. Where there is no server at all this
 * renders nothing whatsoever.
 *
 * It renders and does nothing else: `useServer` sends the round, mints the player and fetches
 * the board. See lib/useServer.ts.
 */

import { memo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { NAME_MAX, NAME_MIN, PASSWORD_MIN, type Score } from '../lib/api';
import type { Served, Standing } from '../lib/useServer';
import type { Why } from '../lib/server';
import { scores as says } from '../i18n/messages/scores';

/** What to say about a refusal. Everything unremarkable falls to one sentence. */
function refusalOf(why: Why | 'invalid') {
  switch (why) {
    case 'taken':
      return says.taken;
    case 'credentials':
      return says.wrong;
    case 'invalid':
      return says.invalid;
    case 'slow-down':
      return says.tooFast;
    default:
      return says.wentWrong;
  }
}

/**
 * One row.
 *
 * The player's own is marked rather than moved: it is in rank order like everything else, and a
 * row pulled out of its place would be a different claim about where they came.
 */
const Row = memo(function Row({ score, mine }: { score: Score; mine: boolean }) {
  return (
    <tr className={mine ? 'text-gilt' : 'text-bone-dim'}>
      <td className="label py-1 pr-3 text-right tabular-nums">{score.rank}</td>
      <td className="word py-1 pr-3 text-sm">
        {score.player.name ?? (
          <span className="text-ash-lit italic">
            <FormattedMessage {...says.anonymous} />
          </span>
        )}
        {mine && (
          <span className="label text-gilt-dim ml-2">
            <FormattedMessage {...says.you} />
          </span>
        )}
      </td>
      <td className="py-1 pr-3 text-right tabular-nums">{score.guesses}</td>
      <td className="text-ash-lit py-1 text-right tabular-nums">{score.hints}</td>
    </tr>
  );
});

/**
 * Choosing a name, or coming back as one.
 *
 * One form for both, because they take the same two fields and differ only in which button is
 * pressed — and a player who does not remember whether they have an account here should not have
 * to decide before typing.
 *
 * Both warnings are shown rather than hidden behind a link: that registering keeps the history
 * already played is the reassurance somebody needs *before* they commit, and that there is no
 * password reset is the thing they will wish they had been told.
 */
function NameForm({
  signIn,
  onDone,
}: {
  signIn: Served['signIn'];
  onDone: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [refusal, setRefusal] = useState<Why | 'invalid' | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(kind: 'register' | 'login') {
    setBusy(true);
    setRefusal(null);
    const why = await signIn(kind, { username, password });
    setBusy(false);
    if (why === null) onDone();
    else setRefusal(why);
  }

  const field =
    'word bg-noir-3 border-rule text-bone focus:border-gilt w-full border px-2 py-1.5 text-sm outline-none transition-colors';
  const button =
    'label border-rule text-bone-dim hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors disabled:opacity-50';

  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send('register');
      }}
    >
      <div className="flex flex-wrap gap-2">
        <label className="min-w-40 flex-1">
          <span className="label text-ash-lit block">
            <FormattedMessage {...says.username} />
          </span>
          <input
            className={field}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            maxLength={NAME_MAX}
            spellCheck={false}
          />
        </label>
        <label className="min-w-40 flex-1">
          <span className="label text-ash-lit block">
            <FormattedMessage {...says.password} />
          </span>
          <input
            className={field}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
      </div>

      <p className="label text-ash-lit">
        <FormattedMessage
          {...says.rules}
          values={{ min: NAME_MIN, max: NAME_MAX, least: PASSWORD_MIN }}
        />
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={`${button} border-gilt-dim text-bone`} disabled={busy}>
          <FormattedMessage {...says.join} />
        </button>
        <button type="button" className={button} disabled={busy} onClick={() => void send('login')}>
          <FormattedMessage {...says.comeBack} />
        </button>
        <button type="button" className={button} onClick={onDone}>
          <FormattedMessage {...says.cancel} />
        </button>
      </div>

      {refusal !== null && (
        <p className="label text-blood-lit" role="alert">
          <FormattedMessage {...refusalOf(refusal)} />
        </p>
      )}

      <p className="label text-ash-lit">
        <FormattedMessage {...says.keepsHistory} />
      </p>
      <p className="label text-ash-lit">
        <FormattedMessage {...says.noReset} />
      </p>
    </form>
  );
}

export const HighScores = memo(function HighScores({
  standing,
  me,
  signIn,
  signOut,
}: {
  standing: Standing;
  me: Served['me'];
  signIn: Served['signIn'];
  signOut: Served['signOut'];
}) {
  const intl = useIntl();
  const [naming, setNaming] = useState(false);

  // No server in this build: not a panel that is empty, a panel that does not exist. A copy of
  // the game somebody downloaded has no business drawing a space where a scoreboard would go.
  if (standing.state === 'off') return null;

  return (
    <section
      aria-label={intl.formatMessage(says.heading)}
      className="border-rule bg-noir-2/40 border-t px-4 py-4"
    >
      <div className="mx-auto max-w-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="label">
            <FormattedMessage {...says.heading} />
          </h3>
          {standing.state === 'ready' && standing.board.players > standing.board.scores.length && (
            <p className="label text-ash-lit">
              <FormattedMessage {...says.players} values={{ count: standing.board.players }} />
            </p>
          )}
        </div>

        {standing.state === 'waiting' && (
          <p className="label text-ash-lit mt-2">
            <FormattedMessage {...says.waiting} />
          </p>
        )}

        {standing.state === 'absent' && (
          <p className="label text-ash-lit mt-2">
            <FormattedMessage {...says.offline} />
          </p>
        )}

        {standing.state === 'ready' && <Board standing={standing} me={me} />}

        {/*
          Who the scores are going down under, and the way to change it.

          Worth saying even before anybody registers: "anonymous" on the table above is a fact
          about this browser rather than about the game, and a player who does not know that
          cannot decide to do anything about it.
        */}
        <div className="border-rule mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-2">
          <p className="label text-ash-lit">
            {me?.name ? (
              <FormattedMessage
                {...says.playingAs}
                values={{
                  // Out of the letter-spaced caps the rest of this line is set in. A username is
                  // case-sensitive and stored exactly as typed, so a line that shouted it back
                  // would be showing the player a name that is not theirs.
                  name: (
                    <span className="word text-bone-dim text-sm tracking-normal normal-case">
                      {me.name}
                    </span>
                  ),
                }}
              />
            ) : (
              <FormattedMessage {...says.playingAnonymously} />
            )}
          </p>
          {me?.name ? (
            <button
              type="button"
              onClick={signOut}
              className="label text-bone-dim hover:text-gilt underline decoration-dotted underline-offset-4 transition-colors"
            >
              <FormattedMessage {...says.signOut} />
            </button>
          ) : (
            !naming && (
              <button
                type="button"
                onClick={() => setNaming(true)}
                className="label text-bone-dim hover:text-gilt underline decoration-dotted underline-offset-4 transition-colors"
              >
                <FormattedMessage {...says.takeAName} />
              </button>
            )
          )}
        </div>

        {naming && !me?.name && <NameForm signIn={signIn} onDone={() => setNaming(false)} />}
      </div>
    </section>
  );
});

/**
 * The table, and the player's own row under it when it is not in it.
 *
 * A board somebody is not on is a board about other people, so the rank is repeated below the
 * fold rather than left to be inferred from a count.
 */
function Board({ standing, me }: { standing: Extract<Standing, { state: 'ready' }>; me: Served['me'] }) {
  const { board } = standing;
  const mine = board.you;
  const shown = new Set(board.scores.map((one) => one.player.id));

  if (board.scores.length === 0) {
    return (
      <p className="label text-ash-lit mt-2">
        <FormattedMessage {...says.nobody} />
      </p>
    );
  }

  return (
    <>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="label text-ash-lit">
            <th className="pr-3 text-right font-normal">
              <FormattedMessage {...says.rank} />
            </th>
            <th className="pr-3 text-left font-normal">
              <FormattedMessage {...says.player} />
            </th>
            <th className="pr-3 text-right font-normal">
              <FormattedMessage {...says.guesses} />
            </th>
            <th className="text-right font-normal">
              <FormattedMessage {...says.hints} />
            </th>
          </tr>
        </thead>
        <tbody className="divide-rule divide-y">
          {board.scores.map((score) => (
            <Row key={score.player.id} score={score} mine={score.player.id === me?.id} />
          ))}
        </tbody>
      </table>

      {mine && !shown.has(mine.player.id) && (
        <table className="border-rule mt-1 w-full border-t text-sm">
          <tbody>
            <Row score={mine} mine />
          </tbody>
        </table>
      )}
    </>
  );
}
