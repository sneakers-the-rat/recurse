/**
 * Browsing the archive by date: a month of days, and a year of months to zoom out to.
 *
 * Owns only where it is looking. What a date *holds* comes from the year files, which the page
 * above fetches — see `idForDay` in data.ts for why a date is a file lookup rather than
 * arithmetic. Navigation is held inside `archiveRange`, so it can never step off either end of
 * what has happened.
 */

import { memo, useMemo, useState } from 'react';
import {
  MONTH_NAMES,
  archiveRange,
  clampMonth,
  compareMonths,
  monthDays,
  monthName,
  stepMonth,
  type Month,
} from '../lib/archive';
import { idOnDay, type Pair, type RawCalendar, type RawManifest } from '../lib/data';
import { dayOfYear } from '../lib/daily';
import { CalendarDay, type Board } from './CalendarDay';

interface Props {
  manifest: RawManifest;
  today: number;
  years: ReadonlyMap<number, RawCalendar>;
  /** Words by id, for saying what a date holds. Empty until the pair index lands. */
  wordsFor: ReadonlyMap<string, Pair>;
  onOpen: (id: string) => void;
}

export const Calendar = memo(function Calendar({
  manifest,
  today,
  years,
  wordsFor,
  onOpen,
}: Props) {
  const range = useMemo(() => archiveRange(manifest.epoch, today), [manifest.epoch, today]);
  // Opens on the month today is in, which is the one with something new in it.
  const [at, setAt] = useState<Month>(range.last);
  const [zoomed, setZoomed] = useState(false);

  const go = (to: Month) => setAt(clampMonth(to, range.first, range.last));
  const days = useMemo(() => monthDays(at, today, manifest.epoch), [at, today, manifest.epoch]);
  const bandName = (band: number) => manifest.bands[band]?.name ?? '';

  /** The three boards of a date, or none until that year's calendar has arrived. */
  const boardsOn = (date: string): Board[] => {
    const calendar = years.get(Number(date.slice(0, 4)));
    if (!calendar) return [];
    return manifest.bands
      .map((_, band) => ({ band, id: idOnDay(calendar, band, dayOfYear(date)) }))
      .filter((one): one is { band: number; id: string } => one.id !== null)
      .map(({ band, id }) => ({
        band,
        id,
        source: wordsFor.get(id)?.source ?? '',
        target: wordsFor.get(id)?.target ?? '',
        known: wordsFor.has(id),
      }));
  };

  return (
    <div className="border-rule border">
      <Nav
        at={at}
        zoomed={zoomed}
        first={range.first}
        last={range.last}
        // Prev and next step whatever is being looked at: a month in the month view, a year in
        // the year view. They used to always mean a month, with a *second* pair of year buttons
        // at the foot of the year view — two idioms for one job, and the year view's own
        // navigation was the one you could not see from the top of it.
        onStep={(by) => go(stepMonth(at, zoomed ? by * 12 : by))}
        onZoom={() => setZoomed((was) => !was)}
      />
      {zoomed ? (
        <Months
          at={at}
          first={range.first}
          last={range.last}
          onPick={(month) => {
            go(month);
            setZoomed(false);
          }}
        />
      ) : !years.has(at.year) ? (
        <p className="label text-ash-lit p-4 normal-case">Reading the calendar…</p>
      ) : (
        <Days days={days} boardsOn={boardsOn} bandName={bandName} onOpen={onOpen} />
      )}
    </div>
  );
});

/** Prev, the month being looked at, next. The heading is also the zoom out. */
function Nav({
  at,
  zoomed,
  first,
  last,
  onStep,
  onZoom,
}: {
  at: Month;
  zoomed: boolean;
  first: Month;
  last: Month;
  onStep: (by: number) => void;
  onZoom: () => void;
}) {
  // What a step means here, and so what it can be stopped by: a year view runs out of years, a
  // month view runs out of months.
  const unit = zoomed ? 'year' : 'month';
  const before = zoomed ? at.year - 1 < first.year : compareMonths(at, first) <= 0;
  const after = zoomed ? at.year + 1 > last.year : compareMonths(at, last) >= 0;

  return (
    <div className="border-rule flex items-center justify-between border-b px-3 py-2">
      <button
        onClick={() => onStep(-1)}
        disabled={before}
        className="label text-ash-lit hover:text-gilt disabled:opacity-30"
        type="button"
        aria-label={`The ${unit} before`}
      >
        ‹ prev
      </button>
      <button
        onClick={onZoom}
        className="text-bone hover:text-gilt text-base hover:underline"
        type="button"
        aria-expanded={zoomed}
      >
        {zoomed ? at.year : monthName(at)}
      </button>
      <button
        onClick={() => onStep(1)}
        disabled={after}
        className="label text-ash-lit hover:text-gilt disabled:opacity-30"
        type="button"
        aria-label={`The ${unit} after`}
      >
        next ›
      </button>
    </div>
  );
}

/** Zoomed out: the twelve months of a year. Moving between years is the nav above. */
function Months({
  at,
  first,
  last,
  onPick,
}: {
  at: Month;
  first: Month;
  last: Month;
  onPick: (month: Month) => void;
}) {
  const outside = (month: Month) =>
    compareMonths(month, first) < 0 || compareMonths(month, last) > 0;

  return (
    <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4">
      {MONTH_NAMES.map((name, index) => (
        <button
          key={name}
          onClick={() => onPick({ year: at.year, month: index + 1 })}
          disabled={outside({ year: at.year, month: index + 1 })}
          type="button"
          className="border-rule text-bone-dim hover:border-gilt hover:text-gilt border px-2 py-3 text-sm disabled:opacity-25 disabled:hover:border-neutral-800"
        >
          {name}
        </button>
      ))}
    </div>
  );
}

/**
 * The days of the month that hold something.
 *
 * Only those: an empty row is not "a day with no puzzles", since every day has three. It is a day
 * outside the archive, and thirty of them stacked above the one you came for is the calendar
 * getting in the way of itself.
 */
function Days({
  days,
  boardsOn,
  bandName,
  onOpen,
}: {
  days: readonly { date: string; played: boolean; today: boolean }[];
  boardsOn: (date: string) => Board[];
  bandName: (band: number) => string;
  onOpen: (id: string) => void;
}) {
  const shown = days
    .filter((day) => day.played)
    .map((day) => ({ day, boards: boardsOn(day.date) }))
    .filter(({ boards }) => boards.length > 0);

  if (shown.length === 0) {
    return <p className="label text-ash-lit p-4 normal-case">Nothing from this month yet.</p>;
  }
  return (
    <ul>
      {shown.map(({ day, boards }) => (
        <CalendarDay
          key={day.date}
          date={day.date}
          today={day.today}
          boards={boards}
          bandName={bandName}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
