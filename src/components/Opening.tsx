/**
 * The title card a round opens on.
 *
 * The board arrives zoomed out, showing the whole puzzle at once, with the two words
 * and the day over it like a title page; then the camera closes on the answer and the
 * card travels up to where the header keeps it for the rest of the round. What that
 * buys is a *look* at the shape of the thing before playing it — which is the one
 * moment the surrounding graph is worth seeing whole, since from then on it is off the
 * edges and reached by dragging.
 *
 * It ends up in the header's own position, so the last frame of the card and the first
 * frame of the header are the same picture: the card is what the header was, arriving.
 *
 * Never in the way. Pointer events pass straight through, so tapping a word during the
 * opening taps the word; anything typed goes to the guess field and cuts the opening
 * short. See App's `useOpening`.
 */

import { memo } from 'react';
import { FormattedMessage } from 'react-intl';
import { round as says } from '../i18n/messages/round';
import { Diamond, Dot } from './marks';

interface Props {
  source: string;
  target: string;
  day: number;
  date: string;
  /** `wide` while the whole board is in shot, `closing` while the camera moves in. */
  phase: 'wide' | 'closing';
}

export const Opening = memo(function Opening({ source, target, day, date, phase }: Props) {
  const closing = phase === 'closing';
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
      aria-hidden
    >
      {/*
        Enough of a wash to read against and no more: at 70% the board behind was too
        dim to look at, which is the one thing this moment is for.
      */}
      <div
        className={`bg-noir absolute inset-0 transition-opacity duration-[900ms] ${
          closing ? 'opacity-0' : 'opacity-45'
        }`}
      />
      <div
        className={`relative text-center transition-all duration-[900ms] ease-in-out ${
          closing ? '-translate-y-[42vh] scale-[0.55] opacity-0' : 'translate-y-0 scale-100'
        }`}
      >
        <p className="label text-gilt mb-3">
          <FormattedMessage {...says.day} values={{ day }} />
          <Dot />
          {date}
        </p>
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <span className="word text-bone text-3xl sm:text-5xl">{source}</span>
          <Diamond className="text-gilt text-base" />
          <span className="word text-bone text-3xl sm:text-5xl">{target}</span>
        </p>
      </div>
    </div>
  );
});
