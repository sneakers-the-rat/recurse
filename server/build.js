/**
 * One file to run, because the server imports the client's game logic.
 *
 * `src/lib` is written for a bundler: extensionless relative imports, which node's own resolver
 * will not follow. Rather than change how the client is written to suit a server that is
 * optional, the server is bundled — esbuild resolves exactly what the browser's bundler resolves
 * and emits `dist/main.js`, which plain node runs with no loader and no flags.
 *
 * Everything in `node_modules` stays external. `better-sqlite3` has to — it is a native binding
 * and cannot be inlined — and the rest are left alongside it so that what is deployed is an
 * ordinary node project: `npm ci --omit=dev` and the file below.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
