/**
 * A map somebody is filling in: what they have found, what they can spend, and what they have
 * been asked to go and find.
 *
 * **Not a puzzle, and deliberately not built out of one.** There are no ends to join, no par,
 * no day, no round to finish and no score; a map is a thing you keep. What it shares with the
 * daily game is exactly what found.ts holds — a guess reveals what it lands on, a repeated
 * move is free, and the cursor goes to the word most already part of the board — and it uses
 * that module rather than a copy of it.
 *
 * Three things are its own, and all three are the economy:
 *
 * * **Missions.** A word some distance out from everything found, and a payout equal to that
 *   distance. What it does *not* say is which found word the distance was measured from —
 *   that is the whole game of it, and it is why a mission is one word rather than a direction.
 *   An offer is priced at what it is worth *now*, and accepting it into a slot fixes that
 *   price; see `refresh` and `take`.
 * * **Points**, which the player reads as mana. Earned by finishing a mission, spent on
 *   powers.
 * * **Powers.** Two: the letter count of a word you have not found, and dropping a word onto
 *   the map without having reached it.
 *
 * Pure, and tested in node. Refusals are a `Phrase` rather than a sentence, the same as
 * moves.ts, because this is judged below the layer that knows what language the player reads.
 */

import type { Phrase } from '../i18n/format';
import { explore as says } from '../i18n/messages/explore';
import { advance, open, replay, type Found } from './found';
import { ITSELF, type Spell } from './hints';
import { PLAIN, type Lexicon } from './lexicon';
import { judgeGuess } from './moves';
import type { Regions } from './regions';
import type { Graph, Revealed } from './types';

/**
 * A word to go and find, and what finding it is worth.
 *
 * Only ever a mission that has been *accepted*. What is on offer is a bare word, priced live
 * off the map as it stands — see `Atlas.offers`.
 */
export interface Mission {
  word: string;
  /**
   * Moves from the nearest word already found, at the moment it was taken on — which is the
   * thing it will not tell you.
   */
  hops: number;
}

/**
 * A map in progress.
 *
 * Extends `Found` structurally, the way `GameState` does, so a step is
 * `{ ...atlas, ...step.found }` and everything reading `atlas.revealed` keeps working.
 */
export interface Atlas extends Found {
  /** Where the map began, which is the one word it has before anyone guesses. */
  start: string;
  /** Where the next guess is made from. Always somewhere already found. */
  selected: string;
  /**
   * Words a point has been spent on, and what it bought.
   *
   * Always level 1 — the letter count — because that is the only thing this game sells. A
   * level is kept rather than a bare set so that `hintLabel` can draw it without a second
   * definition of what a hint looks like.
   */
  hints: Map<string, number>;
  points: number;
  /**
   * Words on offer at different distances, or none if the map is nearly full.
   *
   * **Words and not missions**, because an offer has no price of its own: what it pays is how
   * far out it is *now*, which every guess toward it makes smaller. Storing a number here
   * would be storing one that had to be kept up to date, and the one place it is allowed to
   * stop moving is when somebody takes the offer on.
   */
  offers: string[];
  /** The ones being worked on, each at the price it was taken at. Never more than `slots`. */
  taken: Mission[];
  /** How many can be in hand at once. */
  slots: number;
}

/** The level a point buys, and the whole of what one buys. */
export const NAMED = 1;

/** What a hint costs. One, because there is only ever one to buy for a given word. */
export const NAME_COST = 1;

/**
 * What dropping a word costs: one point per letter.
 *
 * **Not its distance**, which was the obvious answer and is wrong: the price is shown before
 * the word is bought, so a price that was the distance would let anyone read the distance to
 * any word off a button — and a mission is exactly the question "how far away is this". A
 * letter count is public information about a word the player has already typed.
 */
export function dropCost(word: string, spell: Spell = ITSELF): number {
  return spell(word).length;
}

/**
 * How many missions can be in hand at once.
 *
 * Two, so that there is a choice to make and a reason not to take everything: a slot is the
 * only scarce thing in a game with no clock and no score, and it is what turns three offers
 * from a list into a decision. Kept on the map rather than read from here, so a map that grows
 * one keeps it.
 */
export const SLOTS = 2;

/** A map with one word on it. */
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

/** What an action came to: the map after it, and a sentence if it was refused. */
export interface Outcome {
  atlas: Atlas;
  /** Where the cursor ended up, if it moved. */
  landed?: string | undefined;
  refusal?: Phrase | undefined;
}
/*
  **Nothing here says what arrived**, though a guess obviously knows: what has to be animated in
  is every word *new to the board*, which is whatever was revealed plus the whole rim behind it,
  and the rim is a fact about the figure rather than about the guess. So the board works it out by
  comparing the figure with the one it drew a moment ago — see `arrivals` in AtlasBoard — which
  answers for a drop, a walk and a restored map by the same rule and cannot disagree with what is
  on screen. A set of revealed words here was the answer once, and it left every rim dot popping
  into place unanimated.
*/

