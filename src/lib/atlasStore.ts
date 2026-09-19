/**
 * Where a map is kept.
 *
 * **Its own store, and not storage.ts's.** The five keys there are synchronous, small, and
 * read before the first paint; a map is none of those things. A full letters map is nine
 * thousand words with a position apiece, and several of those would be most of a browser's
 * five-megabyte localStorage budget — so this is IndexedDB, which has no such ceiling and
 * takes a `Float32Array` whole rather than as a string of digits.
 *
 * Asynchronous, therefore, and that costs nothing: a map cannot be drawn until its mode's
 * graph has been fetched, which is already an await.
 *
 * The promise storage.ts makes is kept here too: **nothing throws**. A browser in private
 * mode, a quota refusal, a database somebody's extension has broken — every one of them comes
 * back as "no maps" or "not saved", never as a screen that will not load. A map is a thing
 * somebody has spent hours on, so a failure to *write* is worth saying out loud; a failure to
 * open the database at all is not worth crashing over.
 */

import type { AtlasSave } from './atlas';
import type { Point } from './types';

const DB = 'recurse.atlases';
const STORE = 'atlases';
/**
 * Bumped when the stored shape changes, which retires every map in the browser.
 *
 * Deliberately blunt: a map is not a score and cannot be migrated field by field, so a change
 * this cannot read is a change that starts people over. Anything short of that belongs in
 * `loadAtlas`, which is total and drops what it cannot make sense of.
 */
const VERSION = 1;

/**
 * Where the words of a map sit, packed.
 *
 * Three parallel arrays rather than a map of objects: nine thousand `{x, y}` objects is nine
 * thousand allocations to write and as many to read, and structured clone stores a
 * `Float32Array` as bytes. Offsets rather than absolute positions, because an offset is what
 * survives its territory moving — see `remember` in atlasLayout.
 */
export interface PackedLayout {
  words: string[];
  x: Float32Array;
  y: Float32Array;
  /** Region index, then its centre: the same three arrays one scale up. */
  regions: Int32Array;
  cx: Float32Array;
  cy: Float32Array;
  radius: Float32Array;
}

export interface AtlasRecord {
  id: string;
  /** Which game this is a map of, by the manifest's own name for it. */
  mode: string;
  /**
   * The vocabulary this map's words were found in.
   *
   * Not a tripwire the way `vocab:` in recurse.yaml is — a map holds words rather than indices,
   * so a corpus that has moved costs it whatever words left and nothing else. It is here to say
   * *why*, when somebody's map has quietly lost a word.
   */
  vocab: string;
  name: string;
  /** `YYYY-MM-DD`, the way every other date in this game is written. */
  made: string;
  touched: string;
  /**
   * When this map was last opened, to the millisecond.
   *
   * **A map is remembered rather than addressed** — `explore/letters` names the *game*, and which
   * of your letters maps is in front of you is whichever you played last — so something has to
   * say which one that is. `touched` was it, and a day is not fine enough to try: two maps
   * opened on the same day tie on a `YYYY-MM-DD`, the sort below is stable, and what then broke
   * the tie was IndexedDB's own key order over random ids. Making a second map today opened the
   * first one instead, at random.
   *
   * A finer date and not a pointer, for two reasons: a pointer at a map that has been deleted
   * dangles, and the date the card *shows* is a different question with a different answer —
   * see `explore.touched`, where the day is the whole of what is worth saying.
   *
   * Optional, because a map written before this existed has no answer and falls back to its day.
   */
  opened?: number;
  save: AtlasSave;
  layout: PackedLayout | null;
  /** Where the player was looking, so the map opens where they left it. */
  camera: { cx: number; cy: number; scale: number } | null;
}

/** What a list of maps shows, without reading the maps themselves. */
export interface AtlasCard {
  id: string;
  mode: string;
  name: string;
  made: string;
  touched: string;
  found: number;
  regions: number;
}

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const wanted = indexedDB.open(DB, VERSION);
      wanted.onupgradeneeded = () => {
        const open = wanted.result;
        // One store, keyed by the map's own id. No indices: a browser holds a handful of maps
        // and the list is read whole.
        if (!open.objectStoreNames.contains(STORE)) open.createObjectStore(STORE, { keyPath: 'id' });
      };
      wanted.onsuccess = () => resolve(wanted.result);
      wanted.onerror = () => resolve(null);
      wanted.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest,
  fallback: T,
): Promise<T> {
  return db().then(
    (open) =>
      new Promise<T>((resolve) => {
        if (!open) return resolve(fallback);
        try {
          const asked = act(open.transaction(STORE, mode).objectStore(STORE));
          asked.onsuccess = () => resolve(asked.result as T);
          asked.onerror = () => resolve(fallback);
        } catch {
          resolve(fallback);
        }
      }),
  );
}

