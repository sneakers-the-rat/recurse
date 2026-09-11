/**
 * Three instruments for boardCode.ts: how long a code is, what one says bit by bit, and one
 * case per kind of action there is.
 *
 * The first is the measurement behind that module's central claim — that indexing against the
 * graph and the puzzle beats compressing a notation, dictionary training and all. That claim is
 * only true at a *size*, so it has to be re-measured whenever the size could have moved:
 * another operation, a wider index, or a decision to record something the format currently
 * collapses. A replay with a timestamp per click would be an order of magnitude more, and the
 * arithmetic would very likely come out the other way.
 *
 * The second says what a code *means*: an annotated dump, field by field, with the bit offsets
 * and what each field names. It is `explain` in boardCode.ts doing the reading — the codec's
 * own walk with its trace turned on — so what is printed is the code and not a description of
 * one.
 *
 * The third says what the *data* is at every layer it passes between, both ways: `ladder`, one
 * small round per kind of action, printing the commands, the game, the snapshot, the series,
 * the written shapes, the fields, the bits, the characters and the URL on the way down — and
 * then the same five stages on the way up beside the stage each has to match. That is the point
 * of a round trip, and it is the reason it prints all of it rather than saying `true` at the
 * end: a mismatch localises the fault to one translation rather than to "the encoding". It
 * **throws** on a stage that does not come back, so a printed example cannot be wrong; the
 * fuzz in `boardCode.test.ts` is what actually guards it, over hundreds of rounds nobody wrote
 * out.
 *
 *     RECURSE_SIZES=1 npx vitest run src/lib/codeSize.test.ts
 *
 * **Skipped unless asked for, because it is not a test.** It asserts only that it measured
 * something; what it is for is the table it prints. Same arrangement as `pivots.test.ts` and
 * `e2e/boards.spec.ts`, and for the same reason.
 *
 * **The rounds are simulated, and how they are simulated is the whole of whether the numbers
 * mean anything.** An optimal walk with two hints makes the format look three times better
 * than a real round does. Real players take about thirty hints, guess fifteen to thirty words
 * the board never drew, and hop back and forth between two places to guess from — and every
 * one of those is expensive in a different part of the encoding. So three shapes are measured,
 * and the heavy one is the one to read.
 *
 * The comparison is against the *notation* the format came from — `g16s2g11h3n2`, the readable
 * form of the same operations — because that is what a general-purpose compressor would
 * actually be given. `deflate+dict` is deflate primed with a hundred and twenty other
 * simulated rounds of the same shape, none of them the one measured, which is as close to
 * `zstd --train` as Node's zlib gets: it is the same mechanism, matches into a preloaded
 * window. Node exposes no ZDICT, and the frame overhead that sinks zstd here is visible
 * without it. Every figure is *characters of URL*, so the compressed ones carry base64's third
 * — which is the tax this format does not pay, because it writes base64 directly.
 */

import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import {
  decodeBoard,
  encodeBoard,
  explain,
  writeActions,
  writtenOf,
} from './boardCode';
import { newGame, restore, snapshot, type GameState } from './game';
import { shortestPath } from './graph';
import { act, actionsOf, replayActions, type Command, type World } from './actions';
import { playRound, reading, SHAPES } from '../test/rounds';
import { PLAIN } from './lexicon';
import { shippedData, shippedModes, shippedShard, shippedVersion } from '../test/shipped';
import type { Graph, Puzzle } from './types';

/**
 * The same round in the readable notation, which is what the compressors are given.
 *
 * `g`/`a`/`s`/`h`/`m`/`f` and an index apiece — a guess, another reading of it, a stand, a
 * hint, a mark, the refusals — with `r` marking a dictionary index rather than a position in
 * the puzzle. The shape boardCode.ts was designed from, before any of it was packed.
 */