/**
 * Guess a word from where the cursor is.
 *
 * **Free and uncounted**, which is the whole difference from the daily game: there is no par
 * to measure against and nothing to be worse at, so a guess that fails is not a miss and a
 * guess that works is not a move on a scorecard. The tally on screen is how much of the map
 * has been found, and a guess either adds to it or does not.
 */
export function guess(
  atlas: Atlas,
  graph: Graph,
  raw: string,
  lexicon: Lexicon = PLAIN,
): Outcome {
  const judged = judgeGuess(graph, atlas.selected, raw, graph.isWord, lexicon);
  if (!judged.ok) return { atlas, refusal: judged.reason };

  // Where a guess that named several words leaves the cursor: on one already found, over one
  // it has just invented. The daily game's four tiers collapse to two here, there being no
  // ends and no answer to prefer.
  const step = advance(atlas, atlas.selected, judged, (word) =>
    atlas.revealed.has(word) ? 0 : 1,
  );
  return {
    atlas: { ...atlas, ...step.found, selected: step.landed },
    landed: step.landed,
  };
}

/**
 * Go and stand somewhere already found.
 *
 * **This is fast travel, and it is not a separate idea.** A word you have been to is a word
 * you can guess from, so moving the cursor there is the same act whether it was tapped on the
 * map or typed into the guess bar. What typing buys is reach: on a map of three thousand
 * words, finding the one you want by eye and dragging the board to it is the slow way round.
 */
export function travel(atlas: Atlas, word: string): Outcome {
  if (!atlas.revealed.has(word) || word === atlas.selected) return { atlas };
  return { atlas: { ...atlas, selected: word }, landed: word };
}

/**
 * Where a typed word would take you, if it is not a move.
 *
 * Every reading of the spelling, so a word said two ways travels to whichever of them the
 * player has found — and the one they are standing on is not an answer, since going nowhere
 * is not travel.
 */
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
 * Spend points to put a word straight onto the map.
 *
 * It arrives with no `via` and no move, because there was none: nothing was walked to get
 * here. That is the same shape the first word of a map has, and `plate.ts` draws it the same
 * way — joined to whatever it turns out to be next to, and to nothing if it is nowhere near
 * anything found.
 *
 * A word in another component is allowed, and lands as an island with no way back. That is a
 * real limit rather than an oversight: whether an island can ever be joined up is a question
 * about the graph, and pretending otherwise by refusing the drop would only hide it.
 */
