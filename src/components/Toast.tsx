/**
 * A line of text the game says once and then stops saying.
 *
 * For the things a refusal cannot say on the board itself. A hint refused on a shortcut
 * draws a cross on the mark, which reads as "not that" — it cannot read as *why*, and the
 * why is a rule the player has not met before.
 *
 * Above the guess bar rather than over the plate: the plate is the thing being talked about,
 * and a message that covers it makes the player move their head instead of their eyes. It
 * takes no pointer events, so it can never swallow a tap on a word underneath.
 */

interface Props {
  message: string;
}

export function Toast({ message }: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <p className="label border-gilt-dim bg-noir-2 text-bone border px-3 py-2 text-center shadow-lg">
        {message}
      </p>
    </div>
  );
}
