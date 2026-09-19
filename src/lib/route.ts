/**
 * The URL a board lives at.
 *
 * One puzzle, one address: `{base}{id}`, where the id is the digest the builder
 * gave it (see tools/graphgen/src/id.rs) and the base is where the site is served
 * from — `/recurse/` on Pages, `/` in dev. So today's puzzle is
 * `https://sneakers-the-rat.github.io/recurse/8e2eec79`, and that link keeps
 * working after today, which is the whole point of the scheme: a shared board is
 * still there when the person you sent it to opens it.
 *
 * Ids are addresses, not indices. `/12` invites reading `/13` — tomorrow's puzzle
 * — so nothing enumerable is ever in the path.
 *
 * **A board can carry a round with it**, in a second segment: `{base}{id}/{code}`, where the
 * code is what boardCode.ts writes — the guesses, the hints and the marks of a round somebody
 * played. That is what a shared board is, and the id alone is still the address of the puzzle
 * itself. The shape of a code is base64url and this module knows no more about it than that:
 * whether it *means* anything is boardCode's question, the same way whether an id names a
 * puzzle is the bank's.
 *
 * Only `pathFor` and `idFromPath` know the shape, and they are inverses. Anything
 * that wants to know which puzzle a URL names asks daily.ts, which asks here.
 *
 * A path this does not recognise is not an error to report, just a path with no id
 * in it: the caller falls back to today. Playing today's puzzle is the right
 * answer to a mistyped URL, an old link, and a bare visit alike.
 */

/**
 * Hex, four digits or more. Deliberately looser than the eight the builder emits:
 * `RECURSE_ID_CHARS` can change, and a client that only recognised the current
 * length would stop resolving every link shared at the old one.
 */
const ID = /^[0-9a-f]{4,64}$/;

/**
 * A board state, as the second segment of a board's path.
 *
 * Base64url, which is the alphabet boardCode.ts writes in — case-sensitive, and every
 * character of it safe in a path segment without escaping. Nothing here says how long one
 * is: a code grows with the round, and a length limit here would be a rule about how much
 * of a game may be shared.
 */
const CODE = /^[A-Za-z0-9_-]+$/;

/**
 * Where the site is served from, with its trailing slash.
 *
 * Read inside the function, never at module scope: the end-to-end fixtures import
 * this module in plain Node, where `import.meta.env` does not exist. Reading it on
 * load once made the whole suite die on import — see the same note in data.ts.
 */
export function base(): string {
  return import.meta.env?.BASE_URL ?? '/';
}

/**
 * The paths that are not boards.
 *
 * Four of them: the archive of everything already played, the record of how the player has
 * done, the walkthrough, and one game's rules. Words rather than digests, so none can ever
 * collide with an id — `ID` is hex only, and `puzzles`, `stats`, `tutorial` and `rules` are
 * not. That is also why they need no special case in `idFromPath`: a path this does not
 * recognise as an id already means "no board named here", and these are four of those.
 *
 * **The tutorial is the odd one of the four.** The others replace the board; the tutorial *is*
 * a board — one particular puzzle, played for real, with a lesson over it — so its path stays
 * in the address bar rather than being rewritten to that puzzle's id. Which board it teaches
 * on is the lesson's business and not this module's; see `lib/tutorial.ts`.
 *
 * **The rules page is the only one with a second segment**: `rules/phonemes`, because the rules
 * it states are one game's and there is more than one game. The mode is carried in the path
 * rather than off the board on screen so the page can be linked to — it is a thing somebody
 * sends somebody else, which is the whole reason it is a page and not a panel.
 */
export type Page = 'archive' | 'stats' | 'tutorial' | 'rules' | 'explore';

const PAGES: Record<Page, string> = {
  archive: 'puzzles',
  stats: 'stats',
  tutorial: 'tutorial',
  rules: 'rules',
  explore: 'explore',
};

/** The first segment of a path, with the base and any trailing segments taken off. */
function segment(path: string, from: string): string {
  return segments(path, from)[0]?.toLowerCase() ?? '';
}

/** Every segment, for the one page that has more than one. */
function segments(path: string, from: string): string[] {
  const withoutBase = path.startsWith(from) ? path.slice(from.length) : path.replace(/^\//, '');
  return withoutBase.split('/');
}

/**
 * What a page's second segment says, or null when it has none.
 *
 * Two pages take one and they mean different things by it: `rules/{mode}` names the game
 * whose rules are being stated, and `explore/{atlas}` names which of somebody's saved maps is
 * open. Neither is checked here — which modes and which atlases are real is the manifest's
 * business and the browser's respectively. A name this does not know is a page with nothing
 * to say, the same way an unknown id is a board that is not there.
 *
 * A bare `rules` or `explore` answers null rather than guessing, and so does any other path.
 */
export function pageArg(page: Page, path: string, from: string = base()): string | null {
  const parts = segments(path, from);
  if (parts[0]?.toLowerCase() !== PAGES[page]) return null;
  const arg = parts[1]?.toLowerCase() ?? '';
  return arg === '' ? null : arg;
}

/** The id a path names, or null if it names none. */
export function idFromPath(path: string, from: string = base()): string | null {
  const first = segment(path, from);
  return ID.test(first) ? first : null;
}

/**
 * The board state a path carries, or null when it carries none.
 *
 * Only ever read for a path that names a board, because a code is about a puzzle and means
 * nothing without one — `rules/phonemes` has a second segment too, and it is not this.
 * Case is kept, unlike the id and the pages: the code is base64url, where `a` and `A` are
 * different six-bit values, and lowercasing one would quietly decode to another board.
 */
export function stateFromPath(path: string, from: string = base()): string | null {
  const parts = segments(path, from);
  if (!ID.test((parts[0] ?? '').toLowerCase())) return null;
  const code = parts[1] ?? '';
  return CODE.test(code) ? code : null;
}

/** Which page a path names, or null when it names a board or nothing at all. */
export function pageFromPath(path: string, from: string = base()): Page | null {
  const first = segment(path, from);
  const found = (Object.keys(PAGES) as Page[]).find((page) => PAGES[page] === first);
  return found ?? null;
}

/**
 * Where a page lives. `search` is carried through so `?dev` survives a visit to it.
 *
 * `of` is the second segment, which only the rules page has: `pagePath('rules', '', base,
 * 'phonemes')`. Left off, a page is its bare name, which is what the other three are.
 */
export function pagePath(
  page: Page,
  search: string = '',
  from: string = base(),
  of?: string,
): string {
  return `${from}${PAGES[page]}${of === undefined ? '' : `/${of}`}${search}`;
}

/**
 * The path for a puzzle. `search` is carried through untouched, because `?dev`
 * has to survive stepping from one board to the next.
 *
 * `code` is a round to open the board with — see `stateFromPath`. Left off, the path is the
 * puzzle and nothing else, which is what playing it is: the address always names the board on
 * screen, so a player who takes a shared board over drops the segment by coming through here
 * without one.
 */
export function pathFor(
  id: string,
  search: string = '',
  from: string = base(),
  code?: string | undefined,
): string {
  return `${from}${id}${code ? `/${code}` : ''}${search}`;
}

/**
 * The whole link, for copying. `origin` is `window.location.origin`.
 *
 * With a `code`, this is the link that carries a round with it — what the share text pastes,
 * so that what somebody opens is the board, not a description of it.
 */
export function shareUrl(
  id: string,
  origin: string,
  from: string = base(),
  code?: string | undefined,
): string {
  return `${origin}${pathFor(id, '', from, code)}`;
}
