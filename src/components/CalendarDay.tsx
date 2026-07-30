/**
 * One day of the archive: the date, and the three boards it offered.
 *
 * Three columns, one per length, on every screen. A seven-column month grid was never wide
 * enough to read a word pair in — a desktop column is about 100px and a phone's is 58, and the
 * words are longer than either — so the calendar is a stack of days and the *lengths* get the
 * columns.
 */

import { memo } from 'react';
import { PuzzleCard } from './PuzzleCard';

/** One board of one day, as the archive needs it. */
export interface Board {
  id: string;
  band: number;
  source: string;
  target: string;
  /** False while the pair index is still arriving, so the card holds its shape. */
  known: boolean;
}

interface Props {
  /** `YYYY-MM-DD`. */
  date: string;
  today: boolean;
  boards: readonly Board[];
  bandName: (band: number) => string;
  onOpen: (id: string) => void;
}

export const CalendarDay = memo(function CalendarDay({
  date,
  today,
  boards,
  bandName,
  onOpen,
}: Props) {
  return (
    <li className="border-rule border-b p-2 last:border-b-0">
      <span
        className={`label mb-1 block text-[0.65rem] ${today ? 'text-gilt' : 'text-ash-lit'}`}
      >
        {date}
        {today ? ' · today' : ''}
      </span>
      <div className="grid grid-cols-3 gap-1">
        {boards.map((board) => (
          <PuzzleCard
            key={board.id}
            band={bandName(board.band)}
            source={board.source}
            target={board.target}
            known={board.known}
            today={today}
            onOpen={() => onOpen(board.id)}
          />
        ))}
      </div>
    </li>
  );
});
