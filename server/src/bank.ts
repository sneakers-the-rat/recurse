/**
 * The puzzle bank and the graphs, fetched from a running copy of the site.
 *
 * The server has to know what a puzzle is and which moves exist, because it scores rounds by
 * replaying them rather than by believing what it is told. That is the same data the browser
 * fetches, and the honest way to get it is the same way: over HTTP from a deployed site, named
 * by the digests in the manifest. A directory copied onto the box at deploy time would be one
 * more thing to keep in step, and the failure when it slipped would be silent — scores computed
 * against a bank nobody is playing on.
 *
 * **Only the fetching is new.** Everything that decides what the bytes *mean* — `decodeShard`,
 * `decodeGameData`, the delta encoding, the file names — is data.ts's, imported unchanged. That
 * module's header says everything above its first `fetch` has to work outside a bundler, and
 * this is the third caller to take it up on that, after the unit tests and the Playwright
 * fixtures. What could not be reused is `get`, which reads `import.meta.env.BASE_URL` and joins
 * a relative path: there is no page here to be relative to.
 *
 * **Lazily, and then for ever.** A mode's dictionary and graph are several megabytes and take a
 * moment to build into 269k edges, so they are fetched when a round of that mode first arrives
 * and kept until the process ends. A shard is 1/256th of the bank and is kept the same way.
 * Both are keyed by the manifest's version, so the day the site redeploys with a new bank the
 * old entries are unreachable rather than wrong — see `reload`.
 */

import {
  decodeGameData,
  decodeShard,
  modeFile,
  shardName,
  shardOf,
  type RawCommon,
  type RawDictionary,
  type RawGraph,
  type RawManifest,
} from '../../src/lib/data';
import type { RawLexicon } from '../../src/lib/lexicon';
import type { Graph, Puzzle } from '../../src/lib/types';

/** How long any one fetch may take before it is given up on. */
const TIMEOUT = 60_000;

export interface Bank {
  /** The manifest as last read. `version` is what every score is recorded against. */
  readonly manifest: RawManifest;
  /** The puzzle of that id, or null if this bank has none. */
  puzzle(id: string): Promise<Puzzle | null>;
  /** The graph a puzzle is played on, by its band's mode. */
  graphFor(puzzle: Puzzle): Promise<Graph>;
  /**
   * Re-read the manifest, in case the site has been redeployed.
   *
   * Everything cached is dropped, because every cached thing was named by the old version. Safe
   * to call at any time and cheap when nothing has changed; what it costs is the next request
   * for each mode refetching a graph.
   */
  reload(): Promise<void>;
}

export class BankError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BankError';
  }
}

async function getJson<T>(url: string): Promise<T> {
  return JSON.parse(await getText(url)) as T;
}

async function getText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  } catch (cause) {
    throw new BankError(`could not reach ${url}`, { cause });
  }
  if (!res.ok) throw new BankError(`could not load ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

/**
 * Open a bank against a site.
 *
 * The manifest is fetched here rather than on first use, so a server pointed at a URL with no
 * bank behind it fails at start-up with a sentence naming the URL — rather than starting,
 * looking healthy, and refusing every round that arrives.
 */
export async function openBank(base: string): Promise<Bank> {
  let manifest = await getJson<RawManifest>(`${base}puzzles/manifest.json`);

  /** Fetched shards and fetched graphs, each a promise so two callers share one fetch. */
  let shards = new Map<number, Promise<Puzzle[]>>();
  let graphs = new Map<number, Promise<Graph>>();

  /**
   * A promise cached under a key, with a failure clearing the entry.
   *
   * The same shape `loadMode` uses in the browser and for the same reason: two requests arriving
   * together should share one fetch, and one that failed must not be the answer for ever.
   */
  function once<T>(store: Map<number, Promise<T>>, key: number, make: () => Promise<T>) {
    const held = store.get(key);
    if (held) return held;
    const wanted = make().catch((error: unknown) => {
      store.delete(key);
      throw error;
    });
    store.set(key, wanted);
    return wanted;
  }

  function shard(index: number): Promise<Puzzle[]> {
    return once(shards, index, async () => {
      const name = shardName(index, manifest.version);
      return decodeShard(await getText(`${base}puzzles/${name}`));
    });
  }

  function graph(mode: number): Promise<Graph> {
    return once(graphs, mode, async () => {
      const file = (what: string) => `${base}${modeFile(what, mode, manifest)}`;
      const translated = manifest.modes[mode]?.alphabet !== 'letters';
      const [dictionary, rows, common, lexicon] = await Promise.all([
        getJson<RawDictionary>(file('dictionary')),
        getJson<RawGraph>(file('graph')),
        getJson<RawCommon>(file('common')),
        translated ? getJson<RawLexicon>(file('lexicon')) : Promise.resolve(undefined),
      ]);
      // No puzzles: a shard holds every mode's and is fetched separately, exactly as in the
      // browser. `decodeGameData` is the shared definition and takes both.
      return decodeGameData({ dictionary, graph: rows, common, lexicon, manifest, mode, puzzles: [] })
        .graph;
    });
  }

  return {
    get manifest() {
      return manifest;
    },

    async puzzle(id: string): Promise<Puzzle | null> {
      // One fetch, because the shard is named by the id's own first two digits. That is the
      // whole reason a link resolves in a single round trip — see the note on `shardOf`.
      const held = await shard(shardOf(id));
      return held.find((one) => one.id === id) ?? null;
    },

    graphFor(puzzle: Puzzle): Promise<Graph> {
      // A band belongs to exactly one mode, and the band is on the puzzle. Mode 0 is the
      // fallback for a band this manifest does not have, which is a puzzle that cannot have
      // come from this bank — `puzzle` will not have returned one.
      return graph(manifest.bands[puzzle.band]?.mode ?? 0);
    },

    async reload(): Promise<void> {
      const fresh = await getJson<RawManifest>(`${base}puzzles/manifest.json`);
      if (fresh.version === manifest.version) return;
      manifest = fresh;
      shards = new Map();
      graphs = new Map();
    },
  };
}
