/**
 * Whether the dev instruments are showing, shared by both games. Off unless asked for.
 *
 * `?dev`, the switch in the help panel and Ctrl+D are one toggle, and toggling keeps `?dev` in
 * the URL in step so a reload keeps it. Ctrl because GuessBar sends bare keys to the guess field.
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