export function drop(
  atlas: Atlas,
  graph: Graph,
  regions: Regions,
  raw: string,
  lexicon: Lexicon = PLAIN,
): Outcome {
  const judged = judgeGuess(graph, atlas.selected, raw, graph.isWord, lexicon);
  // A word this game has never heard of is refused in the same sentence a guess would get,
  // which is the one place the two share a vocabulary — see `moves.ts`.
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

/** How many to offer at once. Three: a near one, a far one, and something between. */
export const OFFERS = 3;

/** The shortest journey worth calling one. Anything nearer is already a dot on the rim. */
export const LEAST_HOPS = 2;

/**
 * How far out every word the player has not found is.
 *
 * A single breadth-first walk outward from *everywhere already found at once*, over the map's
 * own words, which is what makes a distance mean "from the nearest thing you have" rather than
 * "from some particular word". At thirteen thousand words that is a few milliseconds.
 *
 * **The whole table rather than three picks off it**, because an offer is priced live: what a
 * word pays is what it is worth now, and a guess that shortens the way to it makes it worth
 * less. One walk per change to what has been found answers both questions — which words to
 * offer, and what each of them is currently worth.
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
 * Words worth going to find: far enough out to be a journey, and each a different length of
 * one.
 *
 * The nearest available, the furthest there is, and one in between — so the player picks how
 * much of an expedition they want without the game ever having a difficulty setting. Within a
 * distance the choice is the alphabetically first, because a mission that changed every time
 * the offers were redrawn would be a slot machine.
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

  // The nearest, the furthest, and one in between; fewer when the map has run out of room.
  const wanted = new Set<number>([rungs[0]!, rungs[rungs.length - 1]!]);
  if (rungs.length > 2) wanted.add(rungs[Math.floor(rungs.length / 2)]!);

  return [...wanted]
    .sort((one, two) => one - two)
    .slice(0, OFFERS)
    .map((away) => [...byDistance.get(away)!].sort()[0]!);
}

/**
 * Take one of the offers into a slot, at the price it is worth right now.
 *
 * **Accepting is what fixes the payout**, and it is the only thing that does. Until then the
 * offer is priced off the map as it stands and falls as the player happens to close on it; once
 * it is in hand it pays what it said, whatever road they take. So a slot is a bet as much as a
 * job: take the far one early and it stays worth a lot.
 *
 * Refused when every slot is full, which is what makes a slot worth anything.
 */
export function take(atlas: Atlas, mission: Mission): Atlas {
  if (atlas.taken.length >= atlas.slots) return atlas;
  if (atlas.taken.some((one) => one.word === mission.word)) return atlas;
  return {
    ...atlas,
    taken: [...atlas.taken, mission],
    offers: atlas.offers.filter((word) => word !== mission.word),
  };
}

/**
 * Give up on one of them, freeing its slot. No penalty.
 *
 * One at a time, because they are taken one at a time: two missions in hand are two separate
 * commitments and abandoning both to be rid of one would be a punishment nobody asked for.
 */
export function abandon(atlas: Atlas, word: string): Atlas {
  if (!atlas.taken.some((one) => one.word === word)) return atlas;
  return { ...atlas, taken: atlas.taken.filter((one) => one.word !== word) };
}

/**
 * Collect on a mission in hand whose word has been found.
 *
 * **The payout is what was promised, not what the journey came to.** A player who takes a
 * five-hop mission and then stumbles onto the word from somewhere else has still done the
 * thing that was asked; re-measuring the distance at the end would pay them less for having
 * found more of the map on the way, which is the opposite of what this is for.
 *
 * One per call, even where a guess finished two: a payout is something the screen says out
 * loud, and the caller runs this off the map it returns, so the second is collected on the
 * next pass and announced in its turn.
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
 * Top the offers back up, and drop any that are no longer worth offering.
 *
 * **An offer whose word has already been found is not an offer**, and leaving it up is worse
 * than having none: it says "go and find `cars`" about a word sitting named on the board. The
 * same goes for one that has been taken into a slot, which is no longer something to choose.
 *
 * Otherwise the list is left exactly as it is, and that is deliberate: the offers hold still
 * while their prices fall, so a player watching one drop from +9 to +4 is watching their own
 * progress rather than a table that reshuffles under them. `hops` is what the price is read
 * from — see `hopsFrom` — and a word missing from it has been found or cannot be reached.
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
 * Make a run of legal guesses at random, from wherever the map has got to.
 *
 * **An instrument, and the only thing in this file that no player can reach.** The question
 * every layout decision here turns on is what a map of two thousand words looks like, and the
 * honest way to get one is to play one — which is a person typing for an hour. So the dev bar
 * grows a map by guessing: a word already found that still has somewhere to go, one of the
 * places it goes, over and over. What comes out is a real map, made of real moves, and the
 * layout, the territories and the hulls have no way of telling it from a played one.
 *
 * It types the *spelling*, as a player would, so the phonemes game's generosity about a word
 * said two ways is exercised rather than sidestepped — see `guess`.
 *
 * The frontier is carried rather than recomputed, which is the difference between a second and
 * a minute at this size: rebuilding "which found words still have room" per step is a pass over
 * everything found, and a thousand steps is a thousand of them.
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
      // Swap and pop: the order of the frontier is nobody's business, and splicing a long one
      // per word that has run out costs more than the walk does.
      frontier[pick] = frontier[frontier.length - 1]!;
      frontier.pop();
      continue;
    }
    const to = open[Math.floor(random() * open.length)]!;
    at = guess({ ...at, selected: from }, graph, lexicon.label(to), lexicon).atlas;
    // Whatever that turned out to reveal, which need not be one word: a spelling can name
    // several tokens and every one of them that played is on the map now.
    for (const word of at.revealed.keys()) {
      if (known.has(word)) continue;
      known.add(word);
      frontier.push(word);
    }
    made++;
  }
  return at;
}

// --- writing one down --------------------------------------------------------

/**
 * A map, in a form that survives being written down.
 *
 * Only what cannot be derived, the same rule `GameSnapshot` follows: `revealed` is the start
 * plus whatever the logged moves landed on, plus whatever was dropped — which *is* derivable
 * from the log only if nothing was dropped, so the drops are kept. There is no `solved`, no
 * score and no tally, because a map has none of those.
 */
export interface AtlasSave {
  start: string;
  log: Atlas['log'];
  /** Words put on the map by spending points, which no move explains. */
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
 * Rebuild one, dropping anything that does not make sense.
 *
 * Total by construction, the way `restore` is: what was in a browser for a month may have been
 * written by an older version or by a bank that no longer has one of these words, and a map
 * that will not open is a far worse outcome than a map that has lost a word.
 *
 * Dropped words go on **before** the log is replayed, because a move made *from* a dropped
 * word is only replayable if the drop is already there — and a drop is a place the player
 * genuinely was standing.
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
    // A map written down before slots existed, or by a version with more of them, still opens:
    // what is in hand is what was in hand, and the count only ever decides what may be added.
    slots: Math.max(count(saved.slots), SLOTS),
  };
}
