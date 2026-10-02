/**
 * What the explore mode says.
 *
 * "Mana" is the player-facing name for what the code calls `points`, and appears only here.
 */

import { defineMessages } from 'react-intl';

export const explore = defineMessages({
  // --- the board itself ------------------------------------------------------
  plate: {
    id: 'explore.plate',
    defaultMessage:
      'A map of {total, plural, one {# word} other {# words}} across {regions, plural, one {# region} other {# regions}}, {named} of them found',
    description:
      'Accessible description of the whole map. `total` counts every word drawn, found or not; `named` counts the ones the player has reached.',
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
      'Label on the tally: the currency missions pay out and powers are bought with. Beside a number.',
  },
  regions: {
    id: 'explore.regions',
    defaultMessage: 'regions',
    description:
      'Label on the tally: how many regions the map is divided into so far. Beside a number.',
  },

  // --- starting one ----------------------------------------------------------
  title: {
    id: 'explore.title',
    defaultMessage: 'Explore',
    description: 'Heading of the screen listing the player’s maps.',
  },
  blurb: {
    id: 'explore.blurb',
    defaultMessage: 'Explore the whole damn graph!!! Keep guessing and try and reveal as many words as you can. Maps are continuous over time rather than a daily puzzle. Accept missions to reach words to earn mana, and spend mana to drop new words and get hints!',
    description: 'Explanation under the heading saying what this mode is.',
  },
  maps: {
    id: 'explore.maps',
    defaultMessage: 'maps',
    description:
      'Link on an open map, to the list of all the player’s maps.',
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
      '{word} is not on the map! Either it has no moves or isn\'t in the word list',
    description:
      'Refusal when the typed starting word is real but sits alone in the graph, or in a clump too small to be part of the map.',
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
      'Title on the line that opens and shuts the missions drawer.',
  },
  missionsHeld: {
    id: 'explore.missionsHeld',
    defaultMessage: '{taken} of {slots} active - {offers} available',
    description:
      'Summary on the shut drawer: missions taken out of slots available, and how many are on offer.',
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
      'Shown in a mission slot that is free. Every slot is always shown.',
  },
  missionAway: {
    id: 'explore.missionAway',
    defaultMessage: '{hops} away',
    description:
      'How many moves a mission’s word is from the nearest found word. Deliberately does not say which found word.',
  },
  missionPays: {
    id: 'explore.missionPays',
    defaultMessage: '+{points}',
    description:
      'What finishing a mission is worth, in mana. The right-hand column of the list.',
  },
  missionDone: {
    id: 'explore.missionDone',
    defaultMessage: 'Found {word} - {points} mana',
    description: 'Said when the word a mission named has been reached.',
  },
  abandon: {
    id: 'explore.abandon',
    defaultMessage: 'Give up',
    description:
      'Button beside one mission in hand, which drops it and frees its slot.',
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
      'Shown in place of the offers when no unfound word is far enough from the found ones.',
  },

  // --- powers ----------------------------------------------------------------
  // A power's button shows a mark and a price; its name is the accessible name and tooltip.
  nameIt: {
    id: 'explore.nameIt',
    defaultMessage: 'Count letters',
    description:
      'Power, shown as a question mark: spend a point to learn how many letters an unfound word has. Accessible name and tooltip.',
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
      'Power, shown as a plus sign: spend mana to put a word onto the map without reaching it. Accessible name and tooltip.',
  },
  dropHow: {
    id: 'explore.dropHow',
    defaultMessage: 'Type any word. It costs one mana per letter.',
    description: 'How to use that power. The price is the number of letters in the word.',
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
      'Refusal when the letter count of the same word is bought twice.',
  },
  alreadyHere: {
    id: 'explore.alreadyHere',
    defaultMessage: '{word} is already on the map.',
    description: 'Refusal when a word is dropped that has already been found.',
  },

  // --- the guess bar ---------------------------------------------------------
  travel: {
    id: 'explore.travel',
    defaultMessage: 'go to {word}',
    description:
      'Shown under the guess field when what has been typed is not a move from here but is a word already found on the map: pressing Guess jumps there.',
  },
});
