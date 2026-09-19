/**
 * What the explore mode says.
 *
 * A second game, so a second file. Nothing in here is a fact about a map — the words, the
 * counts and the names all arrive as values.
 *
 * **"Mana" is a word this file owns and nothing else does.** What a mission pays and a power
 * costs is `points` everywhere in the code, because that is what it is; what the player reads
 * it called is a decision, and a decision that can be changed by editing these few strings
 * rather than by renaming a field in six modules.
 */

import { defineMessages } from 'react-intl';

export const explore = defineMessages({
  // --- the board itself ------------------------------------------------------
  plate: {
    id: 'explore.plate',
    defaultMessage:
      'A map of {total, plural, one {# word} other {# words}} across {regions, plural, one {# region} other {# regions}}, {named} of them found',
    description:
      'Accessible description of the whole map. `total` counts every word drawn, which is what has been found plus the ring of unnamed words around it; `named` counts the ones the player has actually reached.',
  },

  // --- the masthead line -----------------------------------------------------
  found: {
    id: 'explore.found',
    defaultMessage: 'found',
    description:
      'Label on the tally: how many words the player has reached on this map. Beside a number.',
  },
  mana: {
    id: 'explore.mana',
    defaultMessage: 'mana',
    description:
      'Label on the tally: the currency missions pay out and powers are bought with. Beside a number. Called `points` everywhere in the code — this is the only place the player-facing name is written down.',
  },
  regions: {
    id: 'explore.regions',
    defaultMessage: 'regions',
    description:
      'Label on the tally: how many of the map’s territories the player has set foot in. Beside a number.',
  },

  // --- starting one ----------------------------------------------------------
  title: {
    id: 'explore.title',
    defaultMessage: 'Explore',
    description: 'Heading of the screen listing the player’s maps.',
  },
  blurb: {
    id: 'explore.blurb',
    defaultMessage:
      'An open map of the whole word graph. No par, no clock, no day: pick a word, and see how much of the language you can reach from it. A map is yours and keeps until you delete it.',
    description: 'One paragraph under the heading, saying what this mode is.',
  },
  maps: {
    id: 'explore.maps',
    defaultMessage: 'maps',
    description:
      'Link on an open map, to the list of all of them. The only way to the list from a map, the board menu having taken the open game’s place on the masthead.',
  },
  newAtlas: {
    id: 'explore.newAtlas',
    defaultMessage: 'New map',
    description: 'Button that starts a new map.',
  },
  startFrom: {
    id: 'explore.startFrom',
    defaultMessage: 'Start from',
    description: 'Label on the field where the player types the word a new map begins at.',
  },
  startHint: {
    id: 'explore.startHint',
    defaultMessage: 'Any word with moves out of it',
    description: 'Placeholder in that field.',
  },
  begin: {
    id: 'explore.begin',
    defaultMessage: 'Begin',
    description: 'Button that creates the map, once a starting word has been typed.',
  },
  notOnTheMap: {
    id: 'explore.notOnTheMap',
    defaultMessage:
      '{word} has nowhere to go — no other word is one move from it, so there would be nothing to explore.',
    description:
      'Refusal when the typed starting word is real but sits alone in the graph, or in a clump too small to be part of the map.',
  },
  which: {
    id: 'explore.which',
    defaultMessage: 'Which game?',
    description:
      'Label on the choice between the letters game and the phonemes game when starting a map.',
  },
  noMaps: {
    id: 'explore.noMaps',
    defaultMessage: 'No maps yet.',
    description: 'Shown where the list of maps would be, before there are any.',
  },

  // --- one map in the list ---------------------------------------------------
  held: {
    id: 'explore.held',
    defaultMessage:
      '{found, plural, one {# word} other {# words}} · {regions, plural, one {# region} other {# regions}}',
    description: 'What a map has come to, under its name in the list.',
  },
  touched: {
    id: 'explore.touched',
    defaultMessage: 'last played {date}',
    description: 'When a map was last open. The date is YYYY-MM-DD, which is not translated.',
  },
  open: {
    id: 'explore.open',
    defaultMessage: 'Open',
    description: 'Button that opens a map from the list.',
  },
  rename: {
    id: 'explore.rename',
    defaultMessage: 'Rename',
    description: 'Button that renames a map.',
  },
  remove: {
    id: 'explore.remove',
    defaultMessage: 'Delete',
    description: 'Button that deletes a map for good.',
  },
  reallyRemove: {
    id: 'explore.reallyRemove',
    defaultMessage: 'Delete {name}? This cannot be undone.',
    description: 'Confirmation before a map is deleted.',
  },

  // --- missions --------------------------------------------------------------
  missions: {
    id: 'explore.missions',
    defaultMessage: 'Missions',
    description:
      'The drawer the missions live in, on the line that opens and shuts it. A whole table of offers and slots is more chrome than a board wants standing open, so it is folded away and the line says what is in it.',
  },
  missionsHeld: {
    id: 'explore.missionsHeld',
    defaultMessage: '{taken} of {slots} in hand · {offers} on offer',
    description:
      'What the shut drawer says it holds: how many missions are being worked on out of how many may be at once, and how many words are on the table. Enough to know whether it is worth opening.',
  },
  openMissions: {
    id: 'explore.openMissions',
    defaultMessage: 'Show missions',
    description: 'Accessible name of the line that opens the drawer.',
  },
  shutMissions: {
    id: 'explore.shutMissions',
    defaultMessage: 'Hide missions',
    description: 'Accessible name of the same line while the drawer is open.',
  },
  slotEmpty: {
    id: 'explore.slotEmpty',
    defaultMessage: 'empty slot',
    description:
      'Stands in for a mission that has not been taken on yet. There are a fixed number of slots and they are always all shown, so the player can see how many they may hold at once; this is what one that is free reads as.',
  },
  missionAway: {
    id: 'explore.missionAway',
    defaultMessage: '{hops} away',
    description:
      'How many moves a mission’s word is from everything already found. The middle column of the list. Deliberately does not say *which* found word it is that far from — working that out is the game.',
  },
  missionPays: {
    id: 'explore.missionPays',
    defaultMessage: '+{points}',
    description:
      'What finishing a mission is worth, in mana. The right-hand column, set in gilt: a plus and a number, because the column it sits in is the only thing being added up.',
  },
  missionDone: {
    id: 'explore.missionDone',
    defaultMessage: 'Found {word} — {points} mana',
    description: 'Said when the word a mission named has been reached.',
  },
  abandon: {
    id: 'explore.abandon',
    defaultMessage: 'Give up',
    description:
      'Button beside one mission in hand, which drops that one and frees its slot. Missions are taken on one at a time and given up one at a time.',
  },
  take: {
    id: 'explore.take',
    defaultMessage: 'Take',
    description:
      'Button that accepts one of the missions on offer into a free slot, fixing what it pays. Disabled while every slot is full.',
  },
  noMissions: {
    id: 'explore.noMissions',
    defaultMessage: 'Nothing left far enough away to be worth a mission.',
    description:
      'Shown in place of the offers when so much of the map has been found that no unfound word is more than a move or two from something already reached.',
  },

  // --- powers ----------------------------------------------------------------
  // Each is drawn as a mark and a price, over the board rather than in a row of its own, so the
  // name is the button's accessible name and its tooltip rather than its face. See `Powers`.
  nameIt: {
    id: 'explore.nameIt',
    defaultMessage: 'Count letters',
    description:
      'Power: spend a point to be told how many letters an unfound word has. The only hint this game sells. Drawn as a question mark, so this is the button’s accessible name and what its tooltip says.',
  },
  nameItHow: {
    id: 'explore.nameItHow',
    defaultMessage: 'Tap a word you have not found.',
    description: 'How to use that power, once it is armed.',
  },
  drop: {
    id: 'explore.drop',
    defaultMessage: 'Drop a word',
    description:
      'Power: spend mana to put a word straight onto the map without having reached it. Drawn as a plus sign, so this is the button’s accessible name and what its tooltip says.',
  },
  dropHow: {
    id: 'explore.dropHow',
    defaultMessage: 'Type any word. It costs one mana per letter.',
    description: 'How to use that power. The price is the number of letters in the word.',
  },
  costs: {
    id: 'explore.costs',
    defaultMessage: '{points}',
    description:
      'The price of a power, beside its name. A bare number: the column it sits in is headed with the currency, and repeating the word on every row is noise.',
  },
  tooPoor: {
    id: 'explore.tooPoor',
    defaultMessage: 'Not enough mana — {word} costs {points}.',
    description: 'Refusal when the player asks for something they cannot pay for.',
  },
  alreadyNamed: {
    id: 'explore.alreadyNamed',
    defaultMessage: 'You already know how long {word} is.',
    description:
      'Refusal when a point is spent twice on the same word. A letter count is the only thing this game sells, so there is nothing more to buy.',
  },
  alreadyHere: {
    id: 'explore.alreadyHere',
    defaultMessage: '{word} is already on the map.',
    description: 'Refusal when a word is dropped that has already been found.',
  },
  cancel: {
    id: 'explore.cancel',
    defaultMessage: 'Cancel',
    description: 'Button that puts an armed power away without spending anything.',
  },

  // --- the guess bar ---------------------------------------------------------
  travel: {
    id: 'explore.travel',
    defaultMessage: 'go to {word}',
    description:
      'Shown under the guess field when what has been typed is not a move from here but *is* somewhere already on the map: pressing Guess jumps there instead. The whole of fast travel.',
  },
});
