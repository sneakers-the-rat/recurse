/**
 * Developer mode: step through the whole puzzle bank instead of just today's.
 *
 * Opt in with `?dev` — deliberately not keyed to the dev server, so a deployed
 * build can be inspected the same way, and so the end-to-end tests exercise the
 * normal chrome unless they ask for this.
 *
 * Stepping is by index, because that is the order the calendar runs in and the
 * calendar plays; the URL it lands on is the puzzle's id, like any other visit.
 * Nothing here addresses a board by number.
 *
 * Styled as an instrument rather than part of the game: flat mono, no ornament,
 * so a screenshot never gets mistaken for the real thing.
 */

import { memo, useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { dev as says } from '../i18n/messages/dev';
import { Arrow, Space, Times, TrackBack, TrackOn } from './marks';
import type { Pair } from '../lib/data';
import { PLAIN, type Lexicon } from '../lib/lexicon';
import { spending, type Reading } from '../lib/boardCode';
import type { Puzzle } from '../lib/types';

interface Props {
  index: number;
  total: number;
  puzzle: Puzzle;
  /** Drawn nodes, which can exceed corridorSize once the player strays. */
  drawn: number;
  /**
   * The answer: a shortest route through ordinary words, which is what par counts and what
   * the board is drawn as. This used to be handed the *legal* shortest route, so on a puzzle
   * with a secret the bar showed a line of rare words that was shorter than the par beside
   * it and never showed the answer at all.
   */
  /** The answer, as **tokens**. Written out through `lexicon` — see `say`. */
  path: readonly string[];
  /** Shortcuts: routes shorter than par, which exist because a rarer word cuts a corner. */
  secrets?: readonly (readonly string[])[];
  /**
   * How a token is written and said. The dev bar lists routes, and a route in the phonemes game
   * is a row of phoneme codes until this turns it back into words.
   */
  lexicon?: Lexicon;
  /**
   * Every pair in the bank and its address, for finding a board by its two words — null until
   * it has been fetched, which is on the first keystroke into the lookup. See `loadPairs`.
   */
  pairs?: readonly Pair[] | null;
  /** Ask for the pair index. Called when the lookup is first used and not before. */
  onNeedPairs?: () => void;
  /** Open a board by its address, which is how the lookup arrives at one. */
  onOpenId?: (id: string) => void;
  /**
   * Take a shared board's code apart, against the board on screen. See `ReadCode`.
   *
   * A function rather than the data, because what a code says depends on the puzzle and the
   * graph, and neither belongs in the chrome. Absent means no inspector — the bar is drawn
   * before the graph has arrived.
   */
  onReadCode?: ((code: string) => Promise<Reading | null>) | undefined;
  guesses: number;
  onGo: (index: number) => void;
  onSolve: () => void;
  /** Label every word on the board, for judging whether the puzzle is any good. */
  onNameAll: () => void;
  onReset: () => void;
  /** Put the instruments away and look at the game as a player sees it. */
  onHide: () => void;
}

/** Every control here is the same flat outlined thing. */
function Key({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="border border-neutral-700 px-1.5 hover:border-neutral-500 hover:text-neutral-200"
      aria-label={label}
      type="button"
    >
      {children}
    </button>
  );
}

/** `name value`, the only other shape in the bar. */
function Stat({
  name,
  children,
}: {
  name: (typeof says)[keyof typeof says];
  children: React.ReactNode;
}) {
  return (
    <span>
      <FormattedMessage {...name} /> <span className="text-neutral-200">{children}</span>
    </span>
  );
}

/** How many words a dropdown offers. Enough to choose from, few enough to read. */
const SUGGESTIONS = 8;

/**
 * Find a board by the two words it is about.
 *
 * Ids are digests and they change with every rebuild, so the id written down beside a puzzle
 * yesterday names nothing today — while `warming → scolding` still means the same board. This
 * is the way back to one: type either word, take a suggestion, and go.
 *
 * The index behind it is 3.7MB and is not part of what a player loads, so it is fetched on the
 * first keystroke here and not before. Until it arrives the field says so, because a lookup
 * that silently offers nothing is indistinguishable from a lookup with no answer.
 */
function FindPair({
  pairs,
  onNeed,
  onOpen,
}: {
  pairs: readonly Pair[] | null;
  onNeed: (() => void) | undefined;
  onOpen: ((id: string) => void) | undefined;
}) {
  const intl = useIntl();
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');

  /**
   * What each field offers, and the pair the two of them name.
   *
   * The target's suggestions are the words that *pair with this source*, not every target in
   * the bank: the point of the lookup is to reach a board, and a target the source has no
   * puzzle with is a suggestion that cannot be taken.
   */
  const { sources, targets, found } = useMemo(() => {
    if (!pairs) return { sources: [], targets: [], found: null };
    const from = source.trim().toLowerCase();
    const to = target.trim().toLowerCase();

    const matching = from ? pairs.filter((pair) => pair.source.startsWith(from)) : pairs;
    const exact = matching.filter((pair) => pair.source === from);
    const withSource = exact.length > 0 ? exact : matching;

    const pick = (words: Iterable<string>) => [...new Set(words)].slice(0, SUGGESTIONS);
    return {
      sources: pick(matching.map((pair) => pair.source)),
      targets: pick(
        withSource.filter((pair) => pair.target.startsWith(to)).map((pair) => pair.target),
      ),
      found: withSource.find((pair) => pair.source === from && pair.target === to) ?? null,
    };
  }, [pairs, source, target]);

  const field = (
    value: string,
    set: (next: string) => void,
    list: string,
    which: 'source' | 'target',
    options: readonly string[],
  ) => (
    <>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        onFocus={() => !pairs && onNeed?.()}
        list={list}
        placeholder={intl.formatMessage(
          pairs ? (which === 'source' ? says.findSource : says.findTarget) : says.findWaiting,
        )}
        aria-label={intl.formatMessage(says.findLabel, { which })}
        autoComplete="off"
        className="w-24 border border-neutral-700 bg-transparent px-1.5 py-0.5 outline-none focus:border-neutral-500"
      />
      <datalist id={list}>
        {options.map((word) => (
          <option key={word} value={word} />
        ))}
      </datalist>
    </>
  );

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (found) onOpen?.(found.id);
      }}
    >
      {field(source, setSource, 'dev-sources', 'source', sources)}
      <Arrow className="text-neutral-600" />
      {field(target, setTarget, 'dev-targets', 'target', targets)}
      <Key
        onClick={() => {
          if (found) onOpen?.(found.id);
        }}
        label={intl.formatMessage(says.openPair)}
      >
        <FormattedMessage {...(found ? says.open : pairs ? says.noPair : says.find)} />
      </Key>
    </form>
  );
}

