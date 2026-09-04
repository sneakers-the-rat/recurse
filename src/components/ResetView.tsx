/**
 * The way back to the whole puzzle.
 *
 * The board is bigger than the plate on purpose — words are drawn at a readable size and
 * the surplus runs off the edges — so a player who has pinched and dragged their way to
 * some far corner needs a way back that is not a series of guesses about which direction
 * home is in. One tap returns to the view the round opened on: source at the top, target
 * at the bottom, at the scale the game chose.
 *
 * Small, in the corner, and quiet. It is over the figure, which means it is over words
 * whenever the board happens to reach that corner, so it takes as little room as a legible
 * label can and carries the ground with it rather than letting a line run through the
 * letters. Bottom right because the top of the plate is where the source stands and where
 * the title card lands.
 *
 * Renders and reports the tap. Where the camera then goes is App's, and the arithmetic is
 * camera.ts's.
 */

import { memo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { board as says } from '../i18n/messages/board';

export const ResetView = memo(function ResetView({ onReset }: { onReset: () => void }) {
  const intl = useIntl();
  const whole = intl.formatMessage(says.resetView);
  return (
    <button
      type="button"
      onClick={onReset}
      // The name says what it does; the word on it is what there is room for.
      aria-label={whole}
      title={whole}
      data-tour="reset-view"
      // Padded past what the label needs, because this is a thumb's target on the screen
      // it matters on and the rest of the chrome is sized for a pointer.
      className="label bg-noir/80 border-rule hover:border-gilt-dim hover:text-gilt absolute right-2 bottom-2 z-10 border px-3 py-2.5 leading-none whitespace-nowrap transition-colors"
    >
      <FormattedMessage {...says.reset} />
    </button>
  );
});
