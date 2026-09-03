/**
 * The one thing a first visit is asked, before anything else.
 *
 * ReCurse does not explain itself from the board. What is on screen is two words, a scatter
 * of unnamed dots and a text field, and the rule that makes sense of all three — that the
 * piece you add or take out has to be a word itself — is not guessable from any of it. So a
 * first visit is offered the walkthrough, once.
 *
 * **Once, and either answer counts.** Taking it and skipping it are both answers, and both
 * are remembered — see `markGreeted`. A prompt that comes back is a prompt that reads as
 * broken, and this one is over a live board somebody may have arrived at by a shared link
 * and be perfectly happy to just play.
 *
 * Which is why skipping says where the tutorial went. The cost of declining has to be
 * visibly nothing, or the choice is not a real one.
 */

interface Props {
  onTutorial: () => void;
  onSkip: () => void;
}

export function Welcome({ onTutorial, onSkip }: Props) {
  return (
    // Dismissing by tapping away is skipping, which is the same answer by a quieter route.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onSkip}
      role="presentation"
    >
      <div
        className="border-rule bg-noir-2 w-full max-w-sm border p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="welcome-title" className="text-bone mb-3 text-2xl font-semibold">
          New here?
        </h2>

        <p className="text-bone-dim text-[0.9375rem] leading-relaxed">
          The game is getting from one word to another by adding or removing a whole word
          from inside it.
        </p>

        {/*
          The rule, shown rather than stated. It is the whole game and it is the thing
          everybody misreads as "any letters", so it is worth three lines and a rule.
        */}
        <figure className="border-rule bg-noir-3 my-4 border p-3">
          <p className="word text-base">
            <span className="text-bone">c</span>
            <span className="text-blood-lit">our</span>
            <span className="text-bone">age</span> <span className="text-blood-lit">− our</span> ={' '}
            <span className="text-bone">cage</span>
          </p>
        </figure>

        <p className="text-bone-dim text-[0.9375rem] leading-relaxed">
          There is a short walkthrough on a real board. It takes a couple of minutes.
        </p>

        <button
          onClick={onTutorial}
          className="label border-gilt-dim text-gilt hover:border-gilt hover:bg-gilt-dim/15 mt-5 w-full border py-3 transition-colors"
          type="button"
        >
          Show me how
        </button>

        <button
          onClick={onSkip}
          className="label text-ash-lit hover:text-bone-dim mt-3 w-full py-2 transition-colors"
          type="button"
        >
          Skip — I’ll work it out
        </button>

        {/*
          What declining costs, which is nothing, said where the decision is made. Not set
          as a label: in caps at the size of the button above it, it read as a third thing
          to press rather than as the reassurance it is.
        */}
        <p className="text-ash-lit mt-3 text-center text-xs">
          It stays in the menu, under “Tutorial”.
        </p>
      </div>
    </div>
  );
}
