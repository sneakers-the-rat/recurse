/**
 * URLs, which are the one part of the game a player can hold in their hand and
 * paste somewhere. Both directions are tested against both bases, because the app
 * is served from `/` in dev and `/recurse/` on Pages and got the second one wrong
 * for as long as nothing checked it.
 */

import { describe, expect, it } from 'vitest';
import { idFromPath, pageFromPath, pagePath, pathFor, shareUrl } from './route';

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
});
