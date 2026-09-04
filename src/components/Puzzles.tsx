/**
 * The archive: every board already played, by date or by its two words.
 *
 * Its own page rather than a panel, because it is the one screen that is *about* the bank
 * instead of about a board — and because it costs a download nothing else does. The pair index
 * is a megabyte and used to be dev mode's alone; both halves of this page need it (the calendar
 * to say which words a date holds, the search to find a date from words), so it is fetched on
 * arrival here and nowhere else. See `loadPairs`.
 *
 * **Nothing after today.** A future board is in the year files and a determined reader can dig
 * one out; the page simply does not offer it, which is the difference between an archive and a
 * spoiler. There is nothing here to secure and no pretence that there is.
 *
 * This is the page and nothing else: what to fetch, and where the two halves go. `Calendar` owns
 * browsing by date, `FindPuzzle` owns searching by word, and both draw the same `PuzzleCard`, so
 * a board looks the same wherever it is met.
 */

import { memo, useEffect, useMemo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { bandName as translateBand } from '../i18n/bands';
import { archive as says } from '../i18n/messages/archive';
import { archiveRange } from '../lib/archive';
import { idOnDay, type Pair, type RawCalendar, type RawManifest } from '../lib/data';
import { dateForDay, dayOfYear } from '../lib/daily';
import { Calendar } from './Calendar';
import { FindPuzzle } from './FindPuzzle';

interface Props {
  manifest: RawManifest;
  /** Today, as a day number. Everything up to and including it is playable. */
  today: number;
  /** The pair index, once it has arrived, and how to ask for it. */
  pairs: readonly Pair[] | null;
  onNeedPairs: () => void;
  /** The calendar years already fetched, and how to ask for one. */
  years: ReadonlyMap<number, RawCalendar>;
  onNeedYear: (year: number) => void;
  onOpen: (id: string) => void;
  onToday: () => void;
  /** To the record of how it has been going. The two pages are each other's neighbours. */
  onStats: () => void;
  onClose: () => void;
}

export const Puzzles = memo(function Puzzles({
  manifest,
  today,
  pairs,
  onNeedPairs,
  years,
  onNeedYear,
  onOpen,
  onToday,
  onStats,
  onClose,
}: Props) {
  const range = useMemo(() => archiveRange(manifest.epoch, today), [manifest.epoch, today]);

  // The index is what both halves read, so it is asked for on arrival rather than on the first
  // keystroke — the calendar needs it before anything has been typed.
  useEffect(() => {
    if (!pairs) onNeedPairs();
  }, [pairs, onNeedPairs]);

  /**
   * Every year the archive covers, not just the month on screen.
   *
   * One 12 KB file per year and the archive is a couple of years old, so this is cheaper than
   * the alternative was confusing: with only the visible month's year loaded, the search
   * answered "no puzzle yet" for a board from last year until you happened to browse to it.
   */
  useEffect(() => {
    for (let year = range.first.year; year <= range.last.year; year++) {
      if (!years.has(year)) onNeedYear(year);
    }
  }, [range, years, onNeedYear]);

  const wordsFor = useMemo(() => {
    const map = new Map<string, Pair>();
    for (const pair of pairs ?? []) map.set(pair.id, pair);
    return map;
  }, [pairs]);

  const played = usePlayed(manifest, years, today);
  const intl = useIntl();
  // The builder names the lengths; the client translates them if it has words for them.
  const bandName = (band: number) => {
    const name = manifest.bands[band]?.name;
    return name ? translateBand(intl, name) : '';
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16">
      <div className="border-rule flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b py-4">
        <h1 className="text-bone text-2xl font-semibold">
          <FormattedMessage {...says.title} />
        </h1>
        <span className="flex items-baseline gap-4">
          {/* The other page that is not a board. Each links to the other, so neither is
              reachable only through the masthead. */}
          <button onClick={onStats} className="label text-ash-lit hover:text-gilt" type="button">
            <FormattedMessage {...says.stats} />
          </button>
          <button onClick={onClose} className="label text-ash-lit hover:text-gilt" type="button">
            <FormattedMessage {...says.backToBoard} />
          </button>
        </span>
      </div>

      {/* Today first, because it is what most visits are looking for. */}
      <button
        onClick={onToday}
        type="button"
        className="border-rule hover:border-gilt hover:bg-noir-3 group mt-6 flex w-full items-baseline justify-between border p-4 text-left transition-colors"
      >
        <span className="text-bone group-hover:text-gilt text-lg group-hover:underline">
          <FormattedMessage {...says.today} />
        </span>
        <span className="label text-ash-lit">
          <FormattedMessage {...says.todayDay} values={{ day: today }} />
        </span>
      </button>

      <h2 className="label mt-10 mb-3">
        <FormattedMessage {...says.byWords} />
      </h2>
      <FindPuzzle pairs={pairs} played={played} bandName={bandName} onOpen={onOpen} />

      <h2 className="label mt-10 mb-3">
        <FormattedMessage {...says.byDate} />
      </h2>
      <Calendar
        manifest={manifest}
        today={today}
        years={years}
        wordsFor={wordsFor}
        onOpen={onOpen}
      />
    </div>
  );
});

/**
 * The boards that have already come up, and the date each came up on.
 *
 * Every day from the epoch to today, out of the year files already in hand. A year not fetched
 * yet contributes nothing rather than blocking, so the search fills in as they land.
 */
function usePlayed(
  manifest: RawManifest,
  years: ReadonlyMap<number, RawCalendar>,
  today: number,
): ReadonlyMap<string, { date: string; band: number }> {
  return useMemo(() => {
    const played = new Map<string, { date: string; band: number }>();
    for (let day = 0; day <= today; day++) {
      const date = dateForDay(day, manifest.epoch);
      const calendar = years.get(Number(date.slice(0, 4)));
      if (!calendar) continue;
      for (let band = 0; band < manifest.bands.length; band++) {
        const id = idOnDay(calendar, band, dayOfYear(date));
        // First appearance wins: a band shorter than the calendar cycles, and the date worth
        // showing is the one it was first played on.
        if (id !== null && !played.has(id)) played.set(id, { date, band });
      }
    }
    return played;
  }, [manifest, years, today]);
}
