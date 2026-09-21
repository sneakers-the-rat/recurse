/**
 * Whether the instrument panel is showing, and a way to turn it on and off *in place*.
 *
 * **Off unless asked for, everywhere.** It used to come up by itself in a development
 * build, which meant the game as written was never the game as seen: every `npm run dev`
 * page load, and most of what gets looked at while working, arrived with a bar of
 * instruments across the top of it.
 *
 * Asking is `?dev`, the switch in the help panel, or Ctrl+D, and all three are the same
 * toggle. The keystroke needs a keyboard and the parameter needs a URL bar, so on a phone
 * the switch is the only one of the three there is — and inspecting a real board on a real
 * phone is most of what the panel is for.
 *
 * The `dev` parameter is kept in step either way, so a reload holds whichever was chosen and
 * the state of the instruments is a thing that can be sent to somebody. Ctrl rather than a
 * bare key because GuessBar sends unmodified keystrokes to the guess field, where a shortcut
 * would arrive as a letter.
 *
 * **One toggle for every game there is.** Both boards ask it, so it is here rather than in the
 * daily game's shell: the switch is about the page and not about a puzzle, and a second copy of
 * it would be a second `?dev` that disagreed with the first on the way between two screens.
 */

import { useCallback, useEffect, useState } from 'react';

export function useDevMode(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    const flag = new URLSearchParams(window.location.search).get('dev');
    return flag !== null && flag !== '0' && flag !== 'false';
  });

  const toggle = useCallback(() => {
    setOn((was) => {
      const next = !was;
      const url = new URL(window.location.href);
      url.searchParams.set('dev', next ? '1' : '0');
      window.history.replaceState(null, '', url);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || !event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      event.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return [on, toggle];
}
