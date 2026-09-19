/**
 * The server's tests, which read the real bank off disk.
 *
 * Generous timeouts and a single thread, both for the same reason: building the graph costs
 * about a second and 59MB of JSON, and every worker that did it in parallel would do it again.
 * The suite is small enough that serial is faster than paying that per worker.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
