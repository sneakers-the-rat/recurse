/**
 * An open map: what has been found, and the economy around it.
 *
 * No ends, par or score. Guessing is found.ts's. The economy is missions (a word some distance
 * from everything found, paying that distance, never saying which found word it is measured
 * from), points (shown as mana) earned from missions, and two powers that spend them: a word's
 * letter count, and dropping a word onto the map.
 */

import type { Phrase } from '../i18n/format';
import { explore as says } from '../i18n/messages/explore';
import { advance, open, replay, type Found } from './found';
import { ITSELF, type Spell } from './hints';
import { PLAIN, type Lexicon } from './lexicon';
import { judgeGuess } from './moves';
import type { Regions } from './regions';
import type { Graph, Revealed } from './types';

/** An accepted mission. An offer is a bare word; see `Atlas.offers`. */
export interface Mission {
  word: string;
  /** Moves from the nearest found word when it was taken, which is what it pays. */
  hops: number;
}

/** A map in progress. Extends `Found`, so a step is `{ ...atlas, ...step.found }`. */
export interface Atlas extends Found {
  start: string;
  /** Where the next guess is made from. Always a found word. */
  selected: string;
  /** Words whose letter count was bought. Always level `NAMED`, kept as a level for `hintLabel`. */
  hints: Map<string, number>;
  points: number;
  /** Words on offer. Unpriced: an offer pays its current distance, from `hopsFrom`. */
  offers: string[];
  /** Accepted missions, each at the price it was taken at. At most `slots`. */
  taken: Mission[];
  slots: number;
}

/** The only hint level this game sells: the letter count. */
export const NAMED = 1;

export const NAME_COST = 1;

/**
 * One point per letter. Not the distance: the price is shown before buying, and a distance
 * price would give away what missions ask.
 */
export function dropCost(word: string, spell: Spell = ITSELF): number {
  return spell(word).length;
}

/** How many missions a new map can hold at once. Stored per map in `Atlas.slots`. */
export const SLOTS = 2;

export function openAtlas(word: string): Atlas {
  return {
    ...open(word),
    start: word,
    selected: word,
    hints: new Map(),
    points: 0,
    offers: [],
    taken: [],
    slots: SLOTS,
  };
}

/**
 * The map after an action, and a refusal if there was one. What arrived is not reported: the
 * board diffs its figure instead, so rim words are included (`arrivals` in AtlasBoard).
 */
export interface Outcome {
  atlas: Atlas;
  /** Where the cursor ended up, if it moved. */
  landed?: string | undefined;
  refusal?: Phrase | undefined;
}

/** Guess a word from the cursor. Guesses are free and not counted. */
export function guess(
  atlas: Atlas,
  graph: Graph,
  raw: string,
  lexicon: Lexicon = PLAIN,
): Outcome {
  const judged = judgeGuess(graph, atlas.selected, raw, graph.isWord, lexicon);
  if (!judged.ok) return { atlas, refusal: judged.reason };

  // A guess that named several words lands on one already found in preference to a new one.
  const step = advance(atlas, atlas.selected, judged, (word) =>
    atlas.revealed.has(word) ? 0 : 1,
  );
  return {
    atlas: { ...atlas, ...step.found, selected: step.landed },
    landed: step.landed,
  };
}

/** Move the cursor to a found word, whether tapped or typed. */
export function travel(atlas: Atlas, word: string): Outcome {
  if (!atlas.revealed.has(word) || word === atlas.selected) return { atlas };
  return { atlas: { ...atlas, selected: word }, landed: word };
}

/** The first reading of a typed word that is found and is not the cursor, or null. */
export function travelTo(atlas: Atlas, raw: string, lexicon: Lexicon = PLAIN): string | null {
  const typed = raw.trim().toLowerCase();
  if (typed === '') return null;
  for (const token of lexicon.parse(typed)) {
    if (atlas.revealed.has(token) && token !== atlas.selected) return token;
  }
  return null;
}

/** Spend a point to be told how many letters an unfound word has. */
export function name(atlas: Atlas, word: string, spell: Spell = ITSELF): Outcome {
  if (atlas.revealed.has(word)) return { atlas };
  if ((atlas.hints.get(word) ?? 0) >= NAMED) {
    return { atlas, refusal: { message: says.alreadyNamed, values: { word: spell(word) } } };
  }
  if (atlas.points < NAME_COST) {
    return {
      atlas,
      refusal: { message: says.tooPoor, values: { word: spell(word), points: NAME_COST } },
    };
  }
  return {
    atlas: {
      ...atlas,
      points: atlas.points - NAME_COST,
      hints: new Map(atlas.hints).set(word, NAMED),
    },
  };
}

/**
 * Spend points to put a word straight onto the map, with no `via` and no move, like a map's
 * start. A word in another component is allowed and lands unconnected.
 */
