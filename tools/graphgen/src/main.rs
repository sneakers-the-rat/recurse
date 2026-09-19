//! Build the recurse-word graph and the daily puzzle bank.
//!
//! A *move* takes one word to another by deleting a contiguous run of letters
//! that is itself a word, or by inserting one. Removal and insertion are
//! inverses, so the graph is undirected:
//!
//!     baseball  --[ball @ 4]--  base
//!     courage   --[our  @ 1]--  cage
//!
//! Two dictionary tiers, doing genuinely different jobs:
//!
//! * LEGAL (SCOWL 80) *is* the game — the graph that ships, the words a player
//!   may guess, the distances the board is drawn from. Every real word plays.
//! * COMMON (SCOWL 35) never restricts play. It only filters which puzzles get
//!   offered, to ones whose best route is made of words people recognise.
//!
//! Nothing about "good taste" is enforced as a rule. Bare endings like -less are
//! legal moves; they are merely avoided when choosing an intended solution.
//!
//! Outputs into public/data/:
//!     dictionary.json  every legal word; also the index the edge list refers to
//!     graph.json       both graphs as neighbour rows, ready to use unassembled
//!     puzzles/         the bank, one file per id prefix, plus a manifest

mod bank;
mod calendar;
mod config;
mod date;
mod graph;
mod id;
mod lexicon;
mod phonetic;
mod progress;
mod regions;
mod select;
mod word;
mod words;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use config::{Alphabet, Audit, Config, Mode};
use graph::{FxMap, FxSet};
use lexicon::Lexicon;

const USAGE: &str = "\
graphgen — build the recurse graph and puzzle bank

  graphgen                       build everything into public/data
  graphgen pair <from> <to>      judge one pair and print what a build would decide
  graphgen routes <word>...      bank answers running through all of these words, and
                                 the top ten words they keep company with
  graphgen ngram [-n 2] [-k 20]  the commonest sets of n words that share an answer
  graphgen --help

  --mode <name>                  ask only this game, rather than every one

The inspection commands report on every mode in recurse.yaml and say which one they are
talking about. Curating one game means asking only that one — and it is not just tidier
output: a mode not asked about is never searched, which is most of the time.

  graphgen --mode phonemes routes king          what king hubs with
  graphgen --mode phonemes routes reed did      and what that pair hubs with
  graphgen --mode phonemes ngram -n 3 -k 50     the fifty commonest triples
  graphgen --mode phonemes pair courtroom court

Every number comes from that file; any of them can be overridden for one run, for all
modes or for one:

  RECURSE_ALT_WAYS=6 graphgen pair understanding keynoting
  RECURSE_PHONEMES_MIN_SUB=1 graphgen
";

/// What this run is for.
///
/// Hand-parsed, because the crate is held to dependencies that have to agree with something
/// outside it — a digest and a stemmer — and argument parsing is not one of those.
enum Command {
    /// Build everything. What `npm run data` does.
    Build,
    /// Judge one pair and print it, for looking at a puzzle without building a bank.
    Pair(String, String),
    /// Show the bank's answers that run through all of these words. See `show_routes`.
    Routes(Vec<String>),
    /// The commonest sets of `n` words that share an answer. See `show_ngrams`.
    Ngram { k: usize, n: usize },
}

/// Pull `--mode <name>` off the front, if it is there.
///
/// Hand-parsed like the rest, and deliberately only a prefix: it says which game a question
/// is about, so it belongs before the question rather than buried in it.
fn take_mode(args: &[String]) -> Result<(Option<String>, &[String]), String> {
    match args {
        [flag, name, rest @ ..] if flag == "--mode" => Ok((Some(name.clone()), rest)),
        [flag] if flag == "--mode" => Err(format!("`--mode` needs a name.\n\n{USAGE}")),
        rest => Ok((None, rest)),
    }
}

fn command(args: &[String]) -> Result<Command, String> {
    match args {
        [] => Ok(Command::Build),
        [verb] if verb == "-h" || verb == "--help" => Err(USAGE.to_string()),
        [verb, from, to] if verb == "pair" => Ok(Command::Pair(from.clone(), to.clone())),
        [verb, ..] if verb == "pair" => {
            Err(format!("`pair` takes exactly two words.\n\n{USAGE}"))
        }
        [verb, words @ ..] if verb == "routes" && !words.is_empty() => {
            Ok(Command::Routes(words.to_vec()))
        }
        [verb, ..] if verb == "routes" => {
            Err(format!("`routes` takes at least one word.\n\n{USAGE}"))
        }
        [verb, rest @ ..] if verb == "ngram" => {
            let (mut k, mut n) = (20usize, 2usize);
            let mut at = rest.iter();
            while let Some(flag) = at.next() {
                let value = at.next().ok_or_else(|| {
                    format!("`{flag}` needs a number.\n\n{USAGE}")
                })?;
                let parsed = value
                    .parse::<usize>()
                    .map_err(|_| format!("`{flag}` needs a number, got {value:?}.\n\n{USAGE}"))?;
                match flag.as_str() {
                    "-k" => k = parsed,
                    "-n" => n = parsed,
                    other => return Err(format!("unknown option {other:?}.\n\n{USAGE}")),
                }
            }
            // Four ids pack into the `u128` the counter is keyed by, and past three or four
            // words a "set that share an answer" stops being a thing anyone can act on.
            if !(1..=MAX_GRAM).contains(&n) {
                return Err(format!("`-n` has to be between 1 and {MAX_GRAM}.\n\n{USAGE}"));
            }
            if k == 0 {
                return Err(format!("`-k` has to be at least 1.\n\n{USAGE}"));
            }
            Ok(Command::Ngram { k, n })
        }
        [verb, ..] => Err(format!("unknown command {verb:?}.\n\n{USAGE}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = take_mode(&args).and_then(|(only, rest)| Ok((only, command(rest)?)));
    let (only, command) = match parsed {
        Ok(both) => both,
        // Usage is not an error to be dressed in red; it is the answer to the question asked.
        Err(message) if args.iter().any(|a| a == "-h" || a == "--help") => {
            eprint!("{message}");
            return;
        }
        Err(message) => {
            eprintln!("\x1b[31merror\x1b[0m: {message}");
            std::process::exit(1);
        }
    };
    if let Err(message) = run(command, only.as_deref()) {
        eprintln!("\x1b[31merror\x1b[0m: {message}");
        std::process::exit(1);
    }
}

/// Repo root, found by walking up from the executable or the current directory.
fn find_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;
    loop {
        if dir.join(config::FILE).exists() && dir.join("package.json").exists() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err(format!(
                "could not find the repo root (no {} beside package.json)",
                config::FILE
            ));
        }
    }
}

/// One mode's whole contribution to a build: the alphabet it plays in, the two graphs over
/// it, and the puzzles the rules let through.
///
/// Owned rather than borrowed, because a build holds every mode's at once — the calendar is
/// shared, so nothing can be written until all of them are searched.
struct Built<'a> {
    mode: &'a Mode,
    lex: Lexicon,
    /// The digest of this mode's vocabulary: what every puzzle id in it is taken over,
    /// and what names its shipped dictionary and graph. See `id::vocab_spec`.
    vocab: String,
    legal: graph::Graph,
    common: graph::Graph,
    /// The common graph carved into territories, for the explore mode's map. Indexed by
    /// *common-graph* word id, like the graph it is about. See regions.rs.
    regions: regions::Regions,
    /// Before `schedule`, which runs once over the merged bank.
    ///
    /// Absent when the question did not need one. See `Want`.
    found: Option<select::Selection>,
}

impl Built<'_> {
    /// The bank, for the callers that only run when there is one.
    fn bank(&self) -> &select::Selection {
        self.found.as_ref().expect("asked for a bank the run did not build")
    }
}

/// What every mode is built from, loaded once.
///
/// The SCOWL tiers are cached by size because two modes can ask for the same one, and
/// re-reading a 2MB list per mode to arrive at the same `HashSet` is waste. Frequency is
/// one list and orders every mode's endpoints and labels.
struct Corpora {
    scowl: HashMap<u32, std::collections::HashSet<String>>,
    blocked: std::collections::HashSet<String>,
    rank: FxMap<String, usize>,
    /// CMUdict, loaded only if some mode is in the phonemes alphabet.
    said: Option<phonetic::Pronunciations>,
    /// A digest of each raw source this load actually read, for the tripwire in
    /// recurse.yaml's `sources:` block. See `words::Sources::check`.
    ///
    /// The blocklist is deliberately not among them: it is a file in this repo rather than a
    /// download, and it is already hashed into the bank cache key.
    seen: words::Sources,
}

impl Corpora {
    /// Everything the modes being asked about are built from, and nothing else — so asking
    /// only the letters game never downloads or parses a pronunciation dictionary.
    fn load(cache: &Path, root: &Path, modes: &[&Mode]) -> Result<Corpora, String> {
        let blocked = words::load_list(&root.join("tools").join("blocklist.txt"))?;
        let mut seen = words::Sources::default();
        let mut scowl = HashMap::new();
        for mode in modes {
            for size in [mode.legal_scowl, mode.common_scowl] {
                if !scowl.contains_key(&size) {
                    scowl.insert(size, words::load_scowl(cache, size, &mut seen)?);
                }
            }
        }
        let rank: FxMap<String, usize> = words::load_frequency(cache, &mut seen)?
            .iter()
            .enumerate()
            .map(|(i, w)| (w.clone(), i))
            .collect();
        let wanted = modes.iter().any(|mode| mode.alphabet == Alphabet::Phonemes);
        let said = if wanted { Some(phonetic::load(cache, &mut seen)?) } else { None };
        Ok(Corpora { scowl, blocked, rank, said, seen })
    }

    /// One tier's spellings: in the list, not blocked, and long enough to be a subword.
    ///
    /// The length test is in *letters* even for a phonemes mode, because at this point a
    /// word is still a spelling — the alphabet is applied by `Lexicon`, and its own minimum
    /// is enforced by `graph::build`.
    fn tier(&self, size: u32) -> Vec<String> {
        let mut out: Vec<String> = self.scowl[&size]
            .iter()
            .filter(|w| !self.blocked.contains(*w))
            .cloned()
            .collect();
        out.sort();
        out
    }
}

/// Search one mode: turn the corpora into its alphabet, build its two graphs, and select.
///
/// The two graphs are identical construction over different corpora — a word can be a node
/// if it is long enough, and a run can be removed if the corpus contains it — and the tiers
/// differ only in which words those are. That is as true of pronunciations as of spellings,
/// which is the whole reason a second alphabet costs a lexicon and nothing else.
/// How much of a mode a command needs.
///
/// **Only a build may search.** An inspection command reports on a bank that exists; if the
/// config has moved since one was made, the honest answer is to say so, not to spend six
/// minutes quietly making one. That is not a preference — a `routes` run that searches leaves a
/// *cached* bank newer than `public/data`, and then `routes` sees the new rules while everything
/// reading the shipped files sees the old ones. Which is exactly the confusion this comment
/// exists to prevent: the same pivot table, run after run, against data nothing had rewritten.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Want {
    /// Graphs only. `pair` judges one pair against the rules and needs no bank at all, so it
    /// answers in a second — it is the taste loop and has to stay quick.
    Graphs,
    /// A bank that has already been searched. Refuses rather than searching.
    Cached,
    /// Search if there is no cache. Only a build.
    Search,
}

