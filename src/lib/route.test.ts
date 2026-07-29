/**
 * URLs, which are the one part of the game a player can hold in their hand and
 * paste somewhere. Both directions are tested against both bases, because the app
 * is served from `/` in dev and `/recurse/` on Pages and got the second one wrong
 * for as long as nothing checked it.
 */

import { describe, expect, it } from 'vitest';
import { idFromPath, pathFor, shareUrl } from './route';

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
