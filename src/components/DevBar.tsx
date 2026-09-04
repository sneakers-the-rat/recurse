/**
 * Developer mode: step through the whole puzzle bank instead of just today's.
 *
 * Opt in with `?dev` — deliberately not keyed to the dev server, so a deployed
 * build can be inspected the same way, and so the end-to-end tests exercise the
 * normal chrome unless they ask for this.
 *
 * Stepping is by index, because that is the order the survey lists and the
 * calendar plays; the URL it lands on is the puzzle's id, like any other visit.
 * Nothing here addresses a board by number.
 *
 * Styled as an instrument rather than part of the game: flat mono, no ornament,
 * so a screenshot never gets mistaken for the real thing.
 */

import { memo, useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { dev as says } from '../i18n/messages/dev';
import { Arrow, Space, TrackBack, TrackOn } from './marks';
import type { Pair } from '../lib/data';
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
  path: readonly string[];
  /** Shortcuts: routes shorter than par, which exist because a rarer word cuts a corner. */
  secrets?: readonly (readonly string[])[];
  /**
   * Every pair in the bank and its address, for finding a board by its two words — null until
   * it has been fetched, which is on the first keystroke into the lookup. See `loadPairs`.
   */
  pairs?: readonly Pair[] | null;
  /** Ask for the pair index. Called when the lookup is first used and not before. */
  onNeedPairs?: () => void;
  /** Open a board by its address, which is how the lookup arrives at one. */
  onOpenId?: (id: string) => void;
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

// Memoised for the same reason as the rest: the plate's own motion re-renders App on
// every frame, and the instruments have nothing to say about any of them.
export const DevBar = memo(function DevBar({
  index,
  total,
  puzzle,
  drawn,
  path,
  secrets = [],
  pairs = null,
  onNeedPairs,
  onOpenId,
  guesses,
  onGo,
  onSolve,
  onNameAll,
  onReset,
  onHide,
}: Props) {
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

        {/* The address of the board on screen, which is what the survey quotes. */}
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
          {path.length ? path.join(' → ') : intl.formatMessage(says.noPath)}
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
            <span className="text-neutral-400">{route.join(' → ')}</span>
          </p>
        ))}
      </div>
    </div>
  );
});