function notation(game: GameState, puzzle: Puzzle, words: readonly string[]): string {
  const table = [puzzle.source, puzzle.target, ...puzzle.board];
  const at = (word: string) => {
    const local = table.indexOf(word);
    return local >= 0 ? `${local}` : `r${words.indexOf(word)}`;
  };
  let out = '';
  let stand = puzzle.source;
  let seen: number | null = null;
  for (const entry of game.log) {
    if (entry.order !== seen && entry.from !== stand) out += `s${at(entry.from)}`;
    out += `${entry.order === seen ? 'a' : 'g'}${at(entry.to)}`;
    seen = entry.order;
    stand = entry.to;
  }
  for (const [word, level] of game.hints) out += `h${at(word)}n${level}`;
  for (const key of game.edgeHints) {
    const [a, b] = key.split(' ');
    out += `m${at(a!)}x${at(b!)}`;
  }
  if (game.misses > 0) out += `f${game.misses}`;
  return out;
}

/** What a compressed payload costs once it is in a URL, which is the only figure that counts. */
const chars = (buf: Buffer) => buf.toString('base64url').length;

describe('the length of a shared board', () => {
  it.skipIf(!process.env.RECURSE_SIZES)(
    'measures a code against every way of compressing one',
    { timeout: 600_000 },
    () => {
      const { graph, manifest } = shippedData();
      /*
        **Shard 00, not today's shard**, which is what `shippedData` brings and what this used
        to measure. A shard is named by id prefix, so which one holds today moves every day —
        and so did the board measured, and so did every number printed here: a par-8 board
        drawing 29 words one morning and a par-7 drawing 50 the next, which is a 30% swing in
        the answer for reasons that have nothing to do with the encoding. A figure worth
        quoting has to be a figure that comes back.

        The first letters board of the long band in that shard, by the order the file is
        written. Long, because a long answer is where a code is longest.
      */
      const puzzles = shippedShard(0).filter((one) => manifest.bands[one.band]?.mode === 0);
      const held = puzzles.find((one) => one.par >= 7) ?? puzzles[0]!;
      const bank = shippedVersion();
      const world = { graph };

      const lines = [
        `=== bank ${bank.version}, ${held.source} → ${held.target}, par ${held.par}, ` +
          `${held.board.length} words drawn`,
        `                                        |  the notation, compressed   |  the snapshot`,
        `round      guesses  moves  hints  off  | this  dict  deflate  brotli  zstd  ` +
          `| json  +dict  +zstd  (raw bytes)`,
      ];

      // The three shapes that finish. `unfinished` is in the fixture for the fuzz, where a
      // round left mid-play is a case the format has to hold; a table of lengths wants
      // comparable rounds.
      for (const named of ['tidy', 'ordinary', 'heavy'] as const) {
        const shape = SHAPES[named];
        // A different seed for the corpus than for the round measured, and the round itself
        // left out: a dictionary that has seen the answer is not a measurement of anything.
        const others = puzzles.slice(0, 120).filter((one) => one.id !== held.id);
        const dictionary = Buffer.from(
          others.map((one) => notation(playRound(one, world, shape, 11).state, one, graph.words)).join(''),
          'utf8',
        );
        /*
          And the same for the snapshot, which is the baseline worth keeping in the table: it
          is what putting the state in a URL looks like if nobody designs an encoding at all,
          and it is the *only* candidate a compressor genuinely transforms — a kilobyte of
          repeated JSON keys is what compression is for. It still loses by a factor of four,
          which is the useful thing to know: the win is in not saying it, not in squeezing it.
          Twenty rounds rather than a hundred and twenty, because a snapshot is fifteen times
          the notation and the dictionary is capped at 32KB anyway.
        */
        const snapshots = Buffer.from(
          others
            .slice(0, 20)
            .map((one) => JSON.stringify(snapshot(playRound(one, world, shape, 11).state)))
            .join(''),
          'utf8',
        );

        const state = playRound(held, world, shape).state;
        const mine = encodeBoard(snapshot(state), held, graph);
        const text = Buffer.from(notation(state, held, graph.words), 'utf8');
        const json = Buffer.from(JSON.stringify(snapshot(state)), 'utf8');

        const level = { [zlib.constants.ZSTD_c_compressionLevel]: 22 };
        const zstd = zlib.zstdCompressSync(text, { params: level });
        const brotli = zlib.brotliCompressSync(text, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: text.length,
          },
        });
        const deflate = zlib.deflateRawSync(text, { level: 9 });
        const primed = zlib.deflateRawSync(text, { level: 9, dictionary });
        const jsonPrimed = zlib.deflateRawSync(json, { level: 9, dictionary: snapshots });
        const jsonZstd = zlib.zstdCompressSync(json, { params: level });

        const off = [...state.revealed.keys()].filter((word) => !held.board.includes(word));
        const hints = [...state.hints.values()].reduce((sum, level) => sum + level, 0);
        const at = (n: number) => String(n).padStart(5);
        lines.push(
          `${named.padEnd(8)} ${String(state.guesses).padStart(8)} ${String(state.log.length).padStart(6)} ` +
            `${String(hints).padStart(6)} ${String(off.length).padStart(5)} | ` +
            [mine.length, chars(primed), chars(deflate), chars(brotli), chars(zstd)]
              .map(at)
              .join(' ') +
            ` | ${[chars(json), chars(jsonPrimed), chars(jsonZstd)].map(at).join(' ')}` +
            `  (${text.length}B, ${json.length}B)`,
        );
      }

      console.log(lines.join('\n'));
      expect(lines.length).toBeGreaterThan(2);
    },
  );
});