export function drop(
  atlas: Atlas,
  graph: Graph,
  regions: Regions,
  raw: string,
  lexicon: Lexicon = PLAIN,
): Outcome {
  const judged = judgeGuess(graph, atlas.selected, raw, graph.isWord, lexicon);
  // A word not on the map at all gets the refusal a guess would.
  const tokens = lexicon.parse(raw.trim().toLowerCase());
  const wanted = tokens.find((token) => regions.has(token));
  if (wanted === undefined) {
    if (!judged.ok) return { atlas, refusal: judged.reason };
    return {
      atlas,
      refusal: { message: says.notOnTheMap, values: { word: raw.trim().toLowerCase() } },
    };
  }
  if (atlas.revealed.has(wanted)) {
    return { atlas, refusal: { message: says.alreadyHere, values: { word: lexicon.label(wanted) } } };
  }

  const price = dropCost(wanted, lexicon.label);
  if (atlas.points < price) {
    return {
      atlas,
      refusal: { message: says.tooPoor, values: { word: lexicon.label(wanted), points: price } },
    };
  }

  const revealed = new Map(atlas.revealed);
  revealed.set(wanted, { word: wanted, via: null, move: null, order: 0 } satisfies Revealed);
  return {
    atlas: { ...atlas, revealed, points: atlas.points - price, selected: wanted },
    landed: wanted,
  };
}

export const OFFERS = 3;

/** The nearest an offer may be. One hop out is already a rim word. */
export const LEAST_HOPS = 2;

/**
 * Distance from the nearest found word to every unfound word on the map, by one multi-source
 * breadth-first walk. Both chooses offers and prices them.
 */