/**
 * A shared board's code, taken apart.
 *
 * **The one thing a bit-packed format cannot be read by looking at it.** `Vt3xAqZ_` is eight
 * characters that mean a round, and the only honest way to see what they say is to have the
 * codec itself read them and report as it goes — which is `explain` in boardCode.ts, the
 * reader with its trace turned on. Nothing here decodes anything; it draws what came back.
 *
 * Three things, in the order the question is usually asked. **Where the length goes** first,
 * because that is what somebody looking at a long code wants: bits per kind of field, dearest
 * first, which is what says at a glance that a round's cost is its hints rather than its
 * guesses. Then what it *says* — the series of actions, which is the round in words. Then the
 * dump, field by field, for when one of those two does not add up.
 *
 * **Read against the board on screen**, because a code only means anything against the puzzle
 * it was written for: the same characters read against another board are either refused or a
 * different round. So the commonest refusal here is a code pasted while looking at the wrong
 * board, and the message says so rather than calling the code malformed.
 */
function ReadCode({
  read,
}: {
  read: ((code: string) => Promise<Reading | null>) | undefined;
}) {
  const intl = useIntl();
  const [typed, setTyped] = useState('');
  /** The code that was submitted, and what came of it. Null while nothing is open. */
  /**
   * What was asked about, and what came of it.
   *
   * `shown` is what to print at the top — the last segment or two of whatever was pasted, so a
   * whole URL does not fill the panel — while `code` is the code alone, because the character
   * count in the heading is a fact about the code and not about how it was written down.
   */
  const [open, setOpen] = useState<{
    shown: string;
    code: string;
    of: Reading | null;
    waiting?: boolean;
  } | null>(null);

  if (!read) return null;

  const spend = open?.of ? spending(open.of.fields) : [];
  const bits = spend.reduce((sum, one) => sum + one.bits, 0);

  /**
   * Take what is in the field apart.
   *
   * Called from both the form and the button rather than left to the form alone, because
   * `Key` is `type="button"` by design — every other one in this bar is an action and not a
   * submit — so a button inside the form does not submit it. Pressing Enter worked and
   * clicking "read" did nothing at all.
   */
  const look = () => {
    const said = typed.trim();
    if (!said) return;
    /*
      **Whatever was pasted, verbatim.** A bare code, `{id}/{code}`, or a whole URL with either
      on the end of it — App's `readCode` is where that is pulled apart, because whether the
      segment before the code is an id is a question about the bank and not about this field.
      Anything that refuses the input people actually have to hand is an inspector nobody uses.

      Asynchronous because an id may name a board in another shard, and another game's graph.
      The panel opens at once and says it is reading rather than waiting to appear, so a slow
      fetch looks like a fetch and not like a dead button.
    */
    const parts = said.split('/').filter(Boolean);
    const at = { shown: parts.slice(-2).join('/'), code: parts.at(-1) ?? '' };
    setOpen({ ...at, of: null, waiting: true });
    void read(said).then(
      (of) => setOpen({ ...at, of }),
      () => setOpen({ ...at, of: null }),
    );
  };

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          look();
        }}
        className="flex items-center gap-1"
      >
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={intl.formatMessage(says.code)}
          aria-label={intl.formatMessage(says.codeLabel)}
          className="w-28 border border-neutral-700 bg-transparent px-1.5 py-0.5 outline-none focus:border-neutral-500"
        />
        {/* No label of its own: "read" is on the face of it, and a second control answering
            to the field's name makes "the code box" ambiguous to anything asking by name. */}
        <Key onClick={look}>
          <FormattedMessage {...says.readCode} />
        </Key>
      </form>

      {open && (
        /*
          Over everything, because the dump is long and the bar is one line. Fixed rather than
          in the flow: the board is still behind it and this is an instrument, not a page.
        */
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="border-rule bg-noir-3 max-h-full w-full max-w-3xl overflow-y-auto border p-4 font-mono text-[11px] text-neutral-400">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <span className="break-all text-neutral-200">{open.shown}</span>
              <Key onClick={() => setOpen(null)}>
                <FormattedMessage {...says.closeCode} />
              </Key>
            </div>

            {open.waiting ? (
              <p className="text-neutral-500">
                <FormattedMessage {...says.codeReading} />
              </p>
            ) : open.of === null ? (
              <p className="text-blood-lit">
                <FormattedMessage {...says.codeRefused} />
              </p>
            ) : (
              <>
                <p className="mb-3 text-neutral-500">
                  <FormattedMessage
                    {...says.codeTitle}
                    values={{ chars: open.code.length, bits }}
                  />
                </p>

                <p className="mt-3 mb-1 font-semibold tracking-wider text-neutral-500">
                  <FormattedMessage {...says.codeSpend} />
                </p>
                {spend.map((one) => (
                  <p key={one.name} className="flex gap-3">
                    <span className="w-24 shrink-0 text-neutral-200">{one.name}</span>
                    <span className="w-16 shrink-0 text-right">{one.bits}</span>
                    <span className="w-10 shrink-0 text-right text-neutral-600">
                      <Times />
                      {one.count}
                    </span>
                    {/*
                      A bar, because the whole point is the comparison and a column of numbers
                      is the shape that hides it. Widths are a share of the dearest row rather
                      than of the total, so the smallest rows are still visible.
                    */}
                    <span
                      aria-hidden
                      className="bg-gilt-dim mt-1.5 h-1.5 self-start"
                      style={{ width: `${(one.bits / (spend[0]?.bits || 1)) * 40}%` }}
                    />
                  </p>
                ))}

                <p className="mt-4 mb-1 font-semibold tracking-wider text-neutral-500">
                  <FormattedMessage {...says.codeActions} />
                </p>
                {open.of.actions.map((action, at) => (
                  <p key={at} className="break-all">
                    <span className="text-neutral-600">{String(at + 1).padStart(3)} </span>
                    {JSON.stringify(action)}
                  </p>
                ))}

                <p className="mt-4 mb-1 font-semibold tracking-wider text-neutral-500">
                  <FormattedMessage {...says.codeFields} />
                </p>
                {open.of.fields.map((field, at) => (
                  <p key={at} className="flex gap-3">
                    <span className="w-10 shrink-0 text-right text-neutral-600">{field.at}</span>
                    <span className="w-24 shrink-0 text-neutral-200">{field.name}</span>
                    <span className="w-28 shrink-0 break-all">{field.bits}</span>
                    <span className="text-neutral-500">{field.says}</span>
                  </p>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Memoised for the same reason as the rest: the plate's own motion re-renders App on
// every frame, and the instruments have nothing to say about any of them.
export const DevBar = memo(function DevBar({
  index,
  total,
  puzzle,
  drawn,
  path,
  secrets = [],
  lexicon = PLAIN,
  pairs = null,
  onNeedPairs,
  onOpenId,
  onReadCode,
  guesses,
  onGo,
  onSolve,
  onNameAll,
  onReset,
  onHide,
}: Props) {
  /**
   * A token as a person reads it: the word, and how it is said where that is not the same
   * thing. The dev bar is the one place that wants both at once — it is for judging whether a
   * puzzle is any good, and in the phonemes game that question is about the sounds.
   */
  const say = (token: string) =>
    lexicon.translated ? `${lexicon.label(token)} /${lexicon.transcribe(token)}/` : token;

  const intl = useIntl();
  const [jump, setJump] = useState('');

  const step = (delta: number) => onGo((index + delta + total) % total);

  return (
    <div className="border-rule bg-noir-3 border-b font-mono text-[11px] text-neutral-400">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
        <span className="font-semibold tracking-wider text-neutral-500">
          <FormattedMessage {...says.bar} />
        </span>

        <span className="flex items-center gap-1">
          <Key onClick={() => step(-1)} label={intl.formatMessage(says.prev)}>
            <TrackBack />
          </Key>
          <Key onClick={() => step(1)} label={intl.formatMessage(says.next)}>
            <TrackOn />
          </Key>
        </span>

        <span className="text-neutral-200">
          <FormattedMessage {...says.position} values={{ index: index + 1, total }} />
        </span>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(jump);
            if (Number.isFinite(n) && n >= 1 && n <= total) onGo(n - 1);
            setJump('');
          }}
        >
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value)}
            placeholder={intl.formatMessage(says.goTo)}
            aria-label={intl.formatMessage(says.goToLabel)}
            className="w-16 border border-neutral-700 bg-transparent px-1.5 py-0.5 outline-none focus:border-neutral-500"
          />
        </form>

        <FindPair pairs={pairs} onNeed={onNeedPairs} onOpen={onOpenId} />
        <ReadCode read={onReadCode} />

        {/* The address of the board on screen, which is what a shared link carries. */}
        <Stat name={says.id}>{puzzle.id}</Stat>
        <Stat name={says.par}>{puzzle.par}</Stat>
        <Stat name={says.routes}>{puzzle.shortestPaths}</Stat>
        <span>
          <FormattedMessage {...says.corridor} />
          <Space />
          <span className="text-neutral-200">{puzzle.corridorSize}</span>
          {drawn !== puzzle.corridorSize && (
            <span className="text-neutral-500">
              <Space />
              <Arrow className="text-neutral-600" />
              <Space />
              {drawn}
            </span>
          )}
        </span>
        <Stat name={says.alt}>{puzzle.altNodes}</Stat>
        <Stat name={says.rank}>{puzzle.maxRank}</Stat>
        <Stat name={says.guessed}>{guesses}</Stat>

        <span className="ml-auto flex items-center gap-1.5">
          <Key onClick={onNameAll}>
            <FormattedMessage {...says.nameAll} />
          </Key>
          <Key onClick={onSolve}>
            <FormattedMessage {...says.solve} />
          </Key>
          <Key onClick={onReset}>
            <FormattedMessage {...says.reset} />
          </Key>
          {/* Says the key as well, because with the bar gone it is the only way back. */}
          <Key onClick={onHide} label={intl.formatMessage(says.hideLabel)}>
            <FormattedMessage {...says.hide} />
          </Key>
        </span>

        {/*
          The answer first, then any shortcut under it, each said to be one. Two different
          routes with two different lengths, and a bar that shows one line cannot say which
          it is showing.
        */}
        <p className="w-full break-words text-neutral-500">
          <span className="text-neutral-600">
            <FormattedMessage {...says.answer} />
            <Space />
          </span>
          {path.length ? path.map(say).join(' → ') : intl.formatMessage(says.noPath)}
        </p>
        {secrets.map((route, i) => (
          <p key={route.join(' ')} className="w-full break-words text-neutral-500">
            <span className="text-gilt-dim">
              <FormattedMessage
                {...says.secret}
                values={{ n: secrets.length > 1 ? String(i + 1) : 'none' }}
              />
              <Space />
            </span>
            <span className="text-neutral-400">{route.map(say).join(' → ')}</span>
          </p>
        ))}
      </div>
    </div>
  );
});