/** Base64url, for showing which character a six-bit group is. Six bits, 64 of them. */
const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * One case of the gallery: a round to play, and what it is meant to show.
 *
 * Built out of `Command`s so that every one of them is a round somebody could have played —
 * see lib/actions.ts.
 */
interface Case {
  title: string;
  note: string;
  puzzle: Puzzle;
  world: World;
  commands: Command[];
  /**
   * Stages above the bits that this case is *expected* not to come back identical.
   *
   * Almost every case round-trips exactly and the ladder throws if one does not, which is what
   * stops a printed example being a wrong one. The exception is the case that demonstrates the
   * format's one deliberate loss — a hint on a word the round went on to name goes out as a
   * total and comes back as one — and for that, "differs" is the fact being shown rather than a
   * fault. Naming the stages keeps the check on all the others: a case that lost something it
   * did not declare still throws.
   */
  loses?: readonly string[];
}

/**
 * Every stage the data passes through, on the way out and on the way back.
 *
 * The point of a round trip is not that it says `true` at the end — it is that the *same data*
 * can be seen at every layer it is handed between, and seen to arrive back. So each stage is
 * printed on the way down, and each one again on the way up beside whether it matched. A
 * mismatch anywhere localises the fault to one translation rather than to "the encoding".
 *
 * Nine stages down, five up. The asymmetry is not a gap: commands are what somebody *did* and
 * the game deliberately remembers less than happened — a repeat costs nothing, a refusal keeps
 * no word, five clicks on a word are one level — so the series is the first stage a code can
 * be expected to reproduce. Which is exactly what stages 4 and 12 are for.
 */
