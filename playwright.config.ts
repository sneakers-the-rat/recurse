import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:5173',
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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