export function hopsFrom(
  graph: Graph,
  regions: Regions,
  revealed: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  const seen = new Set(revealed);
  let frontier = [...revealed];

  for (let hops = 1; frontier.length > 0; hops++) {
    const next: string[] = [];
    for (const word of frontier) {
      for (const near of graph.commonNeighbors(word)) {
        if (seen.has(near) || !regions.has(near)) continue;
        seen.add(near);
        out.set(near, hops);
        next.push(near);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Offers at the nearest, furthest and a middle distance of at least `least`. Within a distance
 * the alphabetically first, so redrawing gives the same word.
 */
export function missions(
  hops: ReadonlyMap<string, number>,
  avoid: ReadonlySet<string> = new Set(),
  least = LEAST_HOPS,
): string[] {
  const byDistance = new Map<number, string[]>();
  for (const [word, away] of hops) {
    if (away < least || avoid.has(word)) continue;
    const rung = byDistance.get(away);
    if (rung) rung.push(word);
    else byDistance.set(away, [word]);
  }

  const rungs = [...byDistance.keys()].sort((one, two) => one - two);
  if (rungs.length === 0) return [];

  const wanted = new Set<number>([rungs[0]!, rungs[rungs.length - 1]!]);
  if (rungs.length > 2) wanted.add(rungs[Math.floor(rungs.length / 2)]!);

  return [...wanted]
    .sort((one, two) => one - two)
    .slice(0, OFFERS)
    .map((away) => [...byDistance.get(away)!].sort()[0]!);
}

/** Accept an offer into a slot, fixing its price. Does nothing when every slot is full. */
export function take(atlas: Atlas, mission: Mission): Atlas {
  if (atlas.taken.length >= atlas.slots) return atlas;
  if (atlas.taken.some((one) => one.word === mission.word)) return atlas;
  return {
    ...atlas,
    taken: [...atlas.taken, mission],
    offers: atlas.offers.filter((word) => word !== mission.word),
  };
}

/** Give up one mission, freeing its slot. No penalty. */
export function abandon(atlas: Atlas, word: string): Atlas {
  if (!atlas.taken.some((one) => one.word === word)) return atlas;
  return { ...atlas, taken: atlas.taken.filter((one) => one.word !== word) };
}

/**
 * Pay out one mission whose word has been found, at the price it was taken at. One per call, so
 * each payout is announced separately; the caller calls again for the next.
 */
export function collect(atlas: Atlas): { atlas: Atlas; paid: Mission | null } {
  const mission = atlas.taken.find((one) => atlas.revealed.has(one.word));
  if (!mission) return { atlas, paid: null };
  return {
    atlas: {
      ...atlas,
      points: atlas.points + mission.hops,
      taken: atlas.taken.filter((one) => one !== mission),
    },
    paid: mission,
  };
}

/**
 * Redraw the offers once one has been found, taken or become unreachable (missing from `hops`),
 * or there are fewer than `OFFERS`. Otherwise the list is kept, so prices fall in place.
 */
export function refresh(atlas: Atlas, hops: ReadonlyMap<string, number>): Atlas {
  const held = new Set(atlas.taken.map((one) => one.word));
  const live = atlas.offers.filter((word) => hops.has(word) && !held.has(word));
  if (live.length === atlas.offers.length && live.length >= OFFERS) return atlas;

  const wanted = missions(hops, held);
  if (wanted.length === atlas.offers.length && wanted.every((word, i) => word === atlas.offers[i])) {
    return atlas;
  }
  return { ...atlas, offers: wanted };
}

/**
 * Make `steps` random common-move guesses through `guess`, typing the spelling as a player
 * would. A dev-bar instrument for growing a large map.
 */
export function wander(
  atlas: Atlas,
  graph: Graph,
  lexicon: Lexicon,
  steps: number,
  random: () => number = Math.random,
): Atlas {
  let at = atlas;
  const known = new Set(at.revealed.keys());
  const room = (word: string) => graph.commonNeighbors(word).some((near) => !known.has(near));
  const frontier = [...known].filter(room);

  for (let made = 0; made < steps && frontier.length > 0; ) {
    const pick = Math.floor(random() * frontier.length);
    const from = frontier[pick]!;
    const open = graph.commonNeighbors(from).filter((near) => !known.has(near));
    if (open.length === 0) {
      // Swap and pop: order does not matter, and splicing a long frontier is slow.
      frontier[pick] = frontier[frontier.length - 1]!;
      frontier.pop();
      continue;
    }
    const to = open[Math.floor(random() * open.length)]!;
    at = guess({ ...at, selected: from }, graph, lexicon.label(to), lexicon).atlas;
    // A spelling can name several tokens, so a guess may reveal more than `to`.
    for (const word of at.revealed.keys()) {
      if (known.has(word)) continue;
      known.add(word);
      frontier.push(word);
    }
    made++;
  }
  return at;
}

/**
 * Like `wander`, but breadth first from `from`: all of its neighbours, then theirs, and so on.
 * Returns the map unchanged if `from` has not been found.
 */
export function spread(
  atlas: Atlas,
  graph: Graph,
  lexicon: Lexicon,
  steps: number,
  from: string,
): Atlas {
  let at = atlas;
  const known = new Set(at.revealed.keys());
  if (!known.has(from)) return atlas;

  const queue = [from];
  // Neighbours whose guess revealed nothing, so they are not picked again.
  const stuck = new Set<string>();
  let head = 0;
  for (let made = 0; made < steps && head < queue.length; ) {
    const here = queue[head]!;
    const open = graph
      .commonNeighbors(here)
      .filter((near) => !known.has(near) && !stuck.has(near));
    if (open.length === 0) {
      head++;
      continue;
    }
    const to = open[0]!;
    at = guess({ ...at, selected: here }, graph, lexicon.label(to), lexicon).atlas;
    let opened = false;
    for (const word of at.revealed.keys()) {
      if (known.has(word)) continue;
      known.add(word);
      queue.push(word);
      opened = true;
    }
    if (!opened) stuck.add(to);
    made++;
  }
  return at;
}

// --- writing one down --------------------------------------------------------

/** A map as stored: only what cannot be derived. `revealed` is replayed from the log. */
export interface AtlasSave {
  start: string;
  log: Atlas['log'];
  /** Revealed words no logged move reached: drops. */
  dropped: string[];
  selected: string;
  hints: [string, number][];
  points: number;
  offers: string[];
  taken: Mission[];
  slots: number;
}

export function saveAtlas(atlas: Atlas): AtlasSave {
  const walked = new Set([atlas.start]);
  for (const entry of atlas.log) walked.add(entry.to);
  return {
    start: atlas.start,
    log: atlas.log,
    dropped: [...atlas.revealed.keys()].filter((word) => !walked.has(word)),
    selected: atlas.selected,
    hints: [...atlas.hints],
    points: atlas.points,
    offers: atlas.offers,
    taken: atlas.taken,
    slots: atlas.slots,
  };
}

/**
 * Rebuild a map, discarding anything malformed. Total, like `restore`. Drops are passed to the
 * replay so that moves made from a dropped word replay.
 */
export function loadAtlas(saved: AtlasSave | null | undefined): Atlas | null {
  if (!saved || typeof saved.start !== 'string' || saved.start === '') return null;

  const dropped = (Array.isArray(saved.dropped) ? saved.dropped : []).filter(
    (word): word is string => typeof word === 'string' && word !== '',
  );
  const found = replay(saved.log, saved.start, new Set(dropped));
  for (const word of dropped) {
    if (!found.revealed.has(word)) {
      found.revealed.set(word, { word, via: null, move: null, order: 0 });
    }
  }

  const hints = new Map<string, number>();
  for (const pair of Array.isArray(saved.hints) ? saved.hints : []) {
    const [word, level] = Array.isArray(pair) ? pair : [];
    if (typeof word !== 'string' || !Number.isFinite(level)) continue;
    hints.set(word, NAMED);
  }

  const count = (value: unknown) =>
    Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0;
  const mission = (value: unknown): Mission | null => {
    const one = value as Mission | null;
    return one && typeof one.word === 'string' && Number.isFinite(one.hops)
      ? { word: one.word, hops: count(one.hops) }
      : null;
  };

  return {
    ...found,
    start: saved.start,
    selected: found.revealed.has(saved.selected) ? saved.selected : saved.start,
    hints,
    points: count(saved.points),
    offers: (Array.isArray(saved.offers) ? saved.offers : []).filter(
      (word): word is string => typeof word === 'string' && word !== '',
    ),
    taken: (Array.isArray(saved.taken) ? saved.taken : [])
      .map(mission)
      .filter((one): one is Mission => one !== null),
    // Never fewer than `SLOTS`; `taken` is kept as saved even if it exceeds this.
    slots: Math.max(count(saved.slots), SLOTS),
  };
}