function ladder(one: Case): string[] {
  const { graph, lexicon = PLAIN } = one.world;
  const puzzle = one.puzzle;

  // Down.
  const played = one.commands.reduce(
    (at, command) => act(at, one.world, command).state,
    newGame(puzzle),
  );
  const kept = snapshot(played);
  const actions = actionsOf(kept, puzzle);
  const ops = writtenOf(actions, puzzle, graph);
  const code = writeActions(actions, puzzle, graph);

  // And up, from the characters alone.
  const read = explain(code, puzzle, graph);
  if (!read) throw new Error(`${one.title}: the codec will not read a code it wrote: ${code}`);
  const back = replayActions(read.actions, puzzle, graph);
  const game = restore(puzzle, back, lexicon.label);

  /** A game as the few facts it is: the log, the help bought, the tallies, the cursor. */
  const asGame = (state: typeof played) => {
    const moves = state.log.map((at) => `${at.from}>${at.to}#${at.order}`).join(' ') || '(none)';
    const hints = [...state.hints].map(([word, level]) => `${word}=${level}`).join(' ') || '-';
    const marks = [...state.edgeHints].join(', ') || '-';
    return (
      `${state.guesses} guesses ${moves}` +
      `  hints: ${hints}  marks: ${marks}  refused: ${state.misses}` +
      `  at: ${state.selected}  solved: ${state.solved ? 'yes' : 'no'}`
    );
  };
  const each = (list: readonly unknown[]) =>
    list.length === 0 ? '(empty)' : list.map((item) => JSON.stringify(item)).join(' ');
  const bits = read.fields.map((field) => field.bits.replace('·', '')).join('');
  const sixes = (bits.match(/.{1,6}/g) ?? []).map((six) => {
    const value = Number.parseInt(six.padEnd(6, '0'), 2);
    return `${six.padEnd(6, '·')}=${DIGITS[value]}`;
  });

  /** Every stage, and for the ones on the way up, the stage it has to match. */
  const rows: [string, string, string, string | undefined][] = [
    ['↓ 1', 'Command[]', each(one.commands), undefined],
    ['↓ 2', 'GameState', asGame(played), undefined],
    ['↓ 3', 'GameSnapshot', JSON.stringify(kept), undefined],
    ['↓ 4', 'Action[]', each(actions), undefined],
    ['↓ 5', 'Written[]', each(ops), undefined],
    ['↓ 6', 'fields', '(below)', undefined],
    ['↓ 7', 'bits', bits, undefined],
    ['↓ 8', 'characters', sixes.join(' '), undefined],
    ['↓ 9', 'the URL', `/${puzzle.id}/${code}`, undefined],
    ['↑ 10', 'Written[]', each(read.ops), each(ops) === each(read.ops) ? 'as 5' : 'DIFFERS'],
    [
      '↑ 11',
      'Action[]',
      each(read.actions),
      each(actions) === each(read.actions) ? 'as 4' : 'DIFFERS',
    ],
    [
      '↑ 12',
      'GameSnapshot',
      JSON.stringify(back),
      JSON.stringify(kept) === JSON.stringify(back) ? 'as 3' : 'DIFFERS',
    ],
    ['↑ 13', 'GameState', asGame(game), asGame(played) === asGame(game) ? 'as 2' : 'DIFFERS'],
  ];

  const out = [
    ``,
    `--- ${one.title}`,
    `    ${one.note}`,
    ...rows.map(
      ([arrow, stage, said, same]) =>
        `  ${arrow.padEnd(4)} ${stage.padEnd(12)} ${said}` +
        `${same ? `   ← ${same === 'DIFFERS' && (one.loses ?? []).includes(stage) ? 'DIFFERS — on purpose, see the note' : same}` : ''}`,
    ),
    // Stage 6 in full, which is the only place the bits say what they *mean*: the offsets, the
    // widths, and what each field named. `explain` builds it while reading, so this is the
    // codec's own account of the characters above and not a second walk of them.
    `       fields, in full — offset, width, and what it names`,
    ...read.fields.map(
      (field) =>
        `       ${String(field.at).padStart(3)}  ${field.name.padEnd(11)} ` +
        `${field.bits.padEnd(14)}  ${field.says}`,
    ),
  ];
  // A table nobody reads is worth nothing, but a table that lies is worth less. The fuzz in
  // boardCode.test.ts is the real guard; this is so a printed example cannot be wrong.
  const allowed = new Set(one.loses ?? []);
  const wrong = rows.find(([, stage, , same]) => same === 'DIFFERS' && !allowed.has(stage));
  if (wrong) throw new Error(`${one.title}: stage ${wrong[0]} did not come back`);
  // And the other way round: a case that declared a loss and did not have one is a case whose
  // note has stopped being true.
  for (const stage of allowed) {
    if (!rows.some(([, name, , same]) => name === stage && same === 'DIFFERS')) {
      throw new Error(`${one.title}: stage ${stage} was declared lossy and came back whole`);
    }
  }
  return out;
}

