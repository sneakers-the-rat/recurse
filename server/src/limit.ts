/**
 * Rate limiting: a token bucket per caller per kind of request, in memory.
 *
 * **In memory, and that is honest rather than temporary.** A shared store would make the limit
 * survive a restart and span several processes, and this is one process serving a word game. The
 * properties to know, so nobody is surprised: a restart forgives everybody, and running two
 * copies behind a load balancer doubles every limit. Both are fine here and neither is fine
 * everywhere, which is why they are written down.
 *
 * **A bucket rather than a fixed window**, because a fixed window lets a caller spend the whole
 * of one window and the whole of the next back to back, which is exactly the burst it was meant
 * to stop. A bucket refills continuously: `burst` says how much can be spent at once and `per`
 * says how long a full bucket takes to refill.
 *
 * **Several kinds, because the costs differ by orders of magnitude.** Hashing a password is a
 * tenth of a second of CPU by design; reading a scoreboard is an indexed lookup. One limit
 * covering both is either too loose to protect the first or too tight to allow the second.
 */

/** What a bucket allows: `burst` requests at once, refilling to full over `per` milliseconds. */
export interface Rate {
  burst: number;
  per: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The limits, by what a request costs.
 *
 * `mint` is the strict one: it is the only endpoint that creates a row for a caller who has
 * nothing, so it is the one that could fill a database from a script. Twenty an hour is far
 * more than any person needs — a player mints one, ever — and slow enough that abusing it is
 * not worth anybody's afternoon.
 *
 * `auth` bounds CPU as much as it bounds guessing: each attempt is a deliberately slow hash, so
 * this is also what stops a login endpoint being a way to pin a core.
 *
 * `write` is generous because a round in progress is pushed as it is played. The client
 * debounces; this is the backstop for one that does not.
 */
export const RATES = {
  mint: { burst: 20, per: HOUR },
  auth: { burst: 10, per: 15 * MINUTE },
  write: { burst: 120, per: MINUTE },
  read: { burst: 300, per: MINUTE },
} as const satisfies Record<string, Rate>;

export type Bucket = keyof typeof RATES;

interface Held {
  /** Tokens left, as a fraction — a bucket refills continuously. */
  left: number;
  at: number;
}

export interface Limiter {
  /** Spend one token. False when there is none, which is a `slow-down`. */
  take(bucket: Bucket, who: string, now: number): boolean;
  /** Drop everything not touched in the last hour. Called on a timer by the app. */
  sweep(now: number): void;
  /** How many callers are being tracked. For the tests and for a health line. */
  size(): number;
}

export function limiter(rates: Record<Bucket, Rate> = RATES): Limiter {
  const held = new Map<string, Held>();

  return {
    take(bucket, who, now) {
      const rate = rates[bucket];
      const key = `${bucket}:${who}`;
      const had = held.get(key);
      // A caller not seen before starts full, which is what makes the first request of a session
      // free rather than a coin toss.
      const left = had
        ? Math.min(rate.burst, had.left + ((now - had.at) * rate.burst) / rate.per)
        : rate.burst;
      if (left < 1) {
        // The timestamp still moves, so the refill above is measured from now and a caller who
        // keeps knocking while blocked does not accumulate credit for the time they spent
        // knocking.
        held.set(key, { left, at: now });
        return false;
      }
      held.set(key, { left: left - 1, at: now });
      return true;
    },

    sweep(now) {
      for (const [key, one] of held) {
        // An hour of silence is longer than the longest refill, so anything this old is a full
        // bucket and a full bucket is what a caller gets by not being here at all.
        if (now - one.at > HOUR) held.delete(key);
      }
    },

    size: () => held.size,
  };
}

/**
 * Who a request is from, for the purpose of a limit.
 *
 * Behind a reverse proxy every request arrives from the proxy, so the left-most `X-Forwarded-For`
 * entry is used instead — **and only when `proxied` says something trustworthy sets it**. On a
 * server reachable directly that header is whatever the caller typed, so believing it would let
 * anybody give themselves a fresh bucket per request. See `.env.example`.
 */
export function callerOf(
  headers: { get(name: string): string | null },
  address: string,
  proxied: boolean,
): string {
  if (!proxied) return address;
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 && first.length <= 64 ? first : address;
}
