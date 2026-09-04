import { describe, expect, it } from 'vitest';
import { SOURCE_LOCALE, localeFor, pickLocale } from './locale';

/** What the game will speak once there is more than English to speak. */
const OFFERED = ['en', 'fr', 'pt-BR'];

describe('picking a locale', () => {
  it('takes an exact tag', () => {
    expect(pickLocale(['fr'], OFFERED)).toBe('fr');
  });

  it('matches a region-specific tag by its language', () => {
    expect(pickLocale(['fr-CA'], OFFERED)).toBe('fr');
  });

  it('ignores case, since a URL is something people type', () => {
    expect(pickLocale(['FR-ca'], OFFERED)).toBe('fr');
    expect(pickLocale(['PT-br'], OFFERED)).toBe('pt-BR');
  });

  /*
   * The bug this is here to stop coming back. Matching every exact tag across the list
   * before any truncated one hands this browser Portuguese, because `pt-BR` is present
   * exactly and French is only reachable by dropping a subtag. A first preference is a
   * first preference: `fr-CA` means French.
   */
  it('honours preference order over exactness further down the list', () => {
    expect(pickLocale(['fr-CA', 'pt-BR'], OFFERED)).toBe('fr');
  });

  /** The other direction, which truncation cannot reach: plain `pt` wants `pt-BR`. */
  it('matches a bare language against a region-specific locale', () => {
    expect(pickLocale(['pt'], OFFERED)).toBe('pt-BR');
  });

  it('falls back to the source language when nothing matches', () => {
    expect(pickLocale(['ja', 'ko'], OFFERED)).toBe(SOURCE_LOCALE);
    expect(pickLocale([], OFFERED)).toBe(SOURCE_LOCALE);
  });
});

describe('what a visit is read in', () => {
  it('lets the URL win over the browser', () => {
    expect(localeFor('?locale=fr', ['en'], OFFERED)).toBe('fr');
  });

  it('takes the browser when the URL says nothing', () => {
    expect(localeFor('', ['fr-CA', 'en'], OFFERED)).toBe('fr');
  });

  /*
   * A URL is something people edit and forward. A locale nobody has words for should
   * leave a playable board in a language the browser asked for, the same way an id that
   * names no puzzle falls back to today's board rather than to an error page.
   */
  it('falls through a locale it does not have to the browser', () => {
    expect(localeFor('?locale=ja', ['fr'], OFFERED)).toBe('fr');
  });

  it('survives a query string with no locale in it at all', () => {
    expect(localeFor('?dev', ['fr'], OFFERED)).toBe('fr');
  });
});
