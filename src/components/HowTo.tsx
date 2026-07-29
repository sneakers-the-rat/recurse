/**
 * The rules. Worth being precise about, because the central constraint — that
 * the piece you add or remove must itself be a word — is the whole game and is
 * easy to misread as "any letters".
 */

interface Props {
  minWord: number;
  minSub: number;
  onClose: () => void;
}

export function HowTo({ minWord, minSub, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="border-rule bg-noir-2 max-h-[85vh] w-full max-w-lg overflow-y-auto border p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="howto-title" className="text-bone mb-1 text-2xl font-semibold">
          How to play
        </h2>
        <p className="label mb-5">A word hides inside another word</p>

        <div className="text-bone-dim space-y-4 text-[0.9375rem] leading-relaxed">
          <p>
            Get from the first word to the second. Each turn you either{' '}
            <span className="text-gilt">add a word</span> into the one you have, or{' '}
            <span className="text-blood-lit">remove a word</span> from it. What you add or
            remove must be a real word, and so must what you end up with.
          </p>

          <figure className="border-rule bg-noir-3 border p-3">
            <p className="word text-base">
              base <span className="text-gilt">+ ball</span> ={' '}
              <span className="text-bone">base</span>
              <span className="text-gilt">ball</span>
            </p>
            <p className="word mt-1.5 text-base">
              cour<span className="text-blood-lit">age</span>{' '}
              <span className="text-blood-lit">− age</span> ={' '}
              <span className="text-bone">cour</span>
            </p>
            <figcaption className="label mt-2.5 normal-case">
              The letters you add or take out must sit together in one unbroken run.
            </figcaption>
          </figure>

          <p>
            The map shows the words around you. Empty rings are words that exist but that you
            have not named yet — tap one to learn how many letters it has, and tap again to be
            given a letter, and again, until the word is simply there. Rings marked in{' '}
            <span className="text-gilt">gilt</span> lie on the shortest route.
          </p>

          <p>
            Hints are unlimited, and counted alongside your guesses. Asking is not cheating:
            this is not a race, and “ten guesses, ten thousand hints” is a perfectly good thing
            to post.
          </p>

          <p>
            You can guess from <em className="text-bone not-italic">any</em> word you have
            already found, not just the last one. So a wrong turn is not fatal — but every
            guess counts, and your score is how many you made. Match the number of moves shown
            and you played it perfectly.
          </p>

          <p className="text-ash-lit text-sm">
            Words are at least {minWord} letters; the word you add or remove is at least{' '}
            {minSub}. Any word in the dictionary counts, so guess freely.
          </p>
        </div>

        <button
          onClick={onClose}
          className="label border-rule text-bone hover:border-gilt hover:text-gilt mt-6 w-full border py-2.5 transition-colors"
          type="button"
        >
          Begin
        </button>
      </div>
    </div>
  );
}
