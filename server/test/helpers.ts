/**
 * A whole server, over an in-memory database and the real shipped bank.
 *
 * **The bank is real and the database is not**, and both halves of that are deliberate. The
 * database is the part that has to be empty at the start of every test, so it is `:memory:` and
 * is thrown away. The bank is the part a stub would make worthless: the whole claim this server
 * makes is that it scores a round by replaying it against the graph the player played on, and a
 * fake graph would test the plumbing around a claim nobody checked. `src/test/shipped.ts` is
 * already the way the unit tests and the Playwright fixtures read that data, and this is the
 * third caller.
 *
 * So these tests need `public/data/` — `npm run data` at the repo root — exactly as the rest of
 * the suite does.
 */

import { createApp } from '../src/app';
import type { Bank } from '../src/bank';
import { openDb } from '../src/db';
import { migrate } from '../src/db/migrate';
import type { Env } from '../src/env';
import { limiter, type Rate, type Bucket } from '../src/limit';
import { shippedData } from '../../src/test/shipped';
import type { Puzzle } from '../../src/lib/types';

export const TEST_ENV: Env = {
  origins: ['http://localhost:5173'],
  data: 'http://example.invalid/data/',
  db: ':memory:',
  port: 0,
  proxied: false,
};

/**
 * The real letters-short data, as a `Bank`.
 *
 * `shippedData` loads the shard holding *today*, which is a couple of hundred puzzles and not
 * the whole bank — so a test picks its puzzle out of `puzzles` rather than assuming any
 * particular one is there. See the note in shipped.ts about shard order not being calendar
 * order.
 */
export function shippedBankOf(band = 0): { bank: Bank; puzzles: Puzzle[] } {
  const data = shippedData(band);
  const bank: Bank = {
    manifest: data.manifest,
    puzzle: (id) => Promise.resolve(data.puzzles.find((one) => one.id === id) ?? null),
    graphFor: () => Promise.resolve(data.graph),
    reload: () => Promise.resolve(),
  };
  return { bank, puzzles: data.puzzles };
}

export interface Harness {
  app: ReturnType<typeof createApp>;
  /** Move the clock, for testing anything that refills or expires. */
  tick(ms: number): void;
  close(): void;
  /** `fetch`, with the base and the JSON headers filled in. */
  call(
    path: string,
    init?: { method?: string; body?: unknown; token?: string | null },
  ): Promise<{ status: number; body: any }>;
}

export function harness(
  bank: Bank,
  options: { rates?: Record<Bucket, Rate>; env?: Partial<Env> } = {},
): Harness {
  const { handle, db } = openDb(':memory:');
  migrate(handle);

  let clock = Date.UTC(2026, 0, 1);
  const limits = options.rates ? limiter(options.rates) : limiter();
  const app = createApp({
    db,
    bank,
    env: { ...TEST_ENV, ...options.env },
    limits,
    now: () => clock,
  });

  return {
    app,
    tick: (ms) => {
      clock += ms;
    },
    close: () => handle.close(),
    async call(path, init = {}) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (init.token) headers.authorization = `Bearer ${init.token}`;
      const res = await app.request(path, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}
