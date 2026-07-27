import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Served from https://<user>.github.io/recurse/ in production, root in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/recurse/' : '/',
  plugins: [react(), tailwindcss()],
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
