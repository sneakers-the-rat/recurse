/**
 * Where maps are kept: IndexedDB, not storage.ts's localStorage, because a full map with its
 * layout is too big for localStorage's quota.
 *
 * Nothing throws. A failed read is "no maps"; a failed write returns false.
 */

import type { AtlasSave } from './atlas';
import type { Remembered } from './atlasLayout';
import type { Point } from './types';

const DB = 'recurse.atlases';
const STORE = 'atlases';
/**
 * The database version. Bumping it discards every stored map; smaller changes belong in
 * `loadAtlas`, which drops what it cannot read.
 */
const VERSION = 1;

/**
 * A map's layout as parallel typed arrays, which structured clone stores compactly. Words are
 * stored as offsets within their region, so they keep their place when a region moves.
 */
export interface PackedLayout {
  words: string[];
  /** Offset of each word from its region's centre. */
  x: Float32Array;
  y: Float32Array;
  /** Region indices in `Regions`, and each region's position. */
  regions: Int32Array;
  cx: Float32Array;
  cy: Float32Array;
}

export interface AtlasRecord {
  id: string;
  /** The game this maps, by its manifest name. */
  mode: string;
  /** The vocabulary digest the words were found in, for explaining a word that has gone. */
  vocab: string;
  name: string;
  /** `YYYY-MM-DD`. */
  made: string;
  touched: string;
  /**
   * When the map was last opened, in milliseconds. A game shows its most recently opened map,
   * and `touched` is only a day, so it cannot order two maps opened on the same day. Absent on
   * older records, which fall back to `touched`.
   */
  opened?: number;
  save: AtlasSave;
  layout: PackedLayout | null;
  camera: { cx: number; cy: number; scale: number } | null;
}

/** What the list of maps shows. */
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
        // No indices: the list is always read whole.
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
 * Every stored map, most recently opened first. Explore.tsx opens a game's first card, so the
 * order matters; see `opened`.
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
      found: countFound(one.save),
      regions: one.layout?.regions?.length ?? 0,
    }));
}

/** `opened`, or `touched` for a record without one. */
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

/** Whether the write succeeded. */
export async function writeAtlas(record: AtlasRecord): Promise<boolean> {
  const done = await run<IDBValidKey | null>('readwrite', (store) => store.put(record), null);
  return done !== null;
}

export async function removeAtlas(id: string): Promise<void> {
  await run<undefined>('readwrite', (store) => store.delete(id), undefined);
}

/** A random id for a new map. Maps are local, so it only needs to be unique in one browser. */
export function newAtlasId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(36).padStart(2, '0')).join('');
}

export function pack(settled: Remembered): PackedLayout {
  const words = [...settled.offsets.keys()];
  const x = new Float32Array(words.length);
  const y = new Float32Array(words.length);
  words.forEach((word, at) => {
    const point = settled.offsets.get(word)!;
    x[at] = point.x;
    y[at] = point.y;
  });

  const seats = [...settled.places.keys()];
  const regions = new Int32Array(seats.length);
  const cx = new Float32Array(seats.length);
  const cy = new Float32Array(seats.length);
  seats.forEach((region, at) => {
    const point = settled.places.get(region)!;
    regions[at] = region;
    cx[at] = point.x;
    cy[at] = point.y;
  });

  return { words, x, y, regions, cx, cy };
}

/**
 * Read a layout back, or null if malformed. A layout with no regions holds absolute positions,
 * not offsets, and is discarded; the map itself is unaffected.
 */
export function unpack(layout: PackedLayout | null | undefined): Remembered | null {
  if (!layout || !Array.isArray(layout.words)) return null;
  if (!layout.regions || layout.regions.length === 0) return null;

  const offsets = new Map<string, Point>();
  for (const [at, word] of layout.words.entries()) {
    const x = layout.x?.[at];
    const y = layout.y?.[at];
    if (typeof word !== 'string' || x === undefined || y === undefined) continue;
    offsets.set(word, { x, y });
  }

  const places = new Map<number, Point>();
  for (let at = 0; at < layout.regions.length; at++) {
    const region = layout.regions[at];
    const x = layout.cx?.[at];
    const y = layout.cy?.[at];
    if (region === undefined || x === undefined || y === undefined) continue;
    places.set(region, { x, y });
  }

  return { offsets, places };
}
