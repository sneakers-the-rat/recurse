/**
 * URLs, which are the one part of the game a player can hold in their hand and
 * paste somewhere. Both directions are tested against both bases, because the app
 * is served from `/` in dev and `/recurse/` on Pages and got the second one wrong
 * for as long as nothing checked it.
 */

import { describe, expect, it } from 'vitest';
import {
  idFromPath,
  modeFromPath,
  pageFromPath,
  pagePath,
  pathFor,
  shareUrl,
  stateFromPath,
} from './route';

const PAGES = '/recurse/';

describe('idFromPath', () => {
  it('reads the id out of a path, at either base', () => {
    expect(idFromPath('/2ed94464', '/')).toBe('2ed94464');
    expect(idFromPath('/recurse/2ed94464', PAGES)).toBe('2ed94464');
  });

  it('ignores a trailing slash and anything after the id', () => {
    expect(idFromPath('/2ed94464/', '/')).toBe('2ed94464');
    expect(idFromPath('/recurse/2ed94464/anything', PAGES)).toBe('2ed94464');
  });

  it('takes an id in capitals, since a link can be pasted anywhere', () => {
    expect(idFromPath('/2ED94464', '/')).toBe('2ed94464');
  });

  it('finds nothing in a path that names no puzzle', () => {
    for (const path of ['/', PAGES, '', '/about', '/2ed9446z', '/12']) {
      expect(idFromPath(path, path.startsWith(PAGES) ? PAGES : '/')).toBeNull();
    }
  });

  it('finds no id in either of the pages, because neither is hex', () => {
    // The whole reason the pages need no special case here: `puzzles` and `stats` cannot
    // be read as digests, so "not an id" already means "no board named here".
    expect(idFromPath('/puzzles', '/')).toBeNull();
    expect(idFromPath('/stats', '/')).toBeNull();
  });

  it('accepts a length other than the one the builder currently emits', () => {
    // RECURSE_ID_CHARS can change; every link shared at the old length would stop
    // resolving if this only recognised the current one.
    expect(idFromPath('/2ed9', '/')).toBe('2ed9');
    expect(idFromPath('/2ed944642ed94464', '/')).toBe('2ed944642ed94464');
  });
});

describe('pathFor', () => {
  it('is the inverse of idFromPath', () => {
    for (const base of ['/', PAGES]) {
      expect(idFromPath(pathFor('2ed94464', '', base), base)).toBe('2ed94464');
    }
  });

  it('carries the query string over, so ?dev survives a step', () => {
    expect(pathFor('2ed94464', '?dev', PAGES)).toBe('/recurse/2ed94464?dev');
    expect(idFromPath('/recurse/2ed94464?dev'.split('?')[0]!, PAGES)).toBe('2ed94464');
  });
});

describe('pageFromPath', () => {
  it('names the two pages that are not boards, at either base', () => {
    expect(pageFromPath('/puzzles', '/')).toBe('archive');
    expect(pageFromPath('/stats', '/')).toBe('stats');
    expect(pageFromPath('/recurse/puzzles', PAGES)).toBe('archive');
    expect(pageFromPath('/recurse/stats', PAGES)).toBe('stats');
  });

  it('ignores case and anything after the page, the way ids are read', () => {
    expect(pageFromPath('/STATS/', '/')).toBe('stats');
    expect(pageFromPath('/puzzles/anything', '/')).toBe('archive');
  });

  it('names no page for a board, or for a path with nothing in it', () => {
    for (const path of ['/', '/2ed94464', '/about', '']) {
      expect(pageFromPath(path, '/')).toBeNull();
    }
  });

  it('is the inverse of pagePath', () => {
    for (const base of ['/', PAGES]) {
      for (const page of ['archive', 'stats'] as const) {
        expect(pageFromPath(pagePath(page, '', base), base)).toBe(page);
      }
    }
  });

  it('carries the query string over, so ?dev survives a visit to a page', () => {
    expect(pagePath('stats', '?dev', PAGES)).toBe('/recurse/stats?dev');
  });
});

/**
 * The rules page is the only one with a second segment, because the rules it states belong to
 * one game and there is more than one game.
 */
