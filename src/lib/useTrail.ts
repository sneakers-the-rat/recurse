/**
 * Back and next through where the player has stood (see trail.ts), from Up and Down and from the
 * guess bar's buttons. The keys are heard on the document, so they work from the guess field too.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Trail, Way } from './trail';

export interface Steps {
  canBack: boolean;
  canNext: boolean;
  back(): void;
  next(): void;
}

export function useTrail(
  /** The board's trail, or null while the board is not showing, which leaves the keys alone. */
  trail: Trail | null,
  /** Take one step along it. See `walk` in trail.ts. */
  step: (way: Way) => void,
): Steps {
  const latest = useRef(step);
  useEffect(() => {
    latest.current = step;
  }, [step]);

  const active = trail !== null;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.shiftKey || document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      latest.current(event.key === 'ArrowUp' ? 'back' : 'next');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const canBack = trail !== null && trail.at > 0;
  const canNext = trail !== null && trail.at < trail.words.length - 1;
  return useMemo(
    () => ({
      canBack,
      canNext,
      back: () => latest.current('back'),
      next: () => latest.current('next'),
    }),
    [canBack, canNext],
  );
}
