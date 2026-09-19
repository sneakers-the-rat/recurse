/**
 * Passwords, and the tokens that stand in for them.
 *
 * **No dependency, and that is a decision rather than an omission.** The modern advice is
 * argon2id, and every node binding for it is a native module that has to be compiled or
 * downloaded per platform and node version — on a server whose whole deployment story is
 * "a node process and a systemd unit", that is the thing most likely to break on an upgrade
 * and the hardest for a self-hoster to fix. scrypt is memory-hard, is in node's core, has been
 * there since 2017, and at the parameters below costs about a tenth of a second and 32MB per
 * attempt. Against a game with no email addresses in it, that is the right trade.
 *
 * **The stored hash names its own algorithm**, so this is a decision that can be revisited
 * without a migration: `scrypt$…` is what is written today, `verify` dispatches on the prefix,
 * and a future argon2 is a new prefix plus a rehash-on-login. Nothing else in the server reads
 * the format.
 *
 * A token is a different problem and gets a different answer. It is 32 random bytes rather than
 * something a person chose, so there is nothing to guess and no reason to slow anybody down: it
 * is stored as a plain SHA-256, which keeps a copy of the database from being a copy of
 * everybody's live logins while costing nothing per request.
 */

import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Typed by hand because `promisify` picks the overload without the options argument, and the
 * options are where the whole cost of the hash is set.
 */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * The work factor. `N` is the memory-hard one; 2^15 with r=8 is 32MB and about 100ms.
 *
 * `maxmem` has to be raised with it: node's default ceiling is 32MB and the requirement is
 * `128 * N * r`, which at these numbers is exactly 32MB — so the default refuses by a byte.
 */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, SCRYPT);
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

/**
 * Does this password match that stored hash?
 *
 * False for anything unreadable rather than a throw, because the caller's next move is the same
 * either way: refuse the login. A stored hash this cannot parse is a row written by a version
 * that is not this one, and treating it as a wrong password is the safe reading.
 *
 * The parameters come out of the stored string rather than from `SCRYPT`, which is what lets the
 * work factor be raised without invalidating everybody's password.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null) return false;
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }
  const want = Buffer.from(key, 'base64url');
  let got: Buffer;
  try {
    got = await scrypt(password, Buffer.from(salt, 'base64url'), want.length, cost);
  } catch {
    // Parameters the current node will not run — a cost from the future, say. Not a match.
    return false;
  }
  // Constant-time, which matters less for a hash than for a token and costs nothing either way.
  return want.length === got.length && timingSafeEqual(want, got);
}

/** A player id. A v4 UUID, from the platform's own generator. */
export function newPlayerId(): string {
  return randomUUID();
}

/**
 * A fresh bearer token, and what to store for it.
 *
 * Returned together because they must never be derived from each other anywhere else: the
 * string goes to the client and is never written down, the digest is written down and can do
 * nothing on its own.
 */
export function newToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, digest: digestToken(token) };
}

export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The token out of an `Authorization` header, or null.
 *
 * Strict about the scheme: an `Authorization` header this does not understand is a caller who
 * thinks they are authenticated and is not, and the earlier that is a plain 401 the better.
 */
export function bearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  // Bounded, because everything else here is: an enormous header should not reach a database
  // query, and no real token is anywhere near this.
  return token.length > 0 && token.length <= 256 ? token : null;
}
