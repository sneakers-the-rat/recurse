/**
 * The record of how it has been going: `/stats`.
 *
 * Its own page, like the archive, and for the same reason — it is about the run of play
 * rather than about a board, and there is nowhere on a screen built around one figure to put
 * a second one. It is also the only screen that reads the history at all; nothing on the way
 * to playing today touches it.
 *
 * **Every figure here is derived, and nothing is stored but the rounds.** See stats.ts. What
 * this file does is choose which of them are worth a player's attention and say each one in a
 * sentence rather than as a number floating beside a caption.
 *
 * Three of those choices are arguments, and they are the reason the screen looks like this:
 *
 * - **±par is three numbers, never one.** The three lengths are not evenly stocked — the
 *   build reports 44 / 37 / 19 — so a blended average is mostly a statement about which
 *   lengths came up.
 * - **Shortcuts get their denominator.** "3 found" is meaningless; "3 of the 11 you were
 *   offered" is a score. Rounds on boards with no shortcut are in neither number.
 * - **One streak, not three.** Three parallel streaks is three ways to feel bad about a day
 *   somebody played one board and enjoyed it.
 *
 * The history at the foot draws the same `PuzzleCard` the archive does, so a board looks the
 * same wherever it is met. It knows about rounds the *game* store has already evicted — that
 * one keeps thirty games, about ten days — so opening a board from far enough back gives a
 * playable board rather than the result view. That is the right way round: the record of the
 * round is here, and the board is there to be played again.
 *
 * Nothing here leaves the device. The export is the only copy there will ever be, which is
 * why the clear button is next to it and says so.
 */

import { memo, useMemo, useRef, useState } from 'react';
import { FormattedMessage, useIntl, type MessageDescriptor } from 'react-intl';
import { bandName } from '../i18n/bands';
import { say, type Phrase } from '../i18n/format';
import { archive as archiveSays } from '../i18n/messages/archive';
import { stats as says } from '../i18n/messages/stats';
import type { RawManifest } from '../lib/data';
import { emojiTrail } from '../lib/share';
import {
  byBand,
  directness,
  exportStats,
  hintsByKind,
  mergeStats,
  parseStats,
  secrets,
  streaks,
  summary,
  sweeps,
  unpackMarks,
  wordCounts,
  type Completion,
} from '../lib/stats';
import { HintPlot, ParHistogram, ScorePlot } from './Chart';
import { PuzzleCard } from './PuzzleCard';
import { Slash, Space } from './marks';

interface Props {
  manifest: RawManifest;
  /** Today, as a day number: what a streak is measured back from. */
  today: number;
  records: readonly Completion[];
  /** Import and clear both replace the lot; there is no other way to change history. */
  onReplace: (records: readonly Completion[]) => void;
  onOpen: (id: string) => void;
  onPuzzles: () => void;
  onClose: () => void;
}

/**
 * A figure and what it is.
 *
 * The number first and large, the name under it in the marginal hand — a stats screen is
 * read by scanning the numbers and only then finding out what they were.
 */
function Figure({
  name,
  value,
  note,
}: {
  name: MessageDescriptor;
  value: string;
  note?: React.ReactNode;
}) {
  const intl = useIntl();
  const said = intl.formatMessage(name);
  return (
    // Named, so the figure can be asked for by what it is rather than found by reading the
    // grid it happens to sit in — which is what a test would otherwise have to do.
    <div aria-label={said} className="border-rule bg-noir-2/40 border p-3">
      <p className="text-bone text-2xl leading-none font-semibold">{value}</p>
      <p className="label text-ash-lit mt-1.5 text-[0.55rem]">{said}</p>
      {note && <p className="label text-ash mt-0.5 text-[0.55rem] normal-case">{note}</p>}
    </div>
  );
}

/**
 * A figure named by a band rather than by a message: the lengths come from the manifest.
 *
 * See `bands.ts` — the builder writes "short", "medium", "long" and the client translates
 * them if it has words for them, falling back to whatever the data said.
 */
function BandFigure({ name, value, note }: { name: string; value: string; note?: React.ReactNode }) {
  return (
    <div aria-label={name} className="border-rule bg-noir-2/40 border p-3">
      <p className="text-bone text-2xl leading-none font-semibold">{value}</p>
      <p className="label text-ash-lit mt-1.5 text-[0.55rem]">{name}</p>
      {note && <p className="label text-ash mt-0.5 text-[0.55rem] normal-case">{note}</p>}
    </div>
  );
}

/** A signed average, which is the only way ±par reads correctly at a glance. */
function signed(value: number): string {
  const rounded = value.toFixed(1);
  return value > 0 ? `+${rounded}` : rounded;
}

function Section({ title, children }: { title: MessageDescriptor; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="label mb-3">
        <FormattedMessage {...title} />
      </h2>
      {children}
    </section>
  );
}