describe('every kind of action', () => {
  it.skipIf(!process.env.RECURSE_SIZES)(
    'shows each one encoded and read back',
    { timeout: 600_000 },
    () => {
      const { graph, manifest } = shippedData();
      const world: World = { graph };
      const puzzles = shippedShard(0).filter((one) => manifest.bands[one.band]?.mode === 0);
      const puzzle = puzzles.find((one) => one.par <= 4) ?? puzzles[0]!;
      // The words the puzzle declares, which the format *does* index now — a hint counts from
      // the figure, and this is most of it. See `putWord` in boardCode.ts for what that bought
      // and what it cost.
      const table = [puzzle.source, puzzle.target, ...puzzle.board];
      const answer = (shortestPath(graph, puzzle.source, puzzle.target, graph.commonNeighbors) ?? [])
        .slice(1);
      const onBoard = answer[0]!;
      /** A legal move from the source that the puzzle never declared. */
      const offBoard = graph
        .neighbors(puzzle.source)
        .find((one) => !table.includes(one) && one !== puzzle.target)!;
      /** A word the puzzle declares that nobody is standing on: what a hint is for. */
      const spare = table.filter(
        (one) => one !== puzzle.source && one !== puzzle.target && one !== onBoard,
      );
      /** And one it does not declare, which now costs exactly the same. See boardCode.ts. */
      const strayed = graph
        .commonNeighbors(spare[0] ?? puzzle.source)
        .find((one) => !table.includes(one) && one !== puzzle.source && one !== puzzle.target)!;

      const cases: Case[] = [
        {
          title: 'a board nobody has touched',
          note: 'The head and the tail are all a code ever must carry: a version and a terminator.',
          puzzle,
          world,
          commands: [],
        },
        {
          title: 'a guess at a word on the board',
          note: `The ordinary case. ${onBoard} is one of ${graph.neighbors(puzzle.source).length} moves from ${puzzle.source}, so the index is that wide.`,
          puzzle,
          world,
          commands: [{ do: 'guess', typed: onBoard }],
        },
        {
          title: 'a guess at a word the board never drew',
          note: `${offBoard} is not one of the puzzle's ${table.length} words — and costs exactly what the last one did, because a move is indexed against the graph.`,
          puzzle,
          world,
          commands: [{ do: 'guess', typed: offBoard }],
        },
        {
          title: 'a guess repeated, which is free',
          note: 'Three commands, one action: walking back along a move already made is navigation, and the game does not charge for it — so there is nothing to write down.',
          puzzle,
          world,
          commands: [
            { do: 'guess', typed: onBoard },
            { do: 'guess', typed: puzzle.source },
            { do: 'guess', typed: onBoard },
          ],
        },
        {
          title: 'a guess the game refuses',
          note: 'No word is remembered — GameState keeps a tally — so a run of refusals is one action carrying the count.',
          puzzle,
          world,
          commands: [
            { do: 'guess', typed: 'qzqxxvwk' },
            { do: 'guess', typed: 'qzqxxvwk' },
          ],
        },
        {
          title: 'standing at the goal and guessing backwards',
          note: 'Both ends are somewhere to stand from the first move, so the first thing in the series is where the player went to stand. Two words are reached at that point, so the index is one bit.',
          puzzle,
          world,
          commands: [
            { do: 'stand', word: puzzle.target },
            { do: 'guess', typed: answer[answer.length - 2] ?? puzzle.source },
          ],
        },
        {
          title: 'the cursor left somewhere other than the last landing',
          note: 'A tap costs nothing and leaves no trace in the log, so a trailing stand is the only record there is of one.',
          puzzle,
          world,
          commands: [
            { do: 'guess', typed: onBoard },
            { do: 'stand', word: puzzle.target },
          ],
        },
        {
          title: 'a hint on a word the board draws',
          note: `Two clicks on one word is one action with a level. A hint names a *word* rather than a move, and a word is counted from the figure: ${spare[0]} is one of the few dozen on the board, behind one bit saying so. Against the dictionary it would be number ${graph.words.indexOf(spare[0]!)} of ${graph.words.length} — two nine-bit chunks, which is what this used to cost and what made hints half the format.`,
          puzzle,
          world,
          commands: [
            { do: 'hint', word: spare[0]! },
            { do: 'hint', word: spare[0]! },
          ],
        },
        {
          title: 'a hint on a word the board never drew',
          note: `The expensive one, and the reason the dictionary is still here. ${strayed} is neither reached nor declared, so there is no position on the figure to name it by and the flag bit falls the other way: an index into all ${graph.words.length} words. Mark targets land here most often.`,
          puzzle,
          world,
          commands: [{ do: 'hint', word: strayed }],
        },
        {
          title: 'several hints, under one tag',
          note: 'A run of them shares an operation, so the tag is paid once and what is left is the two facts a hint is: which word, and how far it went.',
          puzzle,
          world,
          commands: [
            { do: 'hint', word: spare[0]! },
            { do: 'hint', word: spare[1]! },
            { do: 'hint', word: spare[1]! },
            { do: 'hint', word: spare[2]! },
          ],
        },
        {
          title: 'a hint on a word the round goes on to name',
          note: `The one thing a code deliberately loses. Once ${onBoard} is guessed the figure spells it out in full and shows nothing for the hint that was bought on it, so the word is not carried — only the levels, added into one \`spent\` total so the tally stays exact. A full-fidelity variant is this branch of \`written\` removed.`,
          puzzle,
          world,
          commands: [
            { do: 'hint', word: onBoard },
            { do: 'hint', word: onBoard },
            { do: 'guess', typed: onBoard },
          ],
          loses: ['Action[]', 'GameSnapshot', 'GameState'],
        },
        {
          title: 'a move mark bought',
          note: 'What a word on the answer sells instead of its letters. The action names the edge, because that is what gets read back — not "the next unbought one".',
          puzzle,
          world,
          commands: [
            { do: 'mark', word: spare[0]!, to: graph.commonNeighbors(spare[0]!)[0]! },
          ],
        },
        {
          title: 'everything at once, in order',
          note: 'Which is what a shared board usually is. Note the stand between the two guesses: the second was made from somewhere other than where the first landed.',
          puzzle,
          world,
          commands: [
            { do: 'guess', typed: offBoard },
            { do: 'stand', word: puzzle.source },
            { do: 'guess', typed: onBoard },
            { do: 'guess', typed: 'qzqxxvwk' },
            { do: 'hint', word: spare[0]! },
            { do: 'hint', word: spare[1]! },
            { do: 'mark', word: spare[2]!, to: graph.commonNeighbors(spare[2]!)[0]! },
          ],
        },
      ];

      const lines = [
        `=== bank ${shippedVersion().version} — every kind of action, on ${puzzle.source} → ${puzzle.target}`,
        `    ${table.length} words in the puzzle, par ${puzzle.par}`,
        ...cases.flatMap(ladder),
      ];

      /*
        And the one action the letters game cannot produce: a spelling that names two
        pronunciations is one guess and two moves. Found rather than written down — which
        spellings are ambiguous is a fact about CMUdict — so the search says what it found.
      */
      const sound = shippedModes().find((one) => one.name === 'phonemes');
      if (sound) {
        const heard = shippedData(sound.band);
        const world = { graph: heard.graph, lexicon: heard.lexicon };
        const boards = shippedShard(0).filter(
          (one) => heard.manifest.bands[one.band]?.mode === sound.mode,
        );
        let shown = false;
        for (const board of boards) {
          if (shown) break;
          for (const at of [board.source, board.target]) {
            const bySpelling = new Map<string, string[]>();
            for (const token of heard.graph.neighbors(at)) {
              const spelling = heard.lexicon.label(token);
              bySpelling.set(spelling, [...(bySpelling.get(spelling) ?? []), token]);
            }
            const found = [...bySpelling].find(([, tokens]) => tokens.length > 1);
            if (!found) continue;
            const [typed, tokens] = found;
            lines.push(
              ...ladder(
                {
                  title: 'one typed word, two pronunciations',
                  note:
                    `In the sound game a node is a pronunciation, so "${typed}" names ` +
                    `${tokens.map((token) => `/${heard.lexicon.transcribe(token)}/`).join(' and ')} — ` +
                    `one guess against the score, two moves on the board. The second is written ` +
                    `as an "also", which is why a guess that names one costs nothing for the ` +
                    `possibility.`,
                  puzzle: board,
                  world,
                  commands: [{ do: 'stand', word: at }, { do: 'guess', typed }],
                },
              ),
            );
            shown = true;
            break;
          }
        }
        if (!shown) lines.push(``, `--- no ambiguous spelling found in shard 00`);
      }

      console.log(lines.join('\n'));
      expect(lines.length).toBeGreaterThan(10);
    },
  );
});
