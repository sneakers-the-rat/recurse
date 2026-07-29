import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * A copy of the built index.html as 404.html.
 *
 * Puzzles are addressed by path — `/recurse/8e2eec79` — and no such file exists.
 * GitHub Pages has no rewrites, so an unknown path gets 404.html; serving the app
 * from there boots it, and it reads the id out of `location.pathname` as usual.
 * The status line stays 404, which nothing but a crawler ever notices. Vite's own
 * dev and preview servers fall back to index.html on their own, so this is only
 * ever needed for the deployed build.
 */
function pagesFallback(): Plugin {
  return {
    name: 'recurse-pages-fallback',
    apply: 'build',
    closeBundle() {
      const out = join(process.cwd(), 'dist');
      writeFileSync(join(out, '404.html'), readFileSync(join(out, 'index.html')));
    },
  };
}

// Served from https://<user>.github.io/recurse/ in production, root in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/recurse/' : '/',
  plugins: [react(), tailwindcss(), pagesFallback()],
  server: { port: 5173 },
  // The unit tests are all `src/lib` — pure logic over the real shipped data, no
  // DOM. What the components do is checked by Playwright in a real browser, which
  // is the only place a force layout means anything, so there is nothing here for
  // jsdom to do.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
