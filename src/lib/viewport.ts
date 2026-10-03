/**
 * Holds a `.fits-view` board still under an on-screen keyboard, and lifts `.above-keyboard`
 * (the guess bar) onto it.
 *
 * A browser shows a keyboard by shrinking the visual viewport and panning it down to the input,
 * which carries the header off the top. The board is moved back down by that pan
 * (`--view-top`), so nothing on it moves and the keyboard lies over its lower part; the guess
 * bar rises by the keyboard's height (`--keyboard`). The plate keeps its size, so the camera is
 * untouched. Both variables are read in index.css and unset while there is no keyboard.
 */

/** Start following the visual viewport. Returns the way to stop. */
export function fitToKeyboard(): () => void {
  const view = window.visualViewport;
  if (!view) return () => {};
  const root = document.documentElement;

  const read = () => {
    const covered = root.clientHeight - view.height;
    // A pinch zoom shrinks the visual viewport too, and is not a keyboard.
    if (Math.abs(view.scale - 1) < 0.01 && covered > 1) {
      // In page coordinates, because the board is positioned in the page.
      root.style.setProperty('--view-top', `${view.pageTop}px`);
      root.style.setProperty('--keyboard', `${covered}px`);
    } else {
      root.style.removeProperty('--view-top');
      root.style.removeProperty('--keyboard');
    }
  };

  read();
  view.addEventListener('resize', read);
  view.addEventListener('scroll', read);
  return () => {
    view.removeEventListener('resize', read);
    view.removeEventListener('scroll', read);
  };
}
