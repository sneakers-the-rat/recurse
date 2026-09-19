/**
 * Configuration, read once, and refused rather than guessed at.
 *
 * A server that starts with half its configuration missing is a server that is wrong in
 * production and fine in development, which is the worst way for a thing to be wrong. So every
 * value here is required, every one is checked for shape, and anything missing stops the process
 * before it listens — with a sentence naming the variable, because the person reading it is
 * holding a `.env.example` and wants to know which line to fill in.
 *
 * **`.env`, and not `recurse.yaml`.** The game's parameters are committed on purpose: they hold
 * no secrets, they are the same everywhere, and the builder cannot run without them. These are
 * the opposite on all three counts — a database path, an origin allowlist, a port — so they live
 * in a file per deployment that git does not carry.
 *
 * No dotenv: `process.loadEnvFile` has been in node since 21.7 and does the whole job. One fewer
 * dependency on a server whose dependency list is the thing a self-hoster has to trust.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Env {
  /**
   * Origins allowed to call the API, or `'*'` for any.
   *
   * See `.env.example` for what this is and is not worth. It is a browser-side control and
   * nothing more.
   */
  origins: string[] | '*';
  /** Where the bank and the graphs are fetched from, ending in a slash. */
  data: string;
  /** The SQLite file. */
  db: string;
  port: number;
  /**
   * Whether to believe `X-Forwarded-For`.
   *
   * Only ever true when something trusted sets it, because the whole rate limiter rests on the
   * address being the caller's rather than the caller's claim. See `.env.example`.
   */
  proxied: boolean;
}

/** What went wrong, as a list, so one run tells you about every missing line and not the first. */
class Misconfigured extends Error {
  constructor(problems: readonly string[]) {
    super(
      `the server cannot start:\n${problems.map((one) => `  - ${one}`).join('\n')}\n` +
        'see server/.env.example',
    );
    this.name = 'Misconfigured';
  }
}

function origins(raw: string | undefined, problems: string[]): string[] | '*' {
  if (raw === undefined || raw.trim() === '') {
    problems.push('RECURSE_ORIGINS is not set: name the site that may call this, or `*`');
    return [];
  }
  if (raw.trim() === '*') return '*';
  const listed = raw
    .split(',')
    .map((one) => one.trim().replace(/\/$/, ''))
    .filter((one) => one !== '');
  for (const one of listed) {
    // A scheme and a host, which is what an `Origin` header is. A path in there never matches
    // anything and would silently allow nobody, so it is refused rather than trimmed.
    try {
      const url = new URL(one);
      if (url.origin !== one) {
        problems.push(`RECURSE_ORIGINS: \`${one}\` is not a bare origin (try \`${url.origin}\`)`);
      }
    } catch {
      problems.push(`RECURSE_ORIGINS: \`${one}\` is not a URL`);
    }
  }
  if (listed.length === 0) problems.push('RECURSE_ORIGINS is empty');
  return listed;
}

function data(raw: string | undefined, problems: string[]): string {
  if (raw === undefined || raw.trim() === '') {
    problems.push('RECURSE_DATA is not set: the URL of a running site’s `data/` directory');
    return '';
  }
  const url = raw.trim();
  try {
    new URL(url);
  } catch {
    problems.push(`RECURSE_DATA: \`${url}\` is not a URL`);
    return '';
  }
  // Ending in a slash is not pedantry: every name is joined onto this, and `…/data` without one
  // resolves `dictionary.json` as a sibling of `data` rather than a child of it.
  return url.endsWith('/') ? url : `${url}/`;
}

function port(raw: string | undefined, problems: string[]): number {
  const at = Number(raw ?? '');
  if (!Number.isInteger(at) || at < 1 || at > 65535) {
    problems.push(`RECURSE_PORT: \`${raw ?? ''}\` is not a port`);
    return 0;
  }
  return at;
}

/**
 * Read the environment, having loaded `.env` if there is one.
 *
 * The file is optional and the variables are not: a deployment that sets them some other way —
 * systemd's `Environment=`, a container's `--env` — is an ordinary way to run this, and
 * insisting on the file would break it for no reason.
 */
export function readEnv(from: NodeJS.ProcessEnv = process.env): Env {
  const problems: string[] = [];
  const env: Env = {
    origins: origins(from.RECURSE_ORIGINS, problems),
    data: data(from.RECURSE_DATA, problems),
    db: from.RECURSE_DB?.trim() || './recurse.db',
    port: port(from.RECURSE_PORT ?? '8787', problems),
    proxied: from.RECURSE_PROXIED === '1',
  };
  if (problems.length > 0) throw new Misconfigured(problems);
  return env;
}

/** Load `.env` into `process.env` if it is there. Nothing is overwritten that is already set. */
export function loadEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