fn build_mode<'a>(
    mode: &'a Mode,
    corpora: &Corpora,
    config: &Config,
    cache: &Path,
    blocklist: &[String],
    threads: usize,
    want: Want,
) -> Result<Built<'a>, String> {
    eprintln!("\n=== mode {} ({}) ===", mode.name, mode.alphabet.name());

    let legal_spellings = corpora.tier(mode.legal_scowl);
    let common_spellings = corpora.tier(mode.common_scowl);

    let lex = match mode.alphabet {
        Alphabet::Letters => Lexicon::letters(legal_spellings, common_spellings),
        Alphabet::Phonemes => {
            let said = corpora
                .said
                .as_ref()
                .expect("cmudict is loaded whenever a mode is in phonemes");
            let lex =
                Lexicon::phonemes(&legal_spellings, &common_spellings, said, &corpora.rank);
            // How much of the spelling corpus made it into this alphabet. A pronunciation
            // dictionary covers a fraction of SCOWL's long tail, and the shape of that gap
            // decides what the mode can offer — so it is printed rather than left to be
            // discovered as a thin bank.
            let covered = |list: &[String]| list.iter().filter(|w| said.contains_key(*w)).count();
            eprintln!(
                "  pronunciations: {} of {} legal spellings and {} of {} common ones are in \
                 cmudict",
                covered(&legal_spellings),
                legal_spellings.len(),
                covered(&common_spellings),
                common_spellings.len(),
            );
            lex
        }
    };
    eprintln!(
        "  corpora: {} legal (SCOWL {}), {} common (SCOWL {})",
        lex.legal.len(),
        mode.legal_scowl,
        lex.common.len(),
        mode.common_scowl,
    );

    /*
        The vocabulary digest, and the tripwire on it.

        Every puzzle id is a digest of the game, its pair and this — see id.rs — because a
        shared board's code indexes into the legal moves from a word and into the dictionary,
        and both of those are functions of exactly the word list and the two lengths hashed
        here. So a change to any of them is a change to *which puzzles exist*, and the ids say
        so rather than resolving to boards whose codes quietly mean something else.

        Which makes it worth being told. `vocab` in recurse.yaml is a value the build refuses
        to disagree with: declare it and every accidental change to the corpus or to `minWord`
        or `minSub` stops the build with what it would have cost. Leave it out and the build
        prints the digest and carries on, which is what a first build and a deliberate change
        both want.
    */
    let vocab = id::digest(
        id::vocab_spec(mode.alphabet.name(), mode.min_word, mode.min_sub, &lex.legal).as_bytes(),
        8,
    );
    match mode.vocab.as_deref() {
        Some(declared) if declared != vocab => {
            return Err(format!(
                "mode {}: the vocabulary is {vocab}, and recurse.yaml declares {declared}.\n\
                 Every puzzle id in this mode is a digest of its vocabulary, so this rebuild \
                 would rename every board and invalidate every shared board code written \
                 against the old ones.\n\
                 If that is intended, set `vocab: {vocab}` for this mode; if it is not, the \
                 word list, minWord or minSub has moved since it was declared",
                mode.name,
            ));
        }
        Some(_) => eprintln!("  vocabulary: {vocab}, as declared"),
        None => eprintln!("  vocabulary: {vocab} — declare it as `vocab:` to be told when it moves"),
    }

    let legal_subs: FxSet<&str> =
        lex.legal.iter().filter(|w| w.len() >= mode.min_sub).map(String::as_str).collect();
    let common_subs: FxSet<&str> =
        lex.common.iter().filter(|w| w.len() >= mode.min_sub).map(String::as_str).collect();

    let tier = |name: &str, tokens: &[String], subs: &FxSet<&str>| {
        let phase = Instant::now();
        let nodes: Vec<String> =
            tokens.iter().filter(|w| w.len() >= mode.min_word).cloned().collect();
        let built = graph::build(nodes, subs, mode.min_word, mode.min_sub, threads);
        eprintln!(
            "  {name} graph: {} edges over {} words in {:.1}s",
            built.edges.len(),
            built.adjacency.iter().filter(|a| !a.is_empty()).count(),
            phase.elapsed().as_secs_f64()
        );
        built
    };
    let legal = tier("legal ", &lex.legal, &legal_subs);
    let common = tier("common", &lex.common, &common_subs);

    // The explore mode's map: the common graph, minus the components too small to be anywhere,
    // carved into territories. Cheap next to either graph, and every command gets one because
    // `pair` and `routes` are worth being able to ask which region a word is in.
    let phase = Instant::now();
    let ranks: Vec<usize> = common
        .words
        .iter()
        .map(|token| {
            // A phonemes token is ranked by its most familiar spelling; a letters token is its
            // own spelling. Unranked words sort last and so never name a region over a word the
            // frequency list has heard of.
            let spelling = lex.labels(token).first().map(String::as_str).unwrap_or(token);
            corpora.rank.get(spelling).copied().unwrap_or(usize::MAX)
        })
        .collect();
    let regions = regions::build(&common, mode.min_component, &ranks, config.shared.seed);
    let size = regions.sizes();
    eprintln!(
        "  regions: {} over {} words in {} component(s) — {} of ten words or more, holding {} \
         of them ({:.0}%), largest {}. {} word(s) are off the map, in components under {}. \
         {:.1}s",
        size.count,
        size.words,
        regions.components,
        size.real,
        size.in_real,
        100.0 * size.in_real as f64 / size.words.max(1) as f64,
        size.largest,
        regions.dropped,
        mode.min_component,
        phase.elapsed().as_secs_f64(),
    );

    if want == Want::Graphs {
        return Ok(Built { mode, lex, vocab, legal, common, regions, found: None });
    }

    // The search is the expensive half and its result is cached; the calendar and the output
    // files are rebuilt every run, because they are seconds and because their knobs are not
    // part of what the search depends on. See bank.rs.
    let phase = Instant::now();
    let bank_path = bank::path(cache, &bank::key(mode, blocklist, config.shared.id_chars, &vocab));
    let found = match bank::load(&bank_path) {
        Some(cached) if config.audit == Audit::Off => {
            eprintln!(
                "  puzzles: {} from cache ({}), {} candidates — delete it or change a rule to \
                 search again",
                cached.puzzles.len(),
                bank_path.file_name().unwrap_or_default().to_string_lossy(),
                cached.candidates,
            );
            // **Re-band what came out of the cache**, because `bandCuts` is not in the key.
            //
            // A puzzle's band is stamped where it is built, and the cached bank carries it —
            // but the cuts decide only how the puzzles that were found get *labelled*, not
            // which ones exist, so they are deliberately not part of what the search depends
            // on. Left as they were read, moving a cut against a warm cache changed the band
            // table in the report, the calendar and the shards not at all: the build said the
            // old split, convincingly, and there was nothing to notice. Putting the cuts in
            // the key instead would be correct and would cost a full re-search — a quarter of
            // an hour — to relabel puzzles that have not moved.
            let mut puzzles = cached.puzzles;
            for puzzle in &mut puzzles {
                puzzle.band = mode.global_band(mode.band_of(puzzle.par));
            }
            select::Selection {
                passed: puzzles.len(),
                puzzles,
                rejections: cached.rejections,
                candidates: cached.candidates,
            }
        }
        // Nothing cached, and this command may not make one. See `Want`.
        None if want == Want::Cached => {
            return Err(format!(
                "mode {}: no bank has been searched for these rules yet ({}). Run `npm run data` \
                 first — it writes the bank *and* public/data together, which is what keeps the \
                 shipped files and the diagnostics talking about the same thing",
                mode.name,
                bank_path.file_name().unwrap_or_default().to_string_lossy(),
            ));
        }
        _ => {
            let found = select::select(
                &common,
                &common_subs,
                &legal,
                mode,
                &lex,
                &corpora.rank,
                &vocab,
                config.audit,
                threads,
            )?;
            eprintln!(
                "  puzzles: {} of {} candidates passed the rules, in {:.1}s",
                found.passed,
                found.candidates,
                phase.elapsed().as_secs_f64()
            );
            // An audit is a way of looking at the bank rather than a different bank, so it
            // reports its table and leaves the cache alone.
            if config.audit == Audit::Off {
                bank::save(&bank_path, &found)?;
                eprintln!("    cached the bank in tools/cache/");
            }
            found
        }
    };

    Ok(Built { mode, lex, vocab, legal, common, regions, found: Some(found) })
}

