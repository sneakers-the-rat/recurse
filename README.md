# recurse

> *"Fiendish game. Deeply frustrating. Has cost me a lot of productivity. Clearly this is working as intended"*
>
> *"had to stop myself from playing the long so I could eat lunch (now two hours late)"*
>
> *"I am too stupid and impatient for this"*
>
> *"uh oh"*

A daily word game. Get from one word to another by adding or removing a whole word from
inside it.

    colorations − ratio = colons
    courage     − our   = cage
    base        + ball  = baseball

Each move deletes or inserts one unbroken run of letters that is itself a word. The result must also be a word.

There is a second game played by ear, where a word is its *pronunciation* rather than its
spelling, so a move finds a word inside a word by sound:

    car -> c + robe + ar -> crowbar

go to <https://jon-e.net/recurse/>

## Requirements

- Node 22 or later
- Rust (stable), to build the puzzle data

## Setup

    npm install
    npm run data

`npm run data` writes `public/data/`, which is generated and not committed. The app will not
start without it.

## Development

    npm run dev        # dev server on http://localhost:5173
    npm run build      # production build into dist/
    npm run preview    # serve the last build in dist/ — static, no watch, no rebuild

`npm run dev` re-extracts the message catalog whenever a file under `src/i18n/messages/`
changes, and reloads the page. That is not a nicety: `src/locales/en.json` is what gets
rendered, and a descriptor's own `defaultMessage` is only a fallback for an id the catalog
has not got — so editing the English and reloading used to show the old words.

The developer panel is off by default. Turn it on with `?dev` in the URL, Ctrl+D, or the
switch at the foot of the help dialog.

## Tests

    npm test                                           # unit tests (src/lib)
    npx tsc --noEmit                                   # typecheck
    npm run e2e                                        # browser tests, phone and desktop
    cargo test --manifest-path tools/graphgen/Cargo.toml

Browser tests need `public/data/`. Screenshot-only specs are skipped unless `RECURSE_LOOK=1`
is set, and `src/lib/pivots.test.ts` unless `RECURSE_PIVOTS=1` is — both are instruments to be
read rather than tests to pass.

`npm test` runs two vitest groups. `unit` is everything else and keeps the five-second default,
which is a real instrument on tests that answer in a millisecond. `fuzz` is `*.fuzz.test.ts` —
rounds walked over real boards

    RECURSE_FUZZ=200 npx vitest run --project=fuzz

## Data

Every parameter is in `recurse.yaml`, which declares the **modes** — one game each, with its own
alphabet, bands and rule knobs. Any value can be overridden for one run, for every mode or for
one:

    npm run data

Every build reports, per mode, how many candidates each selection rule refused — in total and as
a grid by par — and how even the bands came out. `RECURSE_AUDIT=1` changes how those refusals are
attributed: by default each candidate stops at the first rule that turned it down, and with the
audit every rule is judged against every candidate. The audit is exact and slow: hours on the
current bank, against about twenty minutes for a plain build of both modes.

The first build takes a while. Each mode's search is cached separately in `tools/cache/`, keyed
on everything that determines it, so a run that changes only the calendar — or only one mode —
takes seconds for the rest.

Outputs:

    public/data/{mode}/dictionary-{d}.json   every legal word, in that mode's alphabet
    public/data/{mode}/graph-{d}.json        the legal and common graphs, as neighbour rows
    public/data/{mode}/common-{d}.json       which dictionary words are common
    public/data/{mode}/lexicon-{d}.json      spellings and phonemes, for a translated alphabet
    public/data/puzzles/                     the bank, one file per id prefix, and a manifest

`{d}` is a digest of those four files' bytes, because they are cached by name for good.

### graphgen

    graphgen — build the recurse graph and puzzle bank

      graphgen                       build everything into public/data
      graphgen pair <from> <to>      judge one pair and print what a build would decide
      graphgen routes <word>...      bank answers running through all of these words
      graphgen --help

Both inspection commands run against every mode and say which one they are talking about.

`npm run data:build` builds the binary alone, at
`tools/graphgen/target/release/graphgen`.

## Deployment

A push to `main` runs `.github/workflows/github-pages.yml`: the builder, then the web build,
then GitHub Pages. Pages must be set to deploy from GitHub Actions
(Settings → Pages → Source). `.github/workflows/ci.yml` runs the tests on every push.

## Layout

    recurse.yaml         every parameter, and the modes
    tools/graphgen/      the builder: corpora, graph, puzzle bank, JSON
    public/data/         generated data the browser fetches
    src/lib/             game logic, no React
    src/components/      React, no game logic
    e2e/                 browser tests

## ai disclosure

i used the text robot to brute force some of the game since this is a game and it being correct doesn't matter. i already had the core of the game written, and i've been playing with this idea for more than 5 years, so this is not a case of "hey chappie t make me a word game." it makes a mess of raw material and then i have to painstakingly pull out the twigs. this game was just gathering dust otherwise, so i tried what they say about the vibe coding, and i would say it took about the same amount of time but with substantially more fucked up code. to its credit, the game exists where before it didn't really, in a sort of "hatereading makes you put in effort because it sucks so bad" kind of way.

## Licensing

The intention with this game is for it to be free to play, own, use, modify, and distribute for normal people, but not for commercial use.
Until I can figure out a good way to license this, I'll leave it as copyright reserved.