export const Stats = memo(function Stats({
  manifest,
  today,
  records,
  onReplace,
  onOpen,
  onPuzzles,
  onClose,
}: Props) {
  const intl = useIntl();
  const bands = manifest.bands.map((band) => bandName(intl, band.name));

  const overall = useMemo(() => summary(records), [records]);
  const lengths = useMemo(() => byBand(records, bands.length), [records, bands.length]);
  const short = useMemo(() => secrets(records), [records]);
  const straight = useMemo(() => directness(records), [records]);
  const bought = useMemo(() => hintsByKind(records), [records]);
  const run = useMemo(() => streaks(records, today), [records, today]);
  const swept = useMemo(() => sweeps(records, bands.length), [records, bands.length]);
  const words = useMemo(() => wordCounts(records, 12), [records]);
  const recovered = useMemo(() => records.some((one) => one.backfilled), [records]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <div className="border-rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b py-4">
        <h1 className="text-bone text-2xl font-semibold">
          <FormattedMessage {...says.title} />
        </h1>
        <span className="flex items-baseline gap-4">
          <button onClick={onPuzzles} className="label text-ash-lit hover:text-gilt" type="button">
            <FormattedMessage {...says.puzzles} />
          </button>
          <button onClick={onClose} className="label text-ash-lit hover:text-gilt" type="button">
            <FormattedMessage {...archiveSays.backToBoard} />
          </button>
        </span>
      </div>

      {records.length === 0 ? (
        <p className="text-bone-dim mt-8 text-sm">
          <FormattedMessage {...says.empty} />
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure name={says.rounds} value={String(overall.played)} />
            <Figure
              name={says.guessesPerRound}
              value={overall.guesses.toFixed(1)}
              note={<FormattedMessage {...says.parNote} values={{ par: overall.par.toFixed(1) }} />}
            />
            <Figure name={says.againstPar} value={signed(overall.diff)} />
            <Figure name={says.hintsPerRound} value={overall.hints.toFixed(1)} />
          </div>

          <Section title={says.vsPar}>
            <div className="grid grid-cols-3 gap-2">
              {lengths.map((band, index) => (
                <BandFigure
                  key={bands[index] ?? index}
                  name={bands[index] ?? String(index)}
                  value={
                    band.played === 0 ? intl.formatMessage(says.noneYet) : signed(band.diff)
                  }
                  note={<FormattedMessage {...says.roundsAt} values={{ count: band.played }} />}
                />
              ))}
            </div>
          </Section>

          <Section title={says.streak}>
            <div className="grid grid-cols-3 gap-2">
              <Figure name={says.dayStreak} value={String(run.current)} />
              <Figure name={says.longestStreak} value={String(run.longest)} />
              <Figure
                name={says.sweeps}
                value={String(swept)}
                note={<FormattedMessage {...says.sweepNote} />}
              />
            </div>
          </Section>

          <Section title={says.history}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ScorePlot records={records} bands={bands} />
              <ParHistogram records={records} />
            </div>
            <div className="mt-3">
              <HintPlot records={records} />
            </div>
          </Section>

          <Section title={says.addsUpTo}>
            <ul className="text-bone-dim space-y-2 text-sm">
              <li>
                {short.offered === 0 ? (
                  <FormattedMessage {...says.noShortcuts} />
                ) : (
                  <FormattedMessage
                    {...says.shortcutsFound}
                    values={{
                      found: short.found,
                      offered: short.offered,
                      gilt: (chunks: React.ReactNode) => (
                        <span className="text-gilt">{chunks}</span>
                      ),
                    }}
                  />
                )}
              </li>
              <li>
                {straight.guesses === 0 ? (
                  <FormattedMessage {...says.noGuesses} />
                ) : (
                  <FormattedMessage
                    {...says.directness}
                    values={{
                      percent: Math.round((straight.on / straight.guesses) * 100),
                      on: straight.on,
                      total: straight.guesses,
                      pct: (chunks: React.ReactNode) => (
                        <span className="text-bone">{chunks}</span>
                      ),
                    }}
                  />
                )}
              </li>
              <li>
                {bought.letters + bought.shapes === 0 ? (
                  <FormattedMessage {...says.noHints} />
                ) : (
                  <FormattedMessage {...says.lettersBought} values={{ count: bought.letters }} />
                )}
              </li>
            </ul>
          </Section>

          {words.length > 0 && (
            <Section title={says.keepMeeting}>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                {words.map(({ word, count }) => (
                  <li key={word} className="word text-bone-dim text-sm">
                    {word}
                    <span className="text-ash-lit">
                      <Space />
                      <FormattedMessage {...says.wordCount} values={{ count }} />
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <History records={records} bands={bands} onOpen={onOpen} />
        </>
      )}

      <Keeping manifest={manifest} records={records} onReplace={onReplace} />
    </div>
  );
});

/**
 * Every round, newest first, filterable by length.
 *
 * The same card the archive draws, with the score and the trail added beside it — a board
 * should look the same wherever it is met, and the two extra facts are what make this a
 * history rather than a second archive.
 */
const History = memo(function History({
  records,
  bands,
  onOpen,
}: {
  records: readonly Completion[];
  bands: readonly string[];
  onOpen: (id: string) => void;
}) {
  const intl = useIntl();
  const [only, setOnly] = useState<number | null>(null);

  const shown = useMemo(
    () =>
      [...records]
        .filter((one) => only === null || one.band === only)
        // Newest first, and by band within a day so the three lengths of one day keep an order.
        .sort((a, b) => b.day - a.day || b.band - a.band),
    [records, only],
  );

  const choice = (name: string, band: number | null) => (
    <button
      key={name}
      type="button"
      onClick={() => setOnly(band)}
      aria-pressed={only === band}
      className={`label border px-2 py-1 transition-colors ${
        only === band
          ? 'border-gilt-dim text-gilt'
          : 'border-rule text-ash-lit hover:border-gilt-dim hover:text-bone-dim'
      }`}
    >
      {name}
    </button>
  );

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="label">
          <FormattedMessage {...says.everyRound} />
        </h2>
        <span className="flex flex-wrap gap-1.5">
          {choice(intl.formatMessage(says.allLengths), null)}
          {bands.map((name, band) => choice(name, band))}
        </span>
      </div>

      <ul className="space-y-1.5">
        {shown.map((one) => {
          const [source = '', target = ''] = one.key.split('>');
          const under = one.guesses < one.par;
          return (
            <li key={one.key} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <PuzzleCard
                  date={one.date}
                  band={bands[one.band] ?? String(one.band)}
                  source={source}
                  target={target}
                  known
                  onOpen={() => onOpen(one.id)}
                />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="label text-ash-lit whitespace-nowrap">
                  <span className={under ? 'text-gilt' : 'text-bone'}>{one.guesses}</span>
                  <Slash />
                  {one.par}
                </span>
                {/* Letter-spaced, so the squares do not fuse into a bar. See Completed.tsx. */}
                <span className="max-w-[9rem] overflow-hidden text-[0.6rem] tracking-[0.1em]">
                  {emojiTrail(unpackMarks(one.marks))}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && (
        <p className="label text-ash">
          <FormattedMessage {...says.noneAtLength} />
        </p>
      )}
    </section>
  );
});

/**
 * Taking it with you, and throwing it away.
 *
 * Both halves in one place, because they are one decision: a store that lives only in this
 * browser needs a visible way out and a visible way to end it, and the way out has to be
 * offered right beside the way to end it.
 *
 * The export is a file *and* a block of selectable text with a copy button, which is the same
 * decision `Completed.tsx` made about the share string: a download on a phone goes into a
 * folder nobody can find, and a paste goes wherever the player is already typing.
 *
 * The import is preview then confirm. A merge that happened the instant a file was picked
 * would be a merge nobody agreed to, and the numbers — how many are new, how many were
 * already here — are exactly what somebody wants before agreeing.
 */
const Keeping = memo(function Keeping({
  manifest,
  records,
  onReplace,
}: {
  manifest: RawManifest;
  records: readonly Completion[];
  onReplace: (records: readonly Completion[]) => void;
}) {
  const [showing, setShowing] = useState<'export' | 'import' | null>(null);
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [offer, setOffer] = useState<
    | { ok: true; records: Completion[]; added: number; kept: number; dropped: number }
    | { ok: false; reason: Phrase }
    | null
  >(null);
  const intl = useIntl();
  const [clearing, setClearing] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const text = useMemo(
    () =>
      JSON.stringify(
        exportStats(records, {
          epoch: manifest.epoch,
          bank: manifest.version,
          exported: new Date().toISOString(),
        }),
      ),
    [records, manifest],
  );

  /** The file name carries the wall-clock date, which is the one date a file wants. */
  function download() {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `recurse-stats-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Nothing to apologise for: the text is on screen and selectable, which is the point
      // of showing it rather than only offering a button.
      setCopied(false);
    }
  }

  /** Read a blob of JSON and say what importing it would do, without doing it. */
  function consider(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setOffer({ ok: false, reason: { message: says.notAFile } });
      return;
    }
    const read = parseStats(parsed);
    if (!read.ok) {
      setOffer(read);
      return;
    }
    const merged = mergeStats(records, read.records);
    setOffer({ ok: true, ...merged, dropped: read.dropped });
  }

  function pick(chosen: File | undefined) {
    if (!chosen) return;
    void chosen.text().then(consider);
  }

  return (
    <section className="border-rule mt-12 border-t pt-6">
      <h2 className="label mb-3">
        <FormattedMessage {...says.export} />
      </h2>
      <p className="text-ash-lit text-xs">
        <FormattedMessage {...says.localOnly} />
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShowing(showing === 'export' ? null : 'export')}
          className="label border-rule text-bone hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
        >
          <FormattedMessage {...says.export} />
        </button>
        <button
          type="button"
          onClick={() => setShowing(showing === 'import' ? null : 'import')}
          className="label border-rule text-bone hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
        >
          <FormattedMessage {...says.import} />
        </button>
        <button
          type="button"
          onClick={() => setClearing(true)}
          className="label border-rule text-ash-lit hover:border-blood hover:text-blood-lit ml-auto border px-3 py-1.5 transition-colors"
        >
          <FormattedMessage {...says.clear} />
        </button>
      </div>

      {said && <p className="label text-gilt mt-3">{said}</p>}

      {showing === 'export' && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={download}
              className="label border-rule text-bone hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
            >
              <FormattedMessage {...says.download} />
            </button>
            <button
              type="button"
              onClick={copy}
              className="label border-rule text-bone hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
            >
              <FormattedMessage {...(copied ? says.copied : says.copyText)} />
            </button>
          </div>
          <pre
            aria-label={intl.formatMessage(says.asText)}
            className="word text-bone-dim border-rule bg-noir-3 mt-2 max-h-40 overflow-auto border px-2.5 py-1.5 text-[10px] leading-snug break-all whitespace-pre-wrap"
          >
            {text}
          </pre>
        </div>
      )}

      {showing === 'import' && (
        <div className="mt-3">
          <p className="text-bone-dim text-xs">
            <FormattedMessage {...says.importNote} />
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              aria-label={intl.formatMessage(says.chooseFile)}
              onChange={(event) => pick(event.target.files?.[0])}
              className="label text-ash-lit max-w-full text-[0.55rem]"
            />
          </div>
          <textarea
            aria-label={intl.formatMessage(says.pasteLabel)}
            value={pasted}
            onChange={(event) => {
              setPasted(event.target.value);
              setOffer(null);
            }}
            placeholder={intl.formatMessage(says.pastePlaceholder)}
            rows={3}
            className="word border-rule bg-noir-3 text-bone-dim mt-2 w-full border px-2.5 py-1.5 text-[11px]"
          />
          <button
            type="button"
            onClick={() => consider(pasted)}
            disabled={pasted.trim().length === 0}
            className="label border-rule text-bone hover:border-gilt hover:text-gilt mt-2 border px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <FormattedMessage {...says.readIt} />
          </button>

          {offer && !offer.ok && (
            <p className="label text-blood-lit mt-3">{say(intl, offer.reason)}</p>
          )}
          {offer?.ok && (
            <div className="border-rule bg-noir-2 mt-3 border p-3">
              <p className="text-bone-dim text-sm">
                <FormattedMessage
                  {...says.offer}
                  values={{ added: offer.added, kept: offer.kept, dropped: offer.dropped }}
                />
              </p>
              <button
                type="button"
                onClick={() => {
                  onReplace(offer.records);
                  setSaid(intl.formatMessage(says.imported, { count: offer.added }));
                  setOffer(null);
                  setPasted('');
                  setShowing(null);
                  if (file.current) file.current.value = '';
                }}
                disabled={offer.added === 0}
                className="label border-gilt-dim text-gilt hover:border-gilt mt-2 border px-3 py-1.5 transition-colors disabled:opacity-40"
              >
                <FormattedMessage {...(offer.added === 0 ? says.nothingToAdd : says.importThem)} />
              </button>
            </div>
          )}
        </div>
      )}

      {clearing && (
        <div className="border-blood/60 bg-noir-2 mt-3 border p-3">
          <p className="text-bone-dim text-sm">
            <FormattedMessage {...says.clearWarning} values={{ count: records.length }} />
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setShowing('export');
                setClearing(false);
              }}
              className="label border-rule text-bone hover:border-gilt hover:text-gilt border px-3 py-1.5 transition-colors"
            >
              <FormattedMessage {...says.exportFirst} />
            </button>
            <button
              type="button"
              onClick={() => {
                onReplace([]);
                setClearing(false);
                setSaid(intl.formatMessage(says.cleared));
              }}
              className="label border-blood text-blood-lit hover:bg-blood/10 border px-3 py-1.5 transition-colors"
            >
              <FormattedMessage {...says.clearItAll} />
            </button>
            <button
              type="button"
              onClick={() => setClearing(false)}
              className="label text-ash-lit hover:text-bone-dim px-3 py-1.5"
            >
              <FormattedMessage {...says.keepIt} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
});
