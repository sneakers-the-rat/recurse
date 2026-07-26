/**
 * Masthead and the puzzle statement.
 *
 * The day number is the only number here that is decoration-adjacent, and it
 * earns its place: it is the real puzzle index, the thing a share string will
 * quote, and how players talk about a daily game.
 */

interface Props {
  source: string;
  target: string;
  par: number;
  day: number;
  guesses: number;
  onHelp: () => void;
}

export function Header({ source, target, par, day, guesses, onHelp }: Props) {
  return (
    <header className="border-rule border-b">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-2.5">
        <h1 className="flex items-baseline gap-2">
          <span className="text-bone text-xl leading-none font-semibold tracking-tight">
            Re<span className="text-blood-lit italic">Curse</span>
          </span>
          <span className="label text-ash-lit">№ {day}</span>
        </h1>
        <button onClick={onHelp} className="label hover:text-gilt transition-colors" type="button">
          How to play
        </button>
      </div>

      {/* The statement, set like a Deco title page: rule, line, rule. */}
      <div className="border-rule border-t">
        <div className="mx-auto max-w-2xl px-4 py-4 text-center">
          <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <span className="word text-bone text-2xl sm:text-3xl">{source}</span>
            <span aria-hidden className="text-gilt text-xs">
              ◆
            </span>
            <span className="word text-bone text-2xl sm:text-3xl">{target}</span>
          </p>
          <p className="label mt-2.5">
            {par} moves at best
            <span className="text-ash-lit mx-2">·</span>
            {guesses === 0 ? 'no guesses yet' : `${guesses} guessed`}
          </p>
        </div>
      </div>
    </header>
  );
}
