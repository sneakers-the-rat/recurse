import { execFile } from 'node:child_process';
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
  /*
   * Wherever this build is actually writing, which is not always `dist`: the end-to-end
   * suite builds to `dist-e2e`. Hard-coding `dist` here wrote that build's index.html over
   * the *deploy* build's 404.html, and failed outright when there was no `dist` to write
   * into — so a clean checkout could not run the tests at all.
   */
  let out = 'dist';
  return {
    name: 'recurse-pages-fallback',
    apply: 'build',
    configResolved(config) {
      out = join(config.root, config.build.outDir);
    },
    closeBundle() {
      writeFileSync(join(out, '404.html'), readFileSync(join(out, 'index.html')));
    },
  };
}

/**
 * Re-extract the catalog whenever a message module changes, in dev only.
 *
 * **The catalog is what gets rendered, not the descriptor.** `provider.tsx` hands react-intl
 * `src/locales/en.json` as its `messages`, and a descriptor's own `defaultMessage` is consulted
 * only when the id is *missing* from that. Every id is in it — so editing the English in a
 * message module and reloading showed the old words, with nothing on screen or in the console
 * to say why. The answer was always `npm run i18n:extract`; this is that, on save.
 *
 * **It asks for a full reload, and has to.** Writing `en.json` does make Vite fire an HMR
 * update — the file is an ordinary module and `provider.tsx` imports it — and the page went on
 * showing the old words anyway. The catalog is held in a `useState`, and Fast Refresh preserves
 * component state across an update by design, so the module re-ran, rebuilt `CATALOGS` from the
 * new JSON, and handed the old object straight back. The alternative was an `import.meta.hot`
 * block in `provider.tsx` to re-seed that state, which is dev-only machinery in a runtime
 * module to avoid one reload; a catalog is app-wide, so app-wide is the right granularity.
 * Nothing is lost by it — progress is in `localStorage` and the board is named by the URL.
 *
 * **It shells out to the same command `npm run i18n:extract` runs**, rather than calling
 * `@formatjs/cli-lib` directly, so there is one extractor and it cannot drift from the one CI
 * uses. That also keeps the version pin honoured — see the note on `@formatjs/cli` in
 * CLAUDE.md, which is exact for a reason and where a *different* extractor silently writes an
 * empty catalog.
 *
 * Two things it deliberately does not do. It does not regenerate the **pseudo-locale**:
 * `xx-LS.json` is only reached by asking for `?locale=xx-LS`, and rebuilding it on every save
 * would double the cost of each one for a file most sessions never load — run `i18n:pseudo`
 * when testing that. And it never fails the dev server: an extraction that goes wrong prints
 * and leaves the last good catalog in place, because a broken message is a reason to see the
 * old words, not to lose the page.
 */
function extractMessages(): Plugin {
  const script = 'src/i18n/messages/**/*.ts';
  const out = 'src/locales/en.json';
  /** Editors save more than once, and a run takes about a second. */
  let pending: NodeJS.Timeout | null = null;
  let running = false;
  /** A save that landed while a run was in flight, which the run has to come back for. */
  let again = false;

  return {
    name: 'recurse-i18n-extract',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;

      const run = () => {
        // **A save during a run is remembered, not dropped.** Extraction takes about a
        // second, which is well inside the time between two saves, and returning early left
        // the second one unextracted — the page showing the old words, which is the whole
        // thing this exists to stop.
        if (running) {
          again = true;
          return;
        }
        running = true;
        again = false;
        execFile(
          'npx',
          ['formatjs', 'extract', script, '--format', 'simple', '--out-file', out],
          { cwd: root },
          (error, _stdout, stderr) => {
            running = false;
            if (error) {
              // Named, because the next thing to happen is the page *not* changing, and the
              // reason has to be findable from that.
              console.error(
                `\n[i18n] extract failed — the catalog is unchanged\n${stderr || error.message}`,
              );
            } else {
              server.hot.send({ type: 'full-reload' });
            }
            if (again) run();
          },
        );
      };

      // Once at startup, so the first frame shows what the modules say rather than whatever
      // the catalog was last committed as. A no-op when the two already agree: the file is
      // rewritten byte for byte and nothing reloads, since no client has connected yet.
      run();

      // Watched explicitly rather than relied on: a message module nothing imports yet is
      // not in the graph, and a new one is exactly the case where the loop matters most.
      server.watcher.add(join(root, 'src/i18n/messages'));
      server.watcher.on('all', (_event, path) => {
        if (!/src[\\/]i18n[\\/]messages[\\/].*\.ts$/.test(path)) return;
        if (pending) clearTimeout(pending);
        pending = setTimeout(run, 150);
      });
    },
  };
}

// Served from https://<user>.github.io/recurse/ in production, root in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/recurse/' : '/',
  plugins: [react(), tailwindcss(), pagesFallback(), extractMessages()],
  server: { port: 5173 },
  // The unit tests are all `src/lib` — pure logic over the real shipped data, no
  // DOM. What the components do is checked by Playwright in a real browser, which
  // is the only place a force layout means anything, so there is nothing here for
  // jsdom to do.
  //
  /**
   * **Two groups, because they want different amounts of time.**
   *
   * Almost every test here answers a fixed question about a fixed board and is done in a
   * millisecond, and vitest's five-second default is a real instrument on those: a test that
   * suddenly takes five seconds has broken. The fuzz is the other kind — it walks real boards
   * of both games with a simulated player, which is seconds at its default width and the best
   * part of a minute at `RECURSE_FUZZ=200`, the width to use after touching the format.
   *
   * Raising the timeout globally to suit the slowest test would have retired it for all the
   * others, so the split is by file: `*.fuzz.test.ts` is its own project with its own timeout.
   * `npm test` runs both — the group is about how long a test may take, not about whether it
   * is run.
   */
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.fuzz.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'fuzz',
          environment: 'node',
          include: ['src/**/*.fuzz.test.ts'],
          // Generous rather than absent: a sweep that has genuinely hung should still fail
          // rather than sit there, and the widest run anybody asks for is well inside this.
          testTimeout: 600_000,
        },
      },
    ],
  },
}));
