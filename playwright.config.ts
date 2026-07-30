import { defineConfig, devices } from '@playwright/test';

/**
 * Against a **production build**, not the dev server, unless `RECURSE_E2E_DEV=1`.
 *
 * A page load is the dominant cost of this suite — 112 tests, and the fastest of them takes
 * three and a half seconds — so what the page costs to load is what the suite costs to run. A
 * CPU profile of one load says why the dev server is the wrong thing to measure against:
 *
 *     dev server                       production build
 *     4338ms wall                      2211ms wall
 *       866ms (program)                  1071ms (program)
 *       849ms (idle)                      498ms (idle)
 *       188ms decodeGameData              102ms (same, minified)
 *       123ms buildGraph
 *       115ms jsxDEV  <-- development React
 *
 * Twice as fast, and for a reason that has nothing to do with the app: the dev server ships
 * unminified *development* React, which renders slower and double-invokes every effect under
 * StrictMode. None of that is what the tests are about.
 *
 * Built to its own directory at base `/`, which is two deliberate choices. Its own directory so
 * a test run never leaves a `dist/` that would deploy wrong; base `/` so the URLs the specs build
 * are the ones the app serves — the real build uses `/recurse/` for Pages, and that difference
 * belongs to the deploy rather than to the tests.
 *
 * No `reuseExistingServer` here either: reuse would skip the build, and a suite that quietly
 * tests the previous commit is worse than a slow one.
 */
const DEV = process.env.RECURSE_E2E_DEV === '1';
const OUT = 'dist-e2e';

/**
 * Playwright drives the real game: it plays actual puzzles end to end and takes
 * screenshots, so gameplay and layout are checked rather than assumed.
 *
 * Phone first, because that is the target, with a desktop project to catch the
 * wide layout.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // A share of the cores rather than a fixed count, so a big machine is used and a
  // small one is not thrashed — but a *quarter*, not a half, because a worker is not
  // one core's worth of work. A page load is ~4.9MB of word data and a 269k-edge
  // graph, and every board settles a force layout in a browser that also has a
  // compositor and a raster thread; oversubscribe it and Playwright's actionability
  // checks start waiting on a starved page, which burns CPU polling rather than
  // making progress.
  //
  // Measured on sixteen cores, the same eighteen tests:
  //
  //     workers  wall    CPU
  //     2        33.6s   61s
  //     4        30.7s   94s
  //     6        42.5s   172s
  //     8        42.2s   170s
  //
  // Past four it gets slower *and* costs three times the energy, which is the shape
  // of contention rather than of work. Half the cores was set when a load cost twice
  // what it does now, and it was over the knee even then.
  workers: process.env.CI ? 2 : '25%',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  outputDir: './e2e/.results',
  use: {
    baseURL: DEV ? 'http://localhost:5173' : 'http://localhost:4173',
    trace: 'retain-on-failure',
    // Every test that is not *about* the opening sequence asks not to see it, the same
    // way a player with reduced-motion set does. That is the real code path rather than
    // a test-only switch, and it keeps ninety page loads from each sitting through two
    // seconds of title card. `opening.spec.ts` opts back in.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    // Chromium-based so a plain `playwright install chromium` is enough. The
    // iPhone profiles are WebKit; worth adding before shipping to iOS, but not
    // worth a second browser download to check layout and gameplay.
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: DEV
    ? {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : {
        command: `npx vite build --base=/ --outDir ${OUT} && npx vite preview --port 4173 --base=/ --outDir ${OUT}`,
        url: 'http://localhost:4173',
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