fn run(command: Command, only: Option<&str>) -> Result<(), String> {
    let started = Instant::now();
    let root = find_root()?;
    let cache = root.join("tools").join("cache");
    let data = root.join("public").join("data");
    let config = Config::load(&root)?;
    progress::publish_in(&root);

    eprintln!("config: {:?}", config);

    // Two cores short of the machine, so the rest of the computer stays usable while
    // a build runs. At least one either way.
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .saturating_sub(2)
        .max(1);
    eprintln!("threads: {threads}");

    // Which games this run is about. A build is always all of them — the calendar is shared,
    // so a bank missing a mode is a band with no boards in it — but an inspection can be
    // about one, and then the others are never searched at all. That is the point of the
    // flag: curating the phonemes game should not cost a letters search.
    let asked: Vec<&Mode> = match only {
        None => config.modes.iter().collect(),
        Some(name) => {
            if matches!(command, Command::Build) {
                return Err(
                    "`--mode` is for the inspection commands. A build writes one calendar over \
                     every game at once, so leaving a mode out would ship a band with no boards \
                     in it."
                        .into(),
                );
            }
            let found: Vec<&Mode> = config.modes.iter().filter(|m| m.name == name).collect();
            if found.is_empty() {
                return Err(format!(
                    "no mode called {name:?}. {} has: {}",
                    config::FILE,
                    config.modes.iter().map(|m| m.name.as_str()).collect::<Vec<_>>().join(", "),
                ));
            }
            found
        }
    };

    let corpora = Corpora::load(&cache, &root, &asked)?;
    corpora.seen.check(&config.shared.sources)?;
    let mut blocklist: Vec<String> = corpora.blocked.iter().cloned().collect();
    blocklist.sort();

    // Every mode asked about, searched. They are independent — one alphabet, one pair of
    // graphs, one bank each — and only the calendar joins them, which is why nothing is
    // written until the last of them is done.
    let want = match command {
        Command::Pair(..) => Want::Graphs,
        Command::Routes(..) | Command::Ngram { .. } => Want::Cached,
        Command::Build => Want::Search,
    };
    let mut built: Vec<Built> = Vec::with_capacity(asked.len());
    for mode in asked {
        built.push(build_mode(mode, &corpora, &config, &cache, &blocklist, threads, want)?);
    }

    // Both inspection commands run against every mode and say which one they are talking
    // about, because "the puzzle about these two words" now has an answer per game.
    match &command {
        Command::Pair(from, to) => return inspect_pair(&built, &corpora.rank, from, to),
        Command::Routes(asked) => {
            return show_routes(&built, &config, &cache, &blocklist, asked)
        }
        Command::Ngram { k, n } => {
            for one in &built {
                let path = bank::path(
                    &cache,
                    &bank::key(one.mode, &blocklist, config.shared.id_chars, &one.vocab),
                );
                eprintln!("\n=== {} ===", one.mode.name);
                show_ngrams(one, &path, *k, *n)?;
            }
            return Ok(());
        }
        Command::Build => {}
    }

    // --------------------------------------------------------------- the bank
    //
    // One bank, one id space, one calendar. A puzzle already knows which band it is —
    // `select` set it from its own mode's cuts — so merging is a concatenation and
    // `schedule` can order every band against the others. See `schedule`.
    let mut selection = select::Selection {
        passed: built.iter().map(|one| one.bank().passed).sum(),
        candidates: built.iter().map(|one| one.bank().candidates).sum(),
        puzzles: built.iter().flat_map(|one| one.bank().puzzles.iter().cloned()).collect(),
        rejections: select::Rejections::default(),
    };
    // The calendar is judged on what each board *draws*, not on its two endpoints, so it needs
    // the graph the board was drawn from. See calendar.rs.
    let graph_of_mode: Vec<&graph::Graph> = built.iter().map(|one| &one.common).collect();
    let mode_of_band = mode_of_band(&config, &built);
    check_bands(&config, &selection.puzzles)?;
    let mode_names: Vec<&str> = built.iter().map(|one| one.mode.name.as_str()).collect();
    let dealt = calendar::deal(
        &mut selection,
        &config.shared,
        config.band_count(),
        &graph_of_mode,
        &mode_of_band,
    );

    // Rules are reported per mode, because a tally is about one graph: the two modes refuse
    // different numbers of different things and a sum of them means nothing.
    for one in &built {
        eprintln!("\nmode {} —", one.mode.name);
        report_rules(one.bank(), config.audit != Audit::Off);
        eprintln!(
            "  by par: {}",
            par_histogram(one.bank())
                .iter()
                .map(|(p, n)| format!("{p}:{n}"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        report_boards(one.bank());
    }
    report_bands(&selection, &config);
    calendar::report(&dealt, &mode_of_band, &mode_names);
    // The first few boards of the calendar, read through the lexicon of whichever game they
    // came from — a phonemes puzzle printed raw is a row of phoneme codes.
    for at in (0..dealt.days.min(5)).map(|day| dealt.on(0, day) as usize) {
        let puzzle = &selection.puzzles[at];
        let lex = built
            .iter()
            .find(|one| {
                puzzle.band >= one.mode.band_base
                    && puzzle.band < one.mode.band_base + one.mode.bands.len()
            })
            .map(|one| &one.lex);
        let say = |token: &str| match lex {
            Some(lex) => show(lex, token),
            None => token.to_string(),
        };
        eprintln!(
            "    {} -> {} par={} board={} alt={}",
            say(&puzzle.source),
            say(&puzzle.target),
            puzzle.par,
            puzzle.corridor_size,
            puzzle.alt_nodes
        );
    }

    // ----------------------------------------------------------------- output
    check_ids(&selection.puzzles, &config)?;
    write_outputs(&data, &config, &built, &selection, &dealt)?;
    progress::published_done();
    eprintln!("done in {:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}

/// Judge one pair and print what the build would decide about it, then stop.
///
/// The taste loop for what a puzzle *is*. A full build searches twenty-eight million candidate
/// pairs to answer a question about one of them, so every change to the rules or to what a
/// board declares cost eleven minutes to see. This costs about three seconds.
///
/// **Both directions, separately.** A build offers each pair to the rules both ways round and
/// keeps the first that survives (see `judge_candidates`), so reporting one ordering would
/// answer a different question from the one the build asks. It is also the only place left that
/// shows how far apart the two readings of a pair come out — they should be the same board, and
/// mostly are.
///
/// It goes through `judge_direction`, which is the real thing — every rule, every knob, the
/// same board, the same statistics. Reimplementing the setup here instead would be a second
/// path that could quietly disagree with the build about what the puzzle is, which is the
/// error this whole file has been chasing all along.
///
///     npm run data -- pair understanding keynoting
/// **Every mode, and both endpoints translated into each one's alphabet.** Two typed
/// spellings name one node apiece in the letters mode and can name several in the phonemes
/// one — `read` is two pronunciations — so a mode reports every combination it can make of
/// them, and says nothing at all if the pair is not in its graph.
fn inspect_pair(
    built: &[Built],
    rank: &FxMap<String, usize>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let mut spoke = false;
    for one in built {
        let ends = |spelling: &str| -> Vec<u32> {
            match one.lex.alphabet {
                Alphabet::Letters => one.common.id(spelling).into_iter().collect(),
                // Every way the word can be said that is also a node here.
                Alphabet::Phonemes => {
                    let mut ids: Vec<u32> = one
                        .common
                        .words
                        .iter()
                        .enumerate()
                        .filter(|(_, token)| {
                            one.lex.labels(token).iter().any(|label| label == spelling)
                        })
                        .map(|(id, _)| id as u32)
                        .collect();
                    ids.sort_unstable();
                    ids
                }
            }
        };
        let (sources, targets) = (ends(from), ends(to));
        if sources.is_empty() || targets.is_empty() {
            eprintln!(
                "\n=== {} === {from} and {to} are not both ordinary words carrying a move here",
                one.mode.name
            );
            continue;
        }
        spoke = true;
        for &src in &sources {
            for &tgt in &targets {
                eprintln!("\n=== {} ===", one.mode.name);
                inspect_one(one, rank, src, tgt)?;
            }
        }
    }
    if !spoke {
        return Err(format!("no mode has both {from} and {to} as ordinary words with a move"));
    }
    Ok(())
}

/// One pair of nodes in one mode, both directions.
fn inspect_one(
    one: &Built,
    rank: &FxMap<String, usize>,
    src: u32,
    tgt: u32,
) -> Result<(), String> {
    let mode = one.mode;
    let common = &one.common;
    let common_subs: FxSet<&str> = one
        .lex
        .common
        .iter()
        .filter(|w| w.len() >= mode.min_sub)
        .map(String::as_str)
        .collect();

    // The same distance tables selection builds, for two endpoints instead of twelve thousand.
    let mut bfs = graph::Bfs::new(common.words.len());
    let mut tables = [vec![u8::MAX; common.words.len()], vec![u8::MAX; common.words.len()]];
    // A pair of *readings* that are not par apart is a combination to skip, not a failure. A
    // word said two ways gives two nodes and they need not both reach the other end — reporting
    // the whole question as impossible because one reading is would hide the answer to it.
    let Some(par) = rows_for(common, mode, &mut bfs, &mut tables, [src, tgt]) else {
        eprintln!(
            "  {} → {}: not within {} moves of each other, skipped",
            show(&one.lex, common.word(src)),
            show(&one.lex, common.word(tgt)),
            mode.max_par + mode.slack
        );
        return Ok(());
    };
    let mut slot_of: FxMap<u32, usize> = FxMap::default();
    slot_of.insert(src, 0);
    slot_of.insert(tgt, 1);

    // Every rule judged, so the report says everything the direction breaks rather than
    // whichever rule happens to run first. `mirrored` is false both times: the question here is
    // what each direction is worth on its own, not which of them a build would have kept first.
    let mut scratch = select::Scratch::new(common, &one.legal);
    let overexposed = select::Overexposed::new(common, mode, &one.lex)?;
    for (src, tgt) in [(src, tgt), (tgt, src)] {
        let verdict = select::judge_direction(
            src,
            tgt,
            par,
            common,
            &common_subs,
            &one.legal,
            mode,
            &one.lex,
            rank,
            &one.vocab,
            &tables[slot_of[&src]],
            &tables[slot_of[&tgt]],
            u8::MAX,
            true,
            false,
            &overexposed,
            &mut scratch,
        );
        report_direction(one, &verdict, common.word(src), common.word(tgt), par);
    }
    Ok(())
}

/// A token as something a person can read.
///
/// In the letters alphabet a token is already a word. In the phonemes one it is a run of
/// codes, so it is shown as the spelling it is drawn with and the transcription that
/// distinguishes it from the other ways that spelling can be said.
fn show(lex: &Lexicon, token: &str) -> String {
    match lex.alphabet {
        Alphabet::Letters => token.to_string(),
        Alphabet::Phonemes => format!("{} /{}/", lex.label(token), phonetic::to_ipa(token)),
    }
}

/// One direction of one pair, as the build sees it.
fn report_direction(one: &Built, verdict: &select::Verdict, from: &str, to: &str, par: u32) {
    let common = &one.common;
    let (from, to) = (show(&one.lex, from), show(&one.lex, to));
    eprintln!("{from} -> {to}  par {par}");
    let broken: Vec<&str> = verdict.broken.iter().map(|rule| rule.describe().0).collect();
    if !broken.is_empty() {
        eprintln!("  refused: {}", broken.join("; "));
    }
    let Some(puzzle) = &verdict.puzzle else {
        return;
    };

    let words: Vec<&str> = puzzle.board.split_whitespace().collect();
    let on_board: FxSet<u32> = words.iter().filter_map(|w| common.id(w)).collect();
    let edges: usize = on_board
        .iter()
        .map(|&w| common.neighbors(w).iter().filter(|n| on_board.contains(n)).count())
        .sum::<usize>()
        / 2;
    // Cross-links the budget left behind: the number to watch when tuning what a board holds.
    let mut touching: FxMap<u32, usize> = FxMap::default();
    for &w in &on_board {
        for &near in common.neighbors(w) {
            if !on_board.contains(&near) {
                *touching.entry(near).or_insert(0) += 1;
            }
        }
    }
    let untaken = touching.values().filter(|&&n| n >= 2).count();

    eprintln!(
        "  id {}  secret {}  {} words, {} on a shortest route, {} edges ({:.2} per word), \
         {untaken} cross-links untaken",
        puzzle.id,
        puzzle.secret,
        words.len(),
        // `alt_nodes` counts the words off a shortest route, so the rest are gold.
        words.len().saturating_sub(puzzle.alt_nodes),
        edges,
        edges as f64 / words.len().max(1) as f64,
    );
    eprintln!(
        "  {}",
        words.iter().map(|w| show(&one.lex, w)).collect::<Vec<_>>().join("  ")
    );
}

/// Distance rows for the two ends of one pair, and the par between them.
///
/// What every rule reads, and the only per-pair setup there is. `None` for a pair the search
/// range does not join — which cannot happen for a pair out of the bank, but this is also how
/// one pair is set up by hand.
fn rows_for(
    common: &graph::Graph,
    mode: &Mode,
    bfs: &mut graph::Bfs,
    rows: &mut [Vec<u8>; 2],
    ends: [u32; 2],
) -> Option<u32> {
    let far = (mode.max_par + mode.slack) as u32;
    for (row, id) in rows.iter_mut().zip(ends) {
        row.fill(u8::MAX);
        bfs.run(common, id, far);
        for &word in &bfs.touched {
            row[word as usize] = bfs.get(word).min(u8::MAX as u32 - 1) as u8;
        }
    }
    let par = rows[0][ends[1] as usize];
    if par == u8::MAX {
        return None;
    }
    Some(par as u32)
}

/// The bank's answers that run through **all** of these words, in any order, and what else is
/// on them.
///
/// For reading a word's exposure rather than counting it: `pivots.test.ts` says `ions` is on 19%
/// of answers, and this says what those answers look like — which is the question that decides
/// whether the word belongs in a mode's `tooFrequent`. Several at once is how a *cluster* is read:
/// `ions`, `contractions` and `cons` are individually exposed and turn out to be mostly one
/// three-step, which only a query that insists on all three can show.
///
/// **One route holding all of them**, not each word on some route of its own. Those differ: a
/// puzzle can have `a` on one shortest answer and `b` on another with no single answer holding
/// both, and calling that "a route through both" would be a lie about a route nobody can walk.
///
/// Still no per-puzzle search: one search per asked-for word, then array lookups. A word lies on
/// some shortest route exactly when its distances to the two ends add up to par — the trick the
/// rule uses — and a single route holds several of them exactly when, sorted by distance from the
/// source, each consecutive pair is as far apart as those distances differ. Both facts come out
/// of the rows already built, since `d(a, b)` is just `a`'s row read at `b`.
///
/// The route printed is built to *walk* the words rather than taken from the puzzle's own stored
/// answers, which are the alphabetically first ones and need not touch any of them.
///
///     npm run data -- routes ions contractions cons
fn show_routes(
    built: &[Built],
    config: &Config,
    cache: &Path,
    blocklist: &[String],
    words: &[String],
) -> Result<(), String> {
    for one in built {
        eprintln!("\n=== {} ===", one.mode.name);
        let path = bank::path(
            cache,
            &bank::key(one.mode, blocklist, config.shared.id_chars, &one.vocab),
        );
        show_routes_in(one, &path, words)?;
    }
    Ok(())
}

/// The same question, of one mode's bank.
///
/// A word is asked for as a spelling in either alphabet. In the phonemes mode that names every
/// pronunciation of it at once, which is the right reading of the question: exposure is
/// about the word, and a homograph said two ways is exposed by both.
/// Most words an n-gram may hold.
///
/// Four ids pack into the `u128` the counter is keyed by, which is what makes counting tens of
/// millions of subsets cheap. Past three or four, "a set of words that share an answer" also
/// stops being a thing anyone can act on.
const MAX_GRAM: usize = 4;

/// The commonest runs of `n` words that follow one another on an answer.
///
/// `routes` tests a guess — *are these words a cluster* — and this makes the guess unnecessary:
/// it finds the runs. Both are about one shortest answer rather than merely the same puzzle,
/// since a puzzle can have several answers and a word on one has not met a word on another.
///
/// **Contiguous, and read either way round.** On `a → b → c → d` the 3-grams are `[a, b, c]` and
/// `[b, c, d]`; `[a, b, d]` is not one, because nothing goes from `b` to `d`. An n-gram is a run
/// of *moves*, which is the thing a player actually walks — the pivot table already counts words
/// on their own, and a bag of words that merely share an answer would say nothing new. But the
/// graph is undirected and a puzzle is judged both ways round, so `[a, b, c]` and `[c, b, a]` are
/// one run seen from its two ends: the key is whichever of the two directions sorts first, and
/// **not** the sorted ids, which would wrongly make `[a, c, b]` the same thing.
///
/// Counted once per *puzzle*, not once per answer: a run on three of a puzzle's answers is still
/// one puzzle where those moves are made, and the shares are shares of puzzles so that they can
/// be read against the pivot table.
fn show_ngrams(one: &Built, bank_path: &Path, k: usize, n: usize) -> Result<(), String> {
    /// Answers walked per puzzle before the rest are left alone.
    ///
    /// A route DAG can hold exponentially many paths and a handful of puzzles do. Anything
    /// dropped is *reported*, because a cap nobody is told about reads as coverage.
    const WALK: usize = 64;

    let common = &one.common;
    let Some(bank) = bank::load(bank_path) else {
        return Err(format!(
            "no cached bank at {} — run `npm run data` first, then ask about it",
            bank_path.display()
        ));
    };

    // Grouped by target so one search serves every puzzle that ends there — the bank reuses a
    // few thousand endpoints over hundreds of thousands of puzzles.
    let mut by_target: FxMap<u32, Vec<(u32, u32)>> = FxMap::default();
    for puzzle in &bank.puzzles {
        let (Some(src), Some(tgt)) = (common.id(&puzzle.source), common.id(&puzzle.target)) else {
            continue;
        };
        by_target.entry(tgt).or_default().push((src, puzzle.par));
    }

    let mut bfs = graph::Bfs::new(common.words.len());
    let mut counts: FxMap<u128, u32> = FxMap::default();
    // This puzzle's sets, so a set on two of its answers counts once.
    let mut here: FxSet<u128> = FxSet::default();
    // One answer being walked, and the answers found.
    let mut path: Vec<u32> = Vec::new();
    let mut answers: Vec<Vec<u32>> = Vec::new();
    let mut counted = 0usize;
    let mut capped = 0usize;

    for (&tgt, group) in &by_target {
        bfs.run(common, tgt, u32::MAX);
        for &(src, par) in group {
            answers.clear();
            path.clear();
            path.push(src);
            walk_answers(common, &bfs, src, par, &mut path, &mut answers, WALK);
            if answers.is_empty() {
                continue;
            }
            if answers.len() >= WALK {
                capped += 1;
            }
            counted += 1;

            here.clear();
            for answer in &answers {
                for window in answer.windows(n) {
                    here.insert(pack(window));
                }
            }
            for &key in &here {
                *counts.entry(key).or_insert(0) += 1;
            }
        }
    }

    let mut ranked: Vec<(u128, u32)> = counts.into_iter().collect();
    ranked.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let total = counted.max(1);
    eprintln!(
        "  {counted} answers walked, {} distinct {n}-gram(s); top {}:",
        ranked.len(),
        k.min(ranked.len()),
    );
    eprintln!("    {:>4}  {:>8}  {:>7}  {}", "rank", "puzzles", "share", "words");
    for (at, (key, count)) in ranked.iter().take(k).enumerate() {
        let words: Vec<String> = unpack(*key, n)
            .iter()
            .map(|&id| show(&one.lex, common.word(id)))
            .collect();
        eprintln!(
            "    {:>4}  {count:>8}  {:>6.2}%  {}",
            at + 1,
            100.0 * *count as f64 / total as f64,
            words.join("  +  "),
        );
    }
    if capped > 0 {
        eprintln!(
            "  {capped} puzzle(s) have more than {WALK} shortest answers and only the first \
             {WALK} were read, so their rarer sets are undercounted"
        );
    }
    Ok(())
}

/// Every shortest answer from `path`'s end to the target, as word lists.
///
/// Walked off the route DAG: a step is any neighbour one closer to the target, so every walk
/// arrives in exactly par moves and this enumerates the answers and nothing else. `bfs` holds
/// distances *to* the target, which is why the caller groups by it.
fn walk_answers(
    common: &graph::Graph,
    bfs: &graph::Bfs,
    src: u32,
    par: u32,
    path: &mut Vec<u32>,
    out: &mut Vec<Vec<u32>>,
    cap: usize,
) {
    if out.len() >= cap {
        return;
    }
    let at = *path.last().expect("never empty");
    let left = bfs.get(at);
    if left == 0 {
        out.push(path.clone());
        return;
    }
    if left == graph::UNREACHED || path.len() as u32 > par {
        return;
    }
    for &near in common.neighbors(at) {
        let closer = bfs.get(near);
        if closer != graph::UNREACHED && closer + 1 == left {
            path.push(near);
            walk_answers(common, bfs, src, par, path, out, cap);
            path.pop();
            if out.len() >= cap {
                return;
            }
        }
    }
}

/// A run of up to four ids in one integer, **in order**, read from whichever end sorts first.
///
/// Order is kept — `[a, c, b]` is a different run from `[a, b, c]`, since the moves differ — and
/// direction is not, because an answer read from its target is the same answer. Reversing and
/// taking the smaller is the whole of that. Sorting the ids instead would collapse every
/// ordering into one and count runs that nobody can walk. See `MAX_GRAM`.
fn pack(run: &[u32]) -> u128 {
    let forward: Vec<u32> = run.to_vec();
    let backward: Vec<u32> = run.iter().rev().copied().collect();
    let chosen = if backward < forward { backward } else { forward };

    let mut slots = [u32::MAX; MAX_GRAM];
    slots[..chosen.len()].copy_from_slice(&chosen);
    let mut key = 0u128;
    for id in slots {
        key = (key << 32) | id as u128;
    }
    key
}

fn unpack(key: u128, n: usize) -> Vec<u32> {
    let mut ids: Vec<u32> = (0..MAX_GRAM)
        .map(|slot| ((key >> (32 * (MAX_GRAM - 1 - slot))) & 0xffff_ffff) as u32)
        .collect();
    ids.retain(|&id| id != u32::MAX);
    ids.truncate(n);
    ids
}

/// One word asked about, and every node it can be.
///
/// **A word said two ways is an `or`, not an `and`.** `routes reed can` means answers through
/// `reed` and through `can` — and `can` is `/kæn/` *or* `/kən/`, since nothing is ever said both
/// ways at once. Treating the two readings as separate members of one `and` demanded a route
/// through both and quietly answered zero, which reads as "these words never meet" when the
/// truth is that the question was impossible. The `and` is across groups; the `or` is within one.
struct Group {
    /// The spelling as it was typed, with how each of its readings sounds.
    listed: String,
    /// `(node, distances from it)`, one per way the word can be said.
    ways: Vec<(u32, Vec<u32>)>,
}

/// Every choice of one reading per word, which is what the `or` comes to.
///
/// Small by construction — CMUdict lists at most four ways to say anything — so this is a
/// handful of combinations even for a long question, and each is judged by exactly the function
/// the cluster rule uses.
fn choices(asked: &[Group]) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = vec![Vec::new()];
    for group in asked {
        out = out
            .into_iter()
            .flat_map(|so_far| {
                (0..group.ways.len()).map(move |pick| {
                    let mut next = so_far.clone();
                    next.push(pick);
                    next
                })
            })
            .collect();
    }
    out
}

fn show_routes_in(one: &Built, bank_path: &Path, words: &[String]) -> Result<(), String> {
    let common = &one.common;
    let lex = &one.lex;
    let Some(bank) = bank::load(bank_path) else {
        return Err(format!(
            "no cached bank at {} — run `npm run data` first, then ask about it",
            bank_path.display()
        ));
    };

    /// Answers printed in full before the rest are only counted.
    const SHOWN: usize = 30;

    let mut bfs = graph::Bfs::new(common.words.len());
    let far = (one.mode.max_par + one.mode.slack) as u32;

    // Which nodes a typed spelling names here: itself in the letters alphabet, and every way
    // it can be said in the phonemes one.
    let nodes_for = |spelling: &str| -> Vec<u32> {
        match lex.alphabet {
            Alphabet::Letters => common.id(spelling).into_iter().collect(),
            Alphabet::Phonemes => common
                .words
                .iter()
                .enumerate()
                .filter(|(_, token)| lex.labels(token).iter().any(|l| l == spelling))
                .map(|(id, _)| id as u32)
                .collect(),
        }
    };

    /*
      One group per word asked for, holding every node that word can be.

      **A word said two ways is an `or`, not an `and`.** `routes reed can` means answers through
      `reed` and through `can` — and `can` is `/kæn/` *or* `/kən/`, since nothing is ever said
      both ways at once. Treating the two as separate members of one `and` demanded a route
      through both and quietly answered zero, which reads as "these words never meet" when the
      truth is that the question was impossible. So the `and` is across groups and the `or` is
      within one: a puzzle counts when *some* choice of one node per group lies on one route.

      Distances are copied out of the shared scratch so every row is live at once while the
      bank is scanned.
    */
    let mut asked: Vec<Group> = Vec::new();
    for word in words {
        let found = nodes_for(word);
        if found.is_empty() {
            eprintln!("{word}: not an ordinary word carrying a move — skipped");
            continue;
        }
        let mut ways = Vec::with_capacity(found.len());
        for id in found {
            bfs.run(common, id, far);
            let mut row = vec![graph::UNREACHED; common.words.len()];
            for &near in &bfs.touched {
                row[near as usize] = bfs.get(near);
            }
            ways.push((id, row));
        }
        let listed = if ways.len() == 1 {
            show(lex, common.word(ways[0].0))
        } else {
            // `can /kæn/ or /kən/` — the reading matters, and a bare spelling would hide that
            // the question has two answers.
            let readings: Vec<String> = ways
                .iter()
                .map(|(id, _)| phonetic::to_ipa(common.word(*id)))
                .map(|ipa| format!("/{ipa}/"))
                .collect();
            format!("{word} {}", readings.join(" or "))
        };
        asked.push(Group { listed, ways });
    }
    if asked.is_empty() {
        return Err("none of those words are in the common graph".into());
    }

    let combos = choices(&asked);

    let empty: FxSet<u32> = FxSet::default();
    let mut found = 0usize;
    let mut printed = 0usize;
    // Which puzzles qualified and *how*: the endpoints, and which choice of readings worked.
    // Kept so the co-occurrence pass below does not judge them twice, and so it walks the same
    // chain this pass found rather than guessing at one.
    let mut qualified: Vec<(u32, u32, usize)> = Vec::new();
    // Answers each word is on by itself, which is what makes a zero readable: a word at zero on
    // its own is banned or unused, while words with thousands each and nothing in common means no
    // single answer walks them all.
    let mut alone = vec![0usize; asked.len()];
    // The asked-for words in the order an answer would meet them, reused every puzzle.
    let mut order: Vec<usize> = Vec::with_capacity(asked.len());
    for puzzle in &bank.puzzles {
        let (Some(src), Some(tgt)) = (common.id(&puzzle.source), common.id(&puzzle.target)) else {
            continue;
        };
        // What each word is on by itself, which is only for the summary below. Said any way
        // it can be said, which is the same `or` the main test uses.
        for (slot, group) in asked.iter().enumerate() {
            if group.ways.iter().any(|(_, row)| {
                select::on_some_answer(puzzle.par, row[src as usize], row[tgt as usize])
            }) {
                alone[slot] += 1;
            }
        }

        // All of them on one answer, under *some* choice of readings. Each choice goes through
        // the function the cluster rule uses, so the tool cannot disagree with the rule about
        // what "on one route" means — `d(a, b)` being a row of `a` read at `b`.
        let Some(chosen) = combos.iter().position(|pick| {
            let node = |i: usize| &asked[i].ways[pick[i]];
            select::all_on_one_route(
                asked.len(),
                puzzle.par,
                &|i| node(i).1[src as usize],
                &|i| node(i).1[tgt as usize],
                &|i, j| node(i).1[node(j).0 as usize],
            )
        }) else {
            continue;
        };
        found += 1;
        qualified.push((src, tgt, chosen));

        // The order an answer meets them in: every step of a shortest route moves one further
        // from the source, so their distances from it are the order.
        let pick = &combos[chosen];
        order.clear();
        order.extend(0..asked.len());
        order.sort_by_key(|&slot| asked[slot].ways[pick[slot]].1[src as usize]);
        if printed >= SHOWN {
            continue;
        }
        printed += 1;

        // The answer, walked: source, the asked-for words in the order above, target. Each hop is
        // a shortest route, and distance from the source rises across the whole chain, so the
        // pieces join into one shortest answer and none of them revisits a word.
        let mut stops: Vec<u32> = vec![src];
        for &slot in &order {
            let node = asked[slot].ways[pick[slot]].0;
            if *stops.last().expect("starts with the source") != node {
                stops.push(node);
            }
        }
        if *stops.last().expect("starts with the source") != tgt {
            stops.push(tgt);
        }
        let mut route: Vec<u32> = vec![src];
        for hop in stops.windows(2) {
            match bfs.route_avoiding(common, hop[0], hop[1], &empty, puzzle.par) {
                Some(part) => route.extend(part.iter().skip(1).copied()),
                // Cannot happen — the distances above are what says every hop exists — but a
                // reporting tool has no business panicking over it.
                None => break,
            }
        }
        eprintln!(
            "  {} par {}  {}",
            puzzle.id,
            puzzle.par,
            route.iter().map(|&step| show(lex, common.word(step))).collect::<Vec<_>>().join(" → ")
        );
    }

    // "a, b and c" rather than "a and b and c", which three words read as badly as it looks.
    let names: Vec<&str> = asked.iter().map(|group| group.listed.as_str()).collect();
    let listed = match names.split_last() {
        Some((last, [])) => (*last).to_string(),
        Some((last, rest)) => format!("all of {} and {last}", rest.join(", ")),
        None => String::new(),
    };
    eprintln!("{} of {} bank answers run through {listed}", found, bank.puzzles.len());
    if found > printed {
        eprintln!("  {} more not shown", found - printed);
    }
    if asked.len() > 1 {
        eprintln!(
            "  each on its own: {}",
            asked
                .iter()
                .zip(&alone)
                .map(|(group, count)| format!("{} {count}", group.listed))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    if found == 0 {
        eprintln!(
            "  nothing. A word in this mode's tooFrequent comes out at zero on its own, because \
             the rule refused every puzzle whose answer touched it; words with counts of their \
             own and nothing here share no single answer"
        );
        return Ok(());
    }

    report_company(one, &asked, &combos, &qualified, &listed);
    Ok(())
}

/// What else is on the answers that hold the asked-for words.
///
/// The question the whole list exists to answer, and the one `routes` could not: given a hub,
/// *what does it hub with*. Asking one word gets the pairs it keeps; asking a pair gets the
/// triples; asking a cluster gets what would make it a bigger one. So a cluster is found rather
/// than guessed at, which is how `tooFrequentClusters` should be filled.
///
/// **On a route through all of them**, not merely on some route of the same puzzle. A word can
/// lie on one shortest answer while the asked words lie on another, and counting that as company
/// would name pairs that never actually meet. The chain `src → a₁ → … → aₙ → tgt` is walked one
/// segment at a time, and a word counts when it is on a shortest path for one of those segments
/// — which is exactly "on a route that passes through every one of them".
///
/// Each segment walk needs the distances *into* its far end and nothing else, and every far end
/// is either an asked word — whose row is already built — or the puzzle's target. So the pass
/// costs one search per distinct target and a handful of lookups per puzzle, rather than a
/// search per puzzle.
fn report_company(
    one: &Built,
    asked: &[Group],
    combos: &[Vec<usize>],
    qualified: &[(u32, u32, usize)],
    listed: &str,
) {
    /// How many to name. Enough to see the shape, few enough to read.
    const TOP: usize = 10;

    let common = &one.common;
    // Grouped by target so one search serves every puzzle that ends there. The bank reuses a
    // few thousand endpoints over hundreds of thousands of puzzles, so this is most of the
    // saving.
    // Grouped by target, and carrying which reading of each word this puzzle qualified under —
    // the chain to walk depends on it.
    let mut by_target: FxMap<u32, Vec<(u32, usize)>> = FxMap::default();
    for &(src, tgt, chosen) in qualified {
        by_target.entry(tgt).or_default().push((src, chosen));
    }

    let mut bfs = graph::Bfs::new(common.words.len());
    let mut company: FxMap<u32, usize> = FxMap::default();
    // One puzzle's route words, reused. A set because segments meet at their shared stops.
    let mut on_route: FxSet<u32> = FxSet::default();
    let mut order: Vec<usize> = Vec::with_capacity(asked.len());
    let mut layer: Vec<u32> = Vec::new();
    let mut next: Vec<u32> = Vec::new();

    for (&tgt, group) in &by_target {
        bfs.run(common, tgt, u32::MAX);
        for &(src, chosen) in group {
            let pick = &combos[chosen];
            let node = |slot: usize| &asked[slot].ways[pick[slot]];
            order.clear();
            order.extend(0..asked.len());
            order.sort_by_key(|&slot| node(slot).1[src as usize]);

            // The stops, in the order an answer meets them, without repeating an endpoint that
            // is itself one of the asked-for words.
            let mut stops: Vec<u32> = vec![src];
            for &slot in &order {
                if *stops.last().expect("starts with the source") != node(slot).0 {
                    stops.push(node(slot).0);
                }
            }
            if *stops.last().expect("starts with the source") != tgt {
                stops.push(tgt);
            }

            on_route.clear();
            for hop in stops.windows(2) {
                let (from, to) = (hop[0], hop[1]);
                // Distances into the far end of this segment: an asked word's own row, or the
                // search just run from the target.
                let row_of = (0..asked.len()).find(|&slot| node(slot).0 == to);
                let into: Box<dyn Fn(u32) -> u32> = match row_of {
                    Some(slot) => {
                        let row = &node(slot).1;
                        Box::new(move |w: u32| row[w as usize])
                    }
                    None => Box::new(|w: u32| bfs.get(w)),
                };
                let span = into(from);
                if span == graph::UNREACHED {
                    continue;
                }
                // Forward off the route DAG: every step lands one closer to the far end, so the
                // walk touches the words on a shortest path for this segment and nothing else.
                layer.clear();
                layer.push(from);
                on_route.insert(from);
                for left in (1..=span).rev() {
                    next.clear();
                    for &word in &layer {
                        for &near in common.neighbors(word) {
                            if into(near) + 1 == left && on_route.insert(near) {
                                next.push(near);
                            }
                        }
                    }
                    std::mem::swap(&mut layer, &mut next);
                }
                on_route.insert(to);
            }

            for &word in &on_route {
                if (0..asked.len()).any(|slot| node(slot).0 == word) {
                    continue;
                }
                *company.entry(word).or_insert(0) += 1;
            }
        }
    }

    let mut ranked: Vec<(u32, usize)> = company.into_iter().collect();
    ranked.sort_unstable_by(|a, b| b.1.cmp(&a.1).then_with(|| common.word(a.0).cmp(common.word(b.0))));

    let total = qualified.len().max(1);
    eprintln!("\n  what else is on those answers, with {listed}:");
    eprintln!("    {:>7}  {:>7}  {}", "answers", "share", "word");
    for (word, count) in ranked.iter().take(TOP) {
        eprintln!(
            "    {count:>7}  {:>6.1}%  {}",
            100.0 * *count as f64 / total as f64,
            show(&one.lex, common.word(*word)),
        );
    }
}

/// No two puzzles may want the same address.
///
/// An id is the whole of a puzzle's URL, so a collision is not a cosmetic clash:
/// one of the two boards becomes unreachable and every link ever shared to it opens
/// the other one. At eight hex digits over a bank this size it is a fraction of a
/// percent likely, which is exactly the kind of odds that eventually happens — so
/// the build stops here rather than writing a bank that cannot be addressed.
fn check_ids(puzzles: &[select::Puzzle], config: &Config) -> Result<(), String> {
    let mut seen: FxMap<&str, &select::Puzzle> = FxMap::default();
    for puzzle in puzzles {
        if let Some(other) = seen.insert(puzzle.id.as_str(), puzzle) {
            return Err(format!(
                "two puzzles share the id {}: {} → {} and {} → {}. Raise \
                 idChars (now {}) and rebuild — but the length is a digest \
                 parameter, so that gives every puzzle a new id and every link \
                 already shared stops resolving",
                puzzle.id, other.source, other.target, puzzle.source, puzzle.target,
                config.shared.id_chars,
            ));
        }
    }
    eprintln!(
        "  ids: {} unique at {} hex digits",
        puzzles.len(),
        config.shared.id_chars
    );
    Ok(())
}

/// The rules that refused anything, costliest first.
///
/// `refused` is how many candidates the rule turned down. `only` is how many it
/// was the sole objection to — the number that matters when tuning, since it is
/// exactly what relaxing that one rule would let in. Without `RECURSE_AUDIT` the
/// rules run as a cascade and every candidate stops at its first failure, so both
/// are attributed to whichever rule ran earliest.
fn rule_rows(selection: &select::Selection) -> Vec<(select::Rule, usize, usize)> {
    let mut rows: Vec<(select::Rule, usize, usize)> = select::Rule::ALL
        .iter()
        .copied()
        .map(|rule| {
            (
                rule,
                select::Rejections::total(&selection.rejections.alone, rule),
                select::Rejections::total(&selection.rejections.only, rule),
            )
        })
        .filter(|(_, refused, _)| *refused > 0)
        .collect();
    rows.sort_by_key(|(_, refused, _)| std::cmp::Reverse(*refused));
    rows
}

/// What each rule cost, and which rules are actually doing the work.
fn report_rules(selection: &select::Selection, audited: bool) {
    eprintln!(
        "  rules ({}):",
        if audited { "audited independently" } else { "cascade — first failure only" }
    );
    eprintln!(
        "    {:>9}  {:>9}  {:>6}  {:<46} {}",
        "refused", "only reason", "needs", "rule", "knob"
    );
    for (rule, refused, sole) in rule_rows(selection) {
        let (what, knob) = rule.describe();
        eprintln!(
            "    {refused:>9}  {sole:>11}  {:>6}  {what:<46} {knob}",
            rule.needs().label()
        );
    }
    eprint!("{}", rule_grid(selection));
}

/// The same refusals, by rule *and by par*.
///
/// A total says a rule is expensive; only the grid says what it is expensive *at*. Three of the
/// rules scale with par by construction — the internal-move count, the off-route count, the
/// halfway branch — so a row that climbs with par is those rules working, and a row that
/// collapses at one end is a rule that has stopped asking anything there.
///
/// Columns are the pars the search actually looked at (`minPar`..`MAX_PAR`), and the
/// last column is the row's total. Every cell is a count over every candidate; nothing is
/// sampled.
fn rule_grid(selection: &select::Selection) -> String {
    let pars: Vec<usize> = (0..select::PAR_SLOTS)
        .filter(|&par| {
            select::Rule::ALL
                .iter()
                .any(|rule| selection.rejections.alone[rule.slot()][par] > 0)
        })
        .collect();
    if pars.is_empty() {
        return String::new();
    }

    /// Thousands, as three characters and a suffix, because a grid of nine-digit counts is
    /// unreadable and the shape is what the grid is for.
    fn short(n: usize) -> String {
        match n {
            0 => "·".to_string(),
            n if n < 10_000 => n.to_string(),
            n if n < 10_000_000 => format!("{}k", n / 1_000),
            n => format!("{}M", n / 1_000_000),
        }
    }

    let mut out = String::from("    refused by par:\n      ");
    out.push_str(&format!("{:<44}", "rule"));
    for par in &pars {
        out.push_str(&format!("{:>8}", format!("par {par}")));
    }
    out.push_str(&format!("{:>10}\n", "all"));
    for (rule, refused, _) in rule_rows(selection) {
        out.push_str(&format!("      {:<44}", rule.describe().0));
        for par in &pars {
            out.push_str(&format!("{:>8}", short(selection.rejections.alone[rule.slot()][*par])));
        }
        out.push_str(&format!("{:>10}\n", short(refused)));
    }
    out
}

/// What the boards came to: how big, and how much of each is off the shortest route.
///
/// The second number is the one to watch. A board is only a puzzle if there is something on it
/// that is not the answer, so a build where `off-route` collapses has produced bare lines
/// however many words it drew.
fn report_boards(selection: &select::Selection) {
    let mut words = 0usize;
    let mut off = 0usize;
    let mut bare = 0usize;
    let mut smallest = usize::MAX;
    let mut largest = 0usize;
    for puzzle in &selection.puzzles {
        words += puzzle.corridor_size;
        off += puzzle.alt_nodes;
        if puzzle.alt_nodes == 0 {
            bare += 1;
        }
        smallest = smallest.min(puzzle.corridor_size);
        largest = largest.max(puzzle.corridor_size);
    }
    let n = selection.puzzles.len().max(1);
    eprintln!(
        "  boards: {} words on average ({}-{}), {} of them off the shortest route, {} bare",
        words / n,
        if smallest == usize::MAX { 0 } else { smallest },
        largest,
        off / n,
        bare,
    );
}

/// How even the bands are, which is a property of the *rules* and not of the cuts.
///
/// Every day offers one board of every band there is, so the bands have to be within hailing
/// distance of each other or the game runs out of one while another still has centuries left.
/// A mode's cuts are its `bandCuts`, but what each cut holds is decided by which puzzles the
/// rules let through — so a rule change moves these shares, and this report is how that shows
/// up. Printed on every build, beside the rule tables, for that reason.
///
/// Every band runs the whole calendar; a band shorter than the longest one repeats to fill it,
/// so `repeats` is how many times over. The calendar's length is the longest band's, which is
/// what `calendar_bodies` writes and what "how many days there are" means.
fn report_bands(selection: &select::Selection, config: &Config) {
    let total = selection.puzzles.len().max(1);
    let days = calendar_days(&selection.puzzles, config.band_count());
    eprintln!(
        "\n  bands ({} puzzles over {days} days, {:.0} years, one of each per day):",
        selection.puzzles.len(),
        days as f64 / 365.25,
    );
    eprintln!(
        "    {:<10} {:<8} {:>6}  {:>9}  {:>7}  {}",
        "mode", "band", "pars", "puzzles", "share", "repeats"
    );
    for (mode, local) in config.bands() {
        let band = mode.global_band(local);
        let held = selection.puzzles.iter().filter(|p| p.band == band).count();
        let (low, high) = mode.band_pars(local);
        eprintln!(
            "    {:<10} {:<8} {:>6}  {:>9}  {:>6.1}%  {:>7.2}x",
            mode.name,
            mode.band_name(local),
            format!("{low}-{high}"),
            held,
            100.0 * held as f64 / total as f64,
            days as f64 / held.max(1) as f64,
        );
    }
}

/// Refuse a bank with a band nobody can be offered.
///
/// A band with nothing in it cannot be filled by repeating it, and shipping it would put a
/// length on the masthead that opens nothing. Named rather than counted, because the fix is that
/// mode's rules or its cuts and the message should say which. Asked before the calendar is
/// dealt rather than while it is being written, so half a minute of dealing is not spent on a
/// bank that was never going to ship — and so nothing downstream has to cope with a band whose
/// run of days is empty.
fn check_bands(config: &Config, puzzles: &[select::Puzzle]) -> Result<(), String> {
    for (mode, local) in config.bands() {
        if !puzzles.iter().any(|puzzle| puzzle.band == mode.global_band(local)) {
            return Err(format!(
                "the {} band of mode {} has no puzzles, so the calendar cannot fill it — \
                 loosen that mode's rules or move its cuts",
                mode.band_name(local),
                mode.name,
            ));
        }
    }
    Ok(())
}

/// Which mode each band belongs to, as an index into `built`.
///
/// Band numbers are flat across every mode — the letters game's three lengths are 0, 1, 2 and
/// the phonemes game's are 3, 4, 5 — and the calendar has to be able to go the other way,
/// because two boards can only draw the same stretch of graph if they came out of the same one.
fn mode_of_band(config: &Config, built: &[Built]) -> Vec<usize> {
    let mut of_band = vec![0usize; config.band_count()];
    for (at, one) in built.iter().enumerate() {
        for local in 0..one.mode.bands.len() {
            of_band[one.mode.global_band(local)] = at;
        }
    }
    of_band
}

/// How many days the calendar runs: the longest band's length.
///
/// Every band fills every day — a shorter one by cycling — so the longest is what bounds it.
/// There is no second number here on purpose: a puzzle that shipped and could not be reached by
/// any date was the bug this replaced.
///
/// **A band with nothing in it stops the build**, in `calendar_bodies`. It cannot be filled by
/// cycling, since there is nothing to cycle, and a mode that ships a length with no boards is a
/// tab a player can press that opens nothing.
fn calendar_days(puzzles: &[select::Puzzle], bands: usize) -> usize {
    (0..bands)
        .map(|band| puzzles.iter().filter(|p| p.band == band).count())
        .max()
        .unwrap_or(0)
}

/// How many puzzles at each par, which is what difficulty tiers get cut from.
fn par_histogram(selection: &select::Selection) -> Vec<(u32, usize)> {
    let mut by_par: FxMap<u32, usize> = FxMap::default();
    for puzzle in &selection.puzzles {
        *by_par.entry(puzzle.par).or_insert(0) += 1;
    }
    let mut pars: Vec<_> = by_par.into_iter().collect();
    pars.sort();
    pars
}

/// The bank, split into one file per id prefix, plus the parameters and the calendar
/// arithmetic the client needs to find a shard.
///
/// A single file was 25MB at 174,536 puzzles, fetched in full to play one board. The
/// id is a digest, so its first two hex digits split the bank into 256 even parts of a
/// couple of hundred KB, and either way of arriving at a board names its shard without
/// an index:
///
/// * A shared link carries the id, whose first two digits *are* the shard.
/// * A daily board is band `B` on day `N`, which the calendar file names outright — so the
///   lengths a day offers are in unrelated shards, and playing one costs one fetch.
///
/// So one fetch reaches any board, and a player accumulates shards as they play rather
/// than paying for the whole bank up front.
///
/// **A shard's filename carries a digest of the whole bank**, so freshness is the URL's
/// job and not the client's: rebuild the bank and every shard is asked for at an address
/// nobody has cached, which is what lets the client fetch them `force-cache` and never
/// revalidate. `manifest.json` is the one file whose name is fixed, so it is the only
/// one that needs the network on a repeat visit.
///
/// Shards are TSV rather than JSON: the values are ASCII words and small integers, and
/// the field names repeated 174,536 times were most of the bytes.
fn write_puzzle_shards(
    data: &Path,
    config: &Config,
    built: &[Built],
    // The digest naming each mode's four data files, in `built` order. See `named`.
    digests: &[String],
    puzzles: &[select::Puzzle],
    dealt: &calendar::Calendar,
) -> Result<(), String> {
    // Which mode a puzzle belongs to, from the band it is in. Only the pair index needs it —
    // everything else in a shard is stored in the puzzle's own alphabet, deliberately.
    let lex_for = |band: usize| -> Option<&Lexicon> {
        built
            .iter()
            .find(|one| {
                band >= one.mode.band_base && band < one.mode.band_base + one.mode.bands.len()
            })
            .map(|one| &one.lex)
    };
    let dir = data.join("puzzles");
    let mut shards: Vec<Vec<&select::Puzzle>> = vec![Vec::new(); id::SHARDS];
    for puzzle in puzzles {
        shards[id::shard_of(&puzzle.id)].push(puzzle);
    }

    // One line per puzzle. Built before anything is written, because the digest of the
    // whole bank is part of every shard's name.
    let bodies: Vec<String> = shards
        .iter()
        .map(|shard| {
            let mut out = String::with_capacity(shard.len() * 64);
            for puzzle in shard {
                out.push_str(&format!(
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                    puzzle.id,
                    puzzle.day,
                    puzzle.band,
                    puzzle.source,
                    puzzle.target,
                    puzzle.par,
                    puzzle.secret,
                    puzzle.corridor_size,
                    puzzle.alt_nodes,
                    puzzle.shortest_paths,
                    puzzle.max_rank,
                    puzzle.board,
                ));
            }
            out
        })
        .collect();

    // The calendar, built before the version because it is *part* of what the version names.
    let calendar = calendar_bodies(config, puzzles, dealt)?;

    // The digest covers every immutable file's contents — every shard and every calendar year —
    // so any change to any of them renames all of them.
    //
    // The calendar has to be in here, and leaving it out was a bug that only appears on the
    // second build: the version is a digest of the *shards*, and moving `epoch` rewrites
    // every calendar year without touching a shard. The names stayed put, the files are fetched
    // `force-cache` because their names promise they cannot change, and every browser that had
    // been to the site kept serving last build's calendar for ever. The rule is simple — if a
    // file is cached by name for good, its contents belong in the name.
    let mut everything = String::with_capacity(
        bodies.iter().map(String::len).sum::<usize>()
            + calendar.iter().map(|(_, body)| body.len()).sum::<usize>(),
    );
    for body in &bodies {
        everything.push_str(body);
    }
    for (_, body) in &calendar {
        everything.push_str(body);
    }
    let version = id::digest(everything.as_bytes(), 8);

    let name_of = |index: usize| format!("{index:02x}-{version}.tsv");

    // What the client reads before anything else: the version its shard names are built from,
    // how many shards there are, the epoch the calendar counts from, and how long it runs.
    //
    // **`bands` stays one flat list across every mode**, because a band index is a puzzle's
    // own `band` field, the position of a run in a calendar year, and the thing a player's
    // stored preference names. Numbering them per mode would mean three ways to say "band 1".
    // Each entry says which mode it belongs to, as an index into `modes`, and that is where
    // the alphabet and the data directory come from.
    //
    // **A band carries two names, and they do different jobs.** `name` is the flat identifier
    // — `letters-long`, `phonemes-long` — and is what the client keys a saved game and a stats
    // record on, so those survive the list being reordered. `label` is the word a player
    // reads, and two modes both offer one called "short". Writing only the label would make
    // three pairs of bands indistinguishable outside their position; writing only the
    // identifier would put the mode's name on the masthead twice over.
    //
    // A band carries the pars it holds because the header says "short (par 3-4)", and those
    // numbers are `bandCuts` rather than the client's to know. There is no per-band length:
    // every band runs the whole calendar, so the length belongs to the calendar.
    //
    // The epoch ships because the client used to hard-code it, and a date that has to agree
    // between the builder and the browser should be written down once. See `epoch`.
    /*
        **Two digests per mode, and they do different jobs.**

        `data` names the four files this mode ships, and is a digest of their bytes: it is how
        the client asks for them, and why it cannot be served a stale one.

        `vocab` is what every puzzle id in the mode was taken over — the legal word list and
        the two lengths that decide which moves exist — so it is what a shared board's *code*
        depends on. The client fetches nothing by it; it is here so that what an id pins is
        written down where anyone can read it, and so a test can check the two agree.

        Conflating them was the first attempt and was wrong: three of the four files depend on
        the common tier as well, which the vocabulary deliberately does not cover. See `named`.

        From `built` rather than from the config, because the config holds only what was
        *declared* and a mode may decline to declare a vocabulary. Order is `built`'s, which is
        `config.modes`' — a build refuses `--mode`, so the two cannot come apart, and the band
        entries below index the same order.
    */
    let modes = built
        .iter()
        .zip(digests)
        .map(|(one, data)| {
            format!(
                "{{\"name\":\"{}\",\"alphabet\":\"{}\",\"data\":\"{}\",\
                 \"vocab\":\"{}\",\"slack\":{},\"minPar\":{},\"maxPar\":{}}}",
                one.mode.name,
                one.mode.alphabet.name(),
                data,
                one.vocab,
                one.mode.slack,
                one.mode.min_par,
                one.mode.max_par,
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let bands = config
        .bands()
        .iter()
        .map(|(mode, local)| {
            let (low, high) = mode.band_pars(*local);
            let at = config
                .modes
                .iter()
                .position(|other| other.name == mode.name)
                .expect("a band's mode is one of the modes");
            format!(
                "{{\"name\":\"{}\",\"label\":\"{}\",\"mode\":{at},\"minPar\":{low},\"maxPar\":{high}}}",
                mode.band_id(*local),
                mode.band_name(*local),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let days = calendar_days(puzzles, config.band_count());
    let epoch = config.shared.epoch;
    let last = date::civil_from_days(
        date::days_from_civil(epoch) + days.saturating_sub(1) as i64,
    );
    let manifest = format!(
        "{{\"version\":\"{version}\",\"shards\":{},\"modes\":[{modes}],\"bands\":[{bands}],\
         \"puzzles\":{},\"epoch\":\"{:04}-{:02}-{:02}\",\"days\":{days},\"years\":[{},{}]}}",
        id::SHARDS,
        puzzles.len(),
        epoch.year,
        epoch.month,
        epoch.day,
        epoch.year,
        last.year,
    );

    let mut largest = 0usize;
    for (index, body) in bodies.iter().enumerate() {
        largest = largest.max(body.len());
        words::write_file(&dir.join(name_of(index)), body)?;
    }

    // Every pair and the address it lives at, for dev mode's lookup by words.
    //
    // A shard can only be found from an id, and an id is a digest — of the game, the pair and
    // the vocabulary, none of which the client can compute — so there is no way to get from
    // "the puzzle about `warming` and `scolding`" to a board without an index of the pairs,
    // and the client holds one shard of the bank rather than the bank. This is that index:
    // the whole calendar, three fields a line, sorted so it reads.
    //
    // Nothing a player does fetches it. Dev mode asks for it when the lookup is used, which
    // is why it is one file rather than part of the shards: a build that ships it costs
    // players nothing and costs whoever is judging the bank one download.
    // **Spellings, not tokens.** Everything else in the bank stores a puzzle's endpoints in
    // its own alphabet, which is right — they are graph nodes. This file is the exception,
    // because the archive searches and displays it and has no lexicon in hand: it is the one
    // screen that lists every mode's boards at once, and fetching four dictionaries to put a
    // date on a card is not a trade worth making. So the label is written here.
    let mut pairs: Vec<(String, String, &select::Puzzle)> = puzzles
        .iter()
        .map(|puzzle| match lex_for(puzzle.band) {
            Some(lex) => (lex.label(&puzzle.source), lex.label(&puzzle.target), puzzle),
            None => (puzzle.source.clone(), puzzle.target.clone(), puzzle),
        })
        .collect();
    pairs.sort_unstable_by(|a, b| (&a.0, &a.1, &a.2.id).cmp(&(&b.0, &b.1, &b.2.id)));
    let mut index = String::with_capacity(pairs.len() * 32);
    for (source, target, puzzle) in &pairs {
        index.push_str(source);
        index.push('\t');
        index.push_str(target);
        index.push('\t');
        index.push_str(&puzzle.id);
        index.push('\n');
    }
    words::write_file(&dir.join(format!("pairs-{version}.tsv")), &index)?;

    let mut widest = 0usize;
    for (year, body) in &calendar {
        widest = widest.max(body.len());
        words::write_file(&dir.join(format!("{year}-{version}.json")), body)?;
    }

    // Written last: a manifest naming shards that are not on disk yet would be a
    // deploy that serves a version it cannot fetch.
    words::write_file(&dir.join("manifest.json"), &manifest)?;

    let stale = remove_stale_shards(&dir, &version)?;
    eprintln!(
        "  wrote {} puzzle shards at version {version} ({}-{} puzzles each, largest {} KB){}",
        id::SHARDS,
        shards.iter().map(Vec::len).min().unwrap_or(0),
        shards.iter().map(Vec::len).max().unwrap_or(0),
        largest / 1024,
        if stale > 0 { format!(", removed {stale} from an older version") } else { String::new() },
    );
    eprintln!(
        "  wrote {} calendar years {}-{} ({} KB each), {days} days from {:04}-{:02}-{:02}",
        calendar.len(),
        epoch.year,
        last.year,
        widest / 1024,
        epoch.year,
        epoch.month,
        epoch.day,
    );
    Ok(())
}

/// The calendar: one file per calendar year, naming the three puzzles of every day in it.
///
/// Returns the bodies rather than writing them, because the version every file is *named* by is
/// a digest of all of their contents — see `write_puzzle_shards`.
///
/// **This is the whole of what a date means now.** It replaced arithmetic — day `N` of band `B`
/// used to have to live in shard `(N * BANDS + B) % SHARDS`, so that a date could be found in one
/// fetch with no index, and the price was that the round robin ran out of the thinnest shard
/// while a third of the bank still had days nothing would ask for. A file costs one more request
/// than arithmetic and buys every puzzle a date.
///
/// Keyed by the **actual calendar year**, not an offset from the epoch, so a file is the thing a
/// player's own date names and last year's file is never rewritten. A year that has been and gone
/// cannot change, which is what makes these worth caching forever.
///
/// Ids are written as one fixed-width run per band rather than as an array, so a day is a slice
/// at `dayOfYear * idChars` and a year costs `365 * 3 * 12` bytes of payload and no punctuation —
/// about 13 KB, against 40 KB of JSON commas and quotes for the same thing. It is the same trade
/// the graph rows make.
///
/// A band shorter than the calendar **comes round again**, and which board it shows when it does
/// is `calendar::deal`'s decision rather than arithmetic here. The puzzles are stored once, in the
/// shards, and a short band repeats in the calendar rather than on disk.
fn calendar_bodies(
    config: &Config,
    puzzles: &[select::Puzzle],
    dealt: &calendar::Calendar,
) -> Result<Vec<(i32, String)>, String> {
    let bands = config.band_count();
    let days = dealt.days;
    if days == 0 {
        return Err("the bank is empty, so there is no calendar to write".into());
    }
    let epoch = date::days_from_civil(config.shared.epoch);
    let last_year = date::civil_from_days(epoch + days as i64 - 1).year;

    let mut written: Vec<(i32, String)> = Vec::new();
    for year in config.shared.epoch.year..=last_year {
        // Days of this year that the calendar actually covers: the first year starts at the
        // epoch rather than in January, and the last one stops when the calendar does.
        let january = date::days_from_civil(date::Date { year, month: 1, day: 1 });
        let from = january.max(epoch);
        let until = (january + date::days_in_year(year) as i64).min(epoch + days as i64);

        let mut runs: Vec<String> = Vec::with_capacity(bands);
        for band in 0..bands {
            let mut run =
                String::with_capacity(((until - from) as usize) * config.shared.id_chars);
            for at in from..until {
                run.push_str(&puzzles[dealt.on(band, (at - epoch) as usize) as usize].id);
            }
            runs.push(run);
        }

        let offset = date::day_of_year(date::civil_from_days(from));
        let body = format!(
            "{{\"year\":{year},\"from\":{offset},\"idChars\":{},\"bands\":[{}]}}",
            config.shared.id_chars,
            runs.iter().map(|run| format!("\"{run}\"")).collect::<Vec<_>>().join(","),
        );
        written.push((year, body));
    }
    Ok(written)
}

/// Delete shards, calendar years, and the pair index left over from an earlier version.
///
/// Every rebuild renames all of them, so without this the directory grows by 28MB a build and
/// the old files ship. Only the names this function writes, at a *different* version, are
/// removed — nothing else in the directory is ever touched, and `manifest.json` has no version
/// in its name so it can never match.
fn remove_stale_shards(dir: &Path, version: &str) -> Result<usize, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(0),
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((rest, shard)) = name
            .strip_suffix(".tsv")
            .map(|rest| (rest, true))
            .or_else(|| name.strip_suffix(".json").map(|rest| (rest, false)))
        else {
            continue;
        };
        let Some((index, found)) = rest.split_once('-') else {
            continue;
        };
        let versioned = !found.is_empty() && found.chars().all(|c| c.is_ascii_hexdigit());
        // A shard or the pair index, both TSV and versioned the same way; or a calendar year,
        // which is JSON named by the year itself.
        let ours = if shard {
            index == "pairs" || (index.len() == 2 && index.chars().all(|c| c.is_ascii_hexdigit()))
        } else {
            index.len() == 4 && index.chars().all(|c| c.is_ascii_digit())
        };
        if versioned && ours && found != version && std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Neighbour lists over the *dictionary's* ids, sorted, one row per dictionary word.
///
/// A tier's own graph is indexed by its own word list, which is not the dictionary —
/// the common graph knows nothing of rare words, and both graphs drop words too short
/// to carry a move. So every id is translated through the dictionary index on the way
/// out, and a word with no moves gets an empty row rather than being missing.
fn rows_of(
    graph: &graph::Graph,
    index: &FxMap<&str, u32>,
    edges: impl Iterator<Item = (u32, u32)>,
) -> Vec<Vec<u32>> {
    let mut rows = vec![Vec::new(); index.len()];
    for (big, small) in edges {
        let (Some(&a), Some(&b)) = (index.get(graph.word(big)), index.get(graph.word(small))) else {
            continue;
        };
        rows[a as usize].push(b);
        rows[b as usize].push(a);
    }
    for row in &mut rows {
        row.sort_unstable();
        row.dedup();
    }
    rows
}

/// Append `values` as a JSON array of steps between them.
///
/// Sorted indices delta-encode to small repeated integers, which gzip handles far
/// better than the absolute values. Both index files are written this way; the
/// client's `decodeDeltas` in src/lib/data.ts is the other end of it.
fn push_deltas(out: &mut String, values: impl IntoIterator<Item = u32>) {
    let mut previous = 0i64;
    for (i, value) in values.into_iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&(value as i64 - previous).to_string());
        previous = value as i64;
    }
}

/// Everything the browser fetches: one directory per mode, and the shared bank.
///
/// **A mode's three files keep the shapes they always had** — a dictionary, both graphs as
/// neighbour rows, and which of the words are ordinary — because that is what makes a second
/// alphabet nearly free on the client too: `decodeGameData` reads a phonemes directory with no
/// idea that its "words" are pronunciations. The phonemes mode adds a fourth, `lexicon.json`,
/// which is the only file with anything alphabet-specific in it.
fn write_outputs(
    data: &Path,
    config: &Config,
    built: &[Built],
    selection: &select::Selection,
    dealt: &calendar::Calendar,
) -> Result<(), String> {
    // Each mode's four files, and the digest of them that names them. Collected here because
    // the manifest has to say what to fetch, and the manifest is written by the shards.
    let mut digests: Vec<String> = Vec::new();
    for one in built {
        digests.push(write_mode(&data.join(&one.mode.name), one)?);
    }
    write_puzzle_shards(data, config, built, &digests, &selection.puzzles, dealt)?;
    // Only once everything is written, because until then the manifest on disk is the old one
    // and still names the old files. Sweeping first left a window where a build that died
    // halfway had deleted the files its own manifest pointed at.
    for (one, digest) in built.iter().zip(&digests) {
        sweep_mode(&data.join(&one.mode.name), one, digest);
    }
    Ok(())
}

/// A mode's data file, named by the digest of everything in the four of them.
///
/// **Its contents belong in its name**, because these are fetched `force-cache`: their names
/// promise they cannot change, so a browser that has been to the site keeps whatever it has
/// for ever. That rule is written down where the bank version is computed, and these four
/// files were the ones breaking it — a returning visitor could pair a fresh shard with a
/// dictionary from a build ago.
///
/// **Not the vocabulary digest, which was the first attempt and was a false promise.** The
/// vocabulary is the legal word list and the two lengths, because that is what a shared
/// board's *code* indexes into; but `common.json` is the common tier, `graph.json` carries the
/// common rows too, and `lexicon.json` depends on the frequency ranking. All three can move
/// while the vocabulary stands still, and then a name built from the vocabulary does not
/// change and the stale copy is served for ever. So this is a digest of the bytes: nothing to
/// reason about, and any change to any of the four renames all four.
fn named(what: &str, digest: &str) -> String {
    format!("{what}-{digest}.json")
}

/// Which files a mode ships. The lexicon is only for a translated alphabet.
fn mode_files(one: &Built, digest: &str) -> Vec<String> {
    let mut names = vec![
        named("dictionary", digest),
        named("graph", digest),
        named("common", digest),
        named("regions", digest),
    ];
    if one.mode.alphabet != Alphabet::Letters {
        names.push(named("lexicon", digest));
    }
    names
}

/// Anything in a mode's directory that this build did not write.
///
/// Six megabytes a stale build, and one of them is a name a browser may still be asking for.
/// The same housekeeping `remove_stale_shards` does for the bank, and for the same reason.
fn sweep_mode(dir: &Path, one: &Built, digest: &str) {
    let ours = mode_files(one, digest);
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".json") && !ours.contains(&name) && std::fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    if removed > 0 {
        eprintln!("  removed {removed} file(s) from an older build of {}", one.mode.name);
    }
}

/// One mode's dictionary, graphs, common list and — for a translated alphabet — lexicon.

fn write_mode(dir: &Path, one: &Built) -> Result<String, String> {
    let mode = one.mode;
    let (legal, common, lex) = (&one.legal, &one.common, &one.lex);

    // The dictionary does double duty: the set of legal guesses, and the canonical index the
    // other two files refer to. One sorted list, so no word is ever stored twice.
    let dictionary = format!("{{\"words\":\"{}\"}}", lex.legal.join("\\n"));

    let index: FxMap<&str, u32> = lex
        .legal
        .iter()
        .enumerate()
        .map(|(i, w)| (w.as_str(), i as u32))
        .collect();

    // Both graphs, as half of each neighbour list: for every word, the neighbours whose
    // id is greater than its own.
    //
    // This used to be a bare edge list, and the browser turned it into adjacency on
    // every page load: 517,000 pushes into 151,000 arrays, a fifth of a second before a
    // board could be drawn, and rather more on a phone. Worse, the *common* graph was
    // not shipped at all — the client re-derived it edge by edge, asking whether some
    // reading of each move named an ordinary word, which is both slow and a second
    // implementation of a definition this file already owns.
    //
    // Half a row rather than a whole one because an undirected edge written from both
    // ends is written twice: whole rows came to 1,084KB gzipped against 352KB for the
    // old edge list, and the client can mirror halves with two passes over a typed
    // array. Counts rather than offsets for the same reason — most words have none, and
    // a column of zeroes costs almost nothing once compressed.
    let legal_rows = rows_of(legal, &index, legal.edges.iter().copied());
    let common_rows = rows_of(common, &index, common.edges.iter().copied());

    let mut graph_json = String::with_capacity(legal.edges.len() * 8 + 1024);
    graph_json.push_str(&format!(
        "{{\"params\":{{\"commonScowl\":{},\"legalScowl\":{},\"minWord\":{},\"minSub\":{},\
         \"alphabet\":\"{}\"}}",
        mode.common_scowl,
        mode.legal_scowl,
        mode.min_word,
        mode.min_sub,
        mode.alphabet.name(),
    ));
    for (name, rows) in [("legal", &legal_rows), ("common", &common_rows)] {
        let halves: Vec<Vec<u32>> = rows
            .iter()
            .enumerate()
            .map(|(id, row)| row.iter().copied().filter(|&n| n as usize > id).collect())
            .collect();

        graph_json.push_str(&format!(",\"{name}\":{{\"counts\":["));
        for (i, half) in halves.iter().enumerate() {
            if i > 0 {
                graph_json.push(',');
            }
            graph_json.push_str(&half.len().to_string());
        }
        // Each half-row ascends, so the steps between them are small and repeat, which
        // is what gzip is good at. The first of a row is absolute.
        graph_json.push_str("],\"above\":[");
        let mut first = true;
        for half in &halves {
            let mut previous = 0i64;
            for (i, &id) in half.iter().enumerate() {
                if !first {
                    graph_json.push(',');
                }
                first = false;
                graph_json
                    .push_str(&(if i == 0 { id as i64 } else { id as i64 - previous }).to_string());
                previous = id as i64;
            }
        }
        graph_json.push_str("]}");
    }
    graph_json.push('}');
    words::write_file(&dir.join(named("graph", &one.vocab)), &graph_json)?;

    // Which dictionary words are ordinary ones. The client draws the board from
    // these and no others: the whole 189k list is what a player may *guess*, but a
    // board built from it shows routes through words nobody knows, and a gilt
    // "best route" that is not the answer the puzzle advertises.
    let mut common_ids: Vec<u32> = lex
        .common
        .iter()
        .filter_map(|w| index.get(w.as_str()).copied())
        .collect();
    common_ids.sort_unstable();
    let mut common_json = String::with_capacity(common_ids.len() * 5 + 32);
    common_json.push_str("{\"common\":[");
    push_deltas(&mut common_json, common_ids);
    common_json.push_str("]}");

    // Every body, then the digest of all of them, then the files. Named by their own bytes —
    // see `named` — so this is the one order that can produce that name.
    let mut bodies = vec![dictionary, graph_json, common_json, regions_body(one, &index)];
    if mode.alphabet != Alphabet::Letters {
        bodies.push(lexicon_body(one, &index));
    }
    let digest = id::digest(bodies.concat().as_bytes(), 8);
    for (name, body) in mode_files(one, &digest).iter().zip(&bodies) {
        words::write_file(&dir.join(name), body)?;
        eprintln!("  wrote {}/{name} ({} KB)", mode.name, body.len() / 1024);
    }
    Ok(digest)
}

/// The explore mode's map: which territory each word is in, and what each is called.
///
/// Indexed against the **dictionary**, like `common.json` and the graph rows, so the client
/// needs nothing but the word list to read it. A word in no region is simply absent — that is
/// how a component too small to explore, and every word with no moves at all, says so, and it
/// is the majority of the list, so listing the exclusions instead would be the larger file.
///
/// Ids ascend within a region and delta-encode, which is the same trade `common.json` makes.
/// The regions themselves are ordered by their first member, so the file is diffable: a region
/// that gained a word stays where it was rather than the whole list shifting.
fn regions_body(one: &Built, index: &FxMap<&str, u32>) -> String {
    let mut rows: Vec<String> = Vec::with_capacity(one.regions.regions.len());
    for region in &one.regions.regions {
        let mut ids: Vec<u32> = region
            .words
            .iter()
            .filter_map(|&id| index.get(one.common.word(id)).copied())
            .collect();
        ids.sort_unstable();
        let mut row = format!("{{\"name\":\"{}\",\"words\":[", one.lex.label(one.common.word(region.name)));
        push_deltas(&mut row, ids);
        row.push_str("]}");
        rows.push(row);
    }
    format!(
        "{{\"minComponent\":{},\"regions\":[{}]}}",
        one.mode.min_component,
        rows.join(",")
    )
}

/// How to read a token back: what to draw it as, and how to say it.
///
/// The one file whose shape belongs to an alphabet rather than to the game. Three parts:
///
/// * `phonemes` — the code character, its IPA and its ARPAbet name, in `PHONEMES` order. A
///   token is rendered by mapping its characters through this, and nothing else the client
///   does needs to know what a phoneme is.
/// * `nodes` — one line per dictionary token, in dictionary order. Line `n` is token `n`, so
///   there are no keys: the dictionary already is the index, exactly as it is for the graph
///   rows. Each line is `1` or `0` for whether this is some word's primary pronunciation,
///   then the spellings that name it, best first.
/// * `guesses` — the other direction, and what a typed word is resolved through. Sorted by
///   spelling, which the client does not need — it builds a map once — but which makes the
///   file diffable, and a lexicon that changes shape between builds is worth being able to
///   read.
fn lexicon_body(one: &Built, index: &FxMap<&str, u32>) -> String {
    let lex = &one.lex;

    // One row per *character* a token can hold, which is every symbol plus the two that are
    // a different sound when stressed. The client maps characters to symbols and never has to
    // know that CMUdict wrote a digit.
    let mut rows: Vec<String> = Vec::with_capacity(phonetic::PHONEMES.len() + 2);
    for p in &phonetic::PHONEMES {
        rows.push(format!(
            "{{\"code\":\"{}\",\"ipa\":\"{}\",\"name\":\"{}\"}}",
            p.code, p.ipa, p.arpabet
        ));
        if let Some((code, ipa)) = p.stressed {
            rows.push(format!(
                "{{\"code\":\"{code}\",\"ipa\":\"{ipa}\",\"name\":\"{}1\"}}",
                p.arpabet
            ));
        }
    }
    let phonemes = rows.join(",");

    // One line per token, tab separated within and newline separated between — the same trade
    // the dictionary makes, since the alternative is 76,000 JSON objects of quotes and commas
    // for a few hundred KB of words.
    let mut nodes = String::with_capacity(lex.legal.len() * 16);
    for (i, token) in lex.legal.iter().enumerate() {
        if i > 0 {
            nodes.push('\n');
        }
        nodes.push(if lex.is_primary(token) { '1' } else { '0' });
        for spelling in lex.labels(token) {
            nodes.push('\t');
            nodes.push_str(spelling);
        }
    }

    // Spelling to the tokens it may be said as. A spelling with several pronunciations is one
    // line with several ids, because a guess is legal if *any* of them makes a move — the same
    // generosity `wordReading` already shows about which run of letters a move removed.
    let mut said: FxMap<&str, Vec<u32>> = FxMap::default();
    for token in &lex.legal {
        let Some(&id) = index.get(token.as_str()) else { continue };
        for spelling in lex.labels(token) {
            said.entry(spelling.as_str()).or_default().push(id);
        }
    }
    let mut guesses: Vec<(&str, Vec<u32>)> = said.into_iter().collect();
    guesses.sort_unstable_by(|a, b| a.0.cmp(b.0));
    let mut typed = String::with_capacity(guesses.len() * 12);
    for (i, (spelling, mut ids)) in guesses.into_iter().enumerate() {
        if i > 0 {
            typed.push('\n');
        }
        ids.sort_unstable();
        typed.push_str(spelling);
        for id in ids {
            typed.push('\t');
            typed.push_str(&id.to_string());
        }
    }

    format!(
        "{{\"phonemes\":[{phonemes}],\"nodes\":\"{}\",\"guesses\":\"{}\"}}",
        nodes.replace('\n', "\\n").replace('\t', "\\t"),
        typed.replace('\n', "\\n").replace('\t', "\\t"),
    )
}