/**
 * Every map this browser holds, **most recently opened first**.
 *
 * That order is not decoration: the first card of a game is the map that game comes back to —
 * see `open` in Explore.tsx — so it has to be a total order and not one with ties in it. Sorted
 * before the cards are built, because what it sorts on is not on a card. See `opened`.
 */
export async function listAtlases(): Promise<AtlasCard[]> {
  const all = await run<AtlasRecord[]>('readonly', (store) => store.getAll(), []);
  return all
    .filter((one) => one && typeof one.id === 'string')
    .sort((one, two) => lastOpened(two) - lastOpened(one))
    .map((one) => ({
      id: one.id,
      mode: one.mode,
      name: one.name,
      made: one.made,
      touched: one.touched,
      // Counted off the save rather than stored, so a figure cannot drift from the map it is
      // about. The start, everything walked to, and everything dropped.
      found: countFound(one.save),
      regions: new Set(one.layout?.regions ?? []).size,
    }));
}

/** When a map was last opened, falling back to its day for one written before that was kept. */
function lastOpened(one: AtlasRecord): number {
  if (typeof one.opened === 'number' && Number.isFinite(one.opened)) return one.opened;
  return Date.parse(one.touched ?? '') || 0;
}

function countFound(save: AtlasSave | undefined): number {
  if (!save) return 0;
  const words = new Set<string>([save.start]);
  for (const entry of Array.isArray(save.log) ? save.log : []) {
    if (entry && typeof entry.to === 'string') words.add(entry.to);
  }
  for (const word of Array.isArray(save.dropped) ? save.dropped : []) {
    if (typeof word === 'string') words.add(word);
  }
  return words.size;
}

export async function readAtlas(id: string): Promise<AtlasRecord | null> {
  const found = await run<AtlasRecord | undefined>('readonly', (store) => store.get(id), undefined);
  return found ?? null;
}

/** Write one. Answers whether it went in, because losing a map is worth saying. */
export async function writeAtlas(record: AtlasRecord): Promise<boolean> {
  const done = await run<IDBValidKey | null>('readwrite', (store) => store.put(record), null);
  return done !== null;
}

export async function removeAtlas(id: string): Promise<void> {
  await run<undefined>('readwrite', (store) => store.delete(id), undefined);
}

/**
 * A name for a new map, unique enough to tell two apart in a list.
 *
 * Not a digest of anything: a map is local, nobody else will ever open it, and an address
 * nobody shares has nothing to be collision-proof about. Random, short, and in the same
 * alphabet a path segment wants — see `pageArg` in route.ts.
 */
export function newAtlasId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('');
}

/** Pack an arrangement for storage. */
export function pack(
  offsets: ReadonlyMap<string, Point>,
  centres: ReadonlyMap<number, Point>,
  radii: ReadonlyMap<number, number>,
): PackedLayout {
  const words = [...offsets.keys()];
  const x = new Float32Array(words.length);
  const y = new Float32Array(words.length);
  words.forEach((word, at) => {
    const point = offsets.get(word)!;
    x[at] = point.x;
    y[at] = point.y;
  });

  const regions = [...centres.keys()];
  const packed = new Int32Array(regions.length);
  const cx = new Float32Array(regions.length);
  const cy = new Float32Array(regions.length);
  const radius = new Float32Array(regions.length);
  regions.forEach((region, at) => {
    packed[at] = region;
    cx[at] = centres.get(region)!.x;
    cy[at] = centres.get(region)!.y;
    radius[at] = radii.get(region) ?? 0;
  });

  return { words, x, y, regions: packed, cx, cy, radius };
}

/** And read one back. Anything malformed comes back as nothing remembered, not as a throw. */
export function unpack(layout: PackedLayout | null | undefined): {
  offsets: Map<string, Point>;
  centres: Map<number, Point>;
  radii: Map<number, number>;
} | null {
  if (!layout || !Array.isArray(layout.words)) return null;
  const offsets = new Map<string, Point>();
  for (const [at, word] of layout.words.entries()) {
    const x = layout.x?.[at];
    const y = layout.y?.[at];
    if (typeof word !== 'string' || x === undefined || y === undefined) continue;
    offsets.set(word, { x, y });
  }
  const centres = new Map<number, Point>();
  const radii = new Map<number, number>();
  for (const [at, region] of (layout.regions ?? []).entries()) {
    const x = layout.cx?.[at];
    const y = layout.cy?.[at];
    if (x === undefined || y === undefined) continue;
    centres.set(region, { x, y });
    radii.set(region, layout.radius?.[at] ?? 0);
  }
  return { offsets, centres, radii };
}
