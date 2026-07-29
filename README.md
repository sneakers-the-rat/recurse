# recurse

A daily word game. Get from one word to another by adding or removing a whole word from
inside it.

    colorations − ratio = colons
    courage     − our   = cage
    base        + ball  = baseball

Each move deletes or inserts one unbroken run of letters that is itself a word. The result
must also be a word.

Every day offers three boards — **short**, **medium** and **long** — chosen by how many moves
the answer takes. Each is addressed by its own URL and keeps its own progress.

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
    npm run preview    # serve dist/

The developer panel is off by default. Turn it on with `?dev` in the URL, Ctrl+D, or the
switch at the foot of the help dialog.

## Tests

    npm test                                           # unit tests (src/lib)
    npx tsc --noEmit                                   # typecheck
    npm run e2e                                        # browser tests, phone and desktop
    cargo test --manifest-path tools/graphgen/Cargo.toml

Browser tests need `public/data/`. Screenshot-only specs are skipped unless `RECURSE_LOOK=1`
is set.

## Data

Every parameter is in `.env`. Any of them can be overridden for one run:

    RECURSE_MAX_SWAPS=1 npm run data

Every build reports how many candidates each selection rule refused — in total, and as a grid
by par — and how the three lengths came out. `RECURSE_AUDIT=1` changes how those refusals are
attributed: by default each candidate stops at the first rule that turned it down, and with the
audit every rule is judged against every candidate. The audit is exact and slow: hours on the
current bank, against about six minutes for a plain build.

The first build takes several minutes. The result of the search is cached in `tools/cache/`,
keyed on everything that determines it, so a run that changes only the calendar takes
seconds.

Outputs:

    public/data/dictionary.json   every legal word
    public/data/graph.json        the legal and common graphs, as neighbour rows
    public/data/common.json       which dictionary words are common
    public/data/puzzles/          the bank, one file per id prefix, and a manifest
    tools/survey.txt              the bank in readable form

### graphgen

    graphgen — build the recurse graph and puzzle bank

      graphgen                       build everything into public/data
      graphgen pair <from> <to>      judge one pair and print what a build would decide
      graphgen --help

    Every number comes from .env; any RECURSE_* value can be overridden for one run:

      RECURSE_ALT_WAYS=6 graphgen pair understanding keynoting

`npm run data:build` builds the binary alone, at
`tools/graphgen/target/release/graphgen`.

## Deployment

A push to `main` runs `.github/workflows/github-pages.yml`: the builder, then the web build,
then GitHub Pages. Pages must be set to deploy from GitHub Actions
(Settings → Pages → Source). `.github/workflows/ci.yml` runs the tests on every push.

## Layout

    .env                 every parameter
    tools/graphgen/      the builder: corpora, graph, puzzle bank, JSON
    public/data/         generated data the browser fetches
    src/lib/             game logic, no React
    src/components/      React, no game logic
    e2e/                 browser tests
