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
 * Where the site is served from, with its trailing slash.
 *
 * Read inside the function, never at module scope: the end-to-end fixtures import
 * this module in plain Node, where `import.meta.env` does not exist. Reading it on
 * load once made the whole suite die on import — see the same note in data.ts.
 */
export function base(): string {
  return import.meta.env?.BASE_URL ?? '/';
}

/** The id a path names, or null if it names none. */
export function idFromPath(path: string, from: string = base()): string | null {
  const withoutBase = path.startsWith(from) ? path.slice(from.length) : path.replace(/^\//, '');
  // First segment only, so a trailing slash or anything appended is ignored.
  const first = withoutBase.split('/')[0]?.toLowerCase() ?? '';
  return ID.test(first) ? first : null;
}

/**
 * The path for a puzzle. `search` is carried through untouched, because `?dev`
 * has to survive stepping from one board to the next.
 */
export function pathFor(id: string, search: string = '', from: string = base()): string {
  return `${from}${id}${search}`;
}

/** The whole link, for copying. `origin` is `window.location.origin`. */
export function shareUrl(id: string, origin: string, from: string = base()): string {
  return `${origin}${pathFor(id, '', from)}`;
}
