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
  // Each worker downloads ~4.6MB of word data and builds a 269k-edge graph, so
  // six of them on one machine starve each other into timeouts. Two is honest
  // about how heavy a page load this is.
  workers: process.env.CI ? 2 : 3,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  outputDir: './e2e/.results',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
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