describe('the rules page and the game it is of', () => {
  it('is a page like the others, with its game after it', () => {
    expect(pagePath('rules', '', PAGES, 'phonemes')).toBe('/recurse/rules/phonemes');
    expect(pageFromPath('/recurse/rules/phonemes', PAGES)).toBe('rules');
    expect(modeFromPath('/recurse/rules/phonemes', PAGES)).toBe('phonemes');
  });

  it('is the inverse of pagePath, game and all', () => {
    for (const base of ['/', PAGES]) {
      const path = pagePath('rules', '', base, 'letters');
      expect(pageFromPath(path, base)).toBe('rules');
      expect(modeFromPath(path, base)).toBe('letters');
    }
  });

  it('keeps the query string after the game, not between it and the page', () => {
    expect(pagePath('rules', '?dev', PAGES, 'phonemes')).toBe('/recurse/rules/phonemes?dev');
  });

  /**
   * Which games are real is the manifest's business. A name this does not recognise is a page
   * with nothing to say — `ModeRules` says so in a sentence — rather than a path to reject,
   * the same way an id naming no puzzle is a board that is not there.
   */
  it('reads whatever game the path names, without judging it', () => {
    expect(modeFromPath('/rules/klingon', '/')).toBe('klingon');
    expect(modeFromPath('/rules/PHONEMES', '/')).toBe('phonemes');
  });

  it('names no game for a bare rules path, or for any other path', () => {
    for (const path of ['/rules', '/rules/', '/stats/phonemes', '/2ed94464', '/']) {
      expect(modeFromPath(path, '/')).toBeNull();
    }
  });

  /** Hex only, and `rules` is not — so the page needs no special case in `idFromPath`. */
  it('is not mistaken for a board', () => {
    expect(idFromPath('/rules/phonemes', '/')).toBeNull();
  });
});

/**
 * A board can carry a round with it, in a second segment. That is what a shared board is —
 * see lib/boardCode.ts — and the id is still the address of the puzzle itself, which is what
 * every test above is about and what keeps working when the code is dropped.
 */
describe('the board state a link carries', () => {
  const CODE = 'JQJZMK5YKRBgQoGI';

  it('is the second segment, at either base', () => {
    expect(stateFromPath(`/2ed94464/${CODE}`, '/')).toBe(CODE);
    expect(stateFromPath(`/recurse/2ed94464/${CODE}`, PAGES)).toBe(CODE);
  });

  it('keeps its case, unlike the id and the pages', () => {
    // Base64url: `a` and `A` are different six-bit values, so lowercasing a code decodes to
    // a different board. The id above it is hex and is lowercased as it always was.
    expect(stateFromPath('/2ED94464/aBcD', '/')).toBe('aBcD');
    expect(idFromPath('/2ED94464/aBcD', '/')).toBe('2ed94464');
  });

  it('is nothing on a path that names no board, or names one and no round', () => {
    for (const path of ['/2ed94464', '/2ed94464/', '/', '/puzzles/anything', '/rules/phonemes']) {
      expect(stateFromPath(path, '/')).toBeNull();
    }
  });

  it('is nothing when the segment could not be a code', () => {
    // The alphabet is the whole of what this module knows about a code. Whether it *means*
    // anything is `decodeBoard`'s question.
    expect(stateFromPath('/2ed94464/not+a+code', '/')).toBeNull();
    expect(stateFromPath('/2ed94464/half code', '/')).toBeNull();
  });

  it('is the inverse of pathFor, and pathFor without one is the board itself', () => {
    for (const base of ['/', PAGES]) {
      const path = pathFor('2ed94464', '', base, CODE);
      expect(idFromPath(path, base)).toBe('2ed94464');
      expect(stateFromPath(path, base)).toBe(CODE);
      // Taking a shared board over is coming back through here without a code — which is
      // also what every other navigation in the game does.
      expect(stateFromPath(pathFor('2ed94464', '', base), base)).toBeNull();
    }
  });

  it('sits before the query string, so ?dev still survives', () => {
    expect(pathFor('2ed94464', '?dev', PAGES, CODE)).toBe(`/recurse/2ed94464/${CODE}?dev`);
  });

  it('does not make a board look like a page', () => {
    expect(pageFromPath(`/2ed94464/${CODE}`, '/')).toBeNull();
    expect(modeFromPath(`/2ed94464/${CODE}`, '/')).toBeNull();
  });
});

describe('shareUrl', () => {
  it('is the whole link, ready to paste', () => {
    expect(shareUrl('2ed94464', 'https://sneakers-the-rat.github.io', PAGES)).toBe(
      'https://sneakers-the-rat.github.io/recurse/2ed94464',
    );
  });

  it('carries no query string, whatever the player was playing with', () => {
    expect(shareUrl('2ed94464', 'http://localhost:5173', '/')).toBe(
      'http://localhost:5173/2ed94464',
    );
  });

  /**
   * The link the share text pastes: the board *and* the round played on it, so what somebody
   * opens is the figure rather than a description of it. Short enough to read in a message —
   * a whole par-8 round is ten characters. See boardCode.ts.
   */
  it('carries the round when there is one, and stays a link somebody can paste', () => {
    const url = shareUrl('2ed94464', 'https://sneakers-the-rat.github.io', PAGES, 'JKKhTIMCFAxA');
    expect(url).toBe('https://sneakers-the-rat.github.io/recurse/2ed94464/JKKhTIMCFAxA');
    expect(url.length).toBeLessThan(80);
    // Nothing in it needs escaping, which is the whole reason the alphabet is base64url.
    expect(encodeURI(url)).toBe(url);
  });
});
