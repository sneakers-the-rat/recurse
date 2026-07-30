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
mod config;
mod date;
mod graph;
mod id;
mod progress;
mod select;
mod word;
mod words;

use std::path::{Path, PathBuf};
use std::time::Instant;

use config::{Audit, Config};
use graph::{FxMap, FxSet};

const USAGE: &str = "\
graphgen — build the recurse graph and puzzle bank

  graphgen                       build everything into public/data
  graphgen pair <from> <to>      judge one pair and print what a build would decide
  graphgen routes <word>...      bank answers that run through all of these words
  graphgen --help

Every number comes from .env; any RECURSE_* value can be overridden for one run:

  RECURSE_ALT_WAYS=6 graphgen pair understanding keynoting
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
        [verb, ..] => Err(format!("unknown command {verb:?}.\n\n{USAGE}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match command(&args) {
        Ok(command) => command,
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
    if let Err(message) = run(command) {
        eprintln!("\x1b[31merror\x1b[0m: {message}");
        std::process::exit(1);
    }
}

/// Repo root, found by walking up from the executable or the current directory.
fn find_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;
    loop {
        if dir.join(".env").exists() && dir.join("package.json").exists() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err("could not find the repo root (no .env beside package.json)".into());
        }
    }
}

fn run(command: Command) -> Result<(), String> {
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

    // ---------------------------------------------------------------- corpora
    let blocked = words::load_list(&root.join("tools").join("blocklist.txt"))?;

    let legal_raw = words::load_scowl(&cache, config.legal_scowl)?;
    let common_raw = words::load_scowl(&cache, config.common_scowl)?;
    let frequency = words::load_frequency(&cache)?;

    let keep = |set: &std::collections::HashSet<String>| -> Vec<String> {
        let mut out: Vec<String> = set
            .iter()
            .filter(|w| !blocked.contains(*w) && w.len() >= config.min_sub)
            .cloned()
            .collect();
        out.sort();
        out
    };

    let legal_words = keep(&legal_raw);
    let common_words = keep(&common_raw);
    eprintln!(
        "corpora: {} legal (SCOWL {}), {} common (SCOWL {})",
        legal_words.len(),
        config.legal_scowl,
        common_words.len(),
        config.common_scowl
    );

    // Frequency supplies an ordering only, never legality.
    let rank: FxMap<String, usize> = frequency
        .iter()
        .enumerate()
        .map(|(i, w)| (w.clone(), i))
        .collect();

    // ---------------------------------------------------------- the two graphs
    //
    // Identical construction over different corpora: a word can be a node if it
    // is long enough, and a run can be removed if the corpus contains it. The
    // tiers differ only in which words those are.
    let legal_subs: FxSet<&str> = legal_words.iter().map(String::as_str).collect();
    let common_subs: FxSet<&str> = common_words.iter().map(String::as_str).collect();

    let tier = |name: &str, words: &[String], subs: &FxSet<&str>| {
        let phase = Instant::now();
        let nodes: Vec<String> = words
            .iter()
            .filter(|w| w.len() >= config.min_word)
            .cloned()
            .collect();
        let graph = graph::build(nodes, subs, config.min_word, config.min_sub, threads);
        eprintln!(
            "{name} graph: {} edges over {} words in {:.1}s",
            graph.edges.len(),
            graph.adjacency.iter().filter(|a| !a.is_empty()).count(),
            phase.elapsed().as_secs_f64()
        );
        graph
    };

    let legal = tier("legal ", &legal_words, &legal_subs);
    let common = tier("common", &common_words, &common_subs);

    // One pair, and stop. See `inspect_pair`.
    if let Command::Pair(from, to) = &command {
        return inspect_pair(&common, &common_subs, &legal, &config, &rank, from, to);
    }

    // --------------------------------------------------------------- puzzles
    //
    // The search is the expensive half and its result is cached; the calendar and the
    // output files are rebuilt every run, because they are seconds and because their
    // knobs are not part of what the search depends on. See bank.rs.
    let phase = Instant::now();
    let mut blocklist: Vec<String> = blocked.iter().cloned().collect();
    blocklist.sort();
    let bank_key = bank::key(&config, &blocklist, config.id_chars);
    let bank_path = bank::path(&cache, &bank_key);

    // Answers through a word, and stop. See `show_routes`.
    if let Command::Routes(words) = &command {
        return show_routes(&common, &config, &bank_path, words);
    }

    let found = match bank::load(&bank_path) {
        Some(cached) if config.audit == Audit::Off => {
            eprintln!(
                "puzzles: {} from cache ({}), {} candidates — delete it or change a rule to search again",
                cached.puzzles.len(),
                bank_path.file_name().unwrap_or_default().to_string_lossy(),
                cached.candidates,
            );
            select::Selection {
                passed: cached.puzzles.len(),
                puzzles: cached.puzzles,
                rejections: cached.rejections,
                candidates: cached.candidates,
                // Set by `schedule`, which runs on every build: the calendar is not cached.
            }
        }
        _ => {
            let found = select::select(&common, &common_subs, &legal, &config, &rank, threads);
            eprintln!(
                "puzzles: {} of {} candidates passed the rules, in {:.1}s",
                found.passed,
                found.candidates,
                phase.elapsed().as_secs_f64()
            );
            // An audit is a way of looking at the bank rather than a different bank, so
            // it reports its table and leaves the cache alone.
            if config.audit == Audit::Off {
                bank::save(&bank_path, &found)?;
                eprintln!("  cached the bank in tools/cache/");
            }
            found
        }
    };

    let selection = select::schedule(found, &config);
    report_rules(&selection, config.audit != Audit::Off);

    eprintln!(
        "  by par: {}",
        par_histogram(&selection)
            .iter()
            .map(|(p, n)| format!("{p}:{n}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    report_bands(&selection, &config);
    report_boards(&selection);
    for puzzle in selection.puzzles.iter().take(5) {
        eprintln!(
            "    {} -> {} par={} board={} alt={}",
            puzzle.source, puzzle.target, puzzle.par, puzzle.corridor_size, puzzle.alt_nodes
        );
    }

    // ----------------------------------------------------------------- output
    check_ids(&selection.puzzles, &config)?;
    write_outputs(&data, &config, &legal, &common, &legal_words, &common_words, &selection)?;
    write_survey(&root.join("tools").join("survey.txt"), &config, &selection)?;
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
fn inspect_pair(
    common: &graph::Graph,
    common_subs: &FxSet<&str>,
    legal: &graph::Graph,
    config: &Config,
    rank: &FxMap<String, usize>,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let (Some(src), Some(tgt)) = (common.id(from), common.id(to)) else {
        return Err(format!(
            "{from} and {to} both have to be ordinary words carrying a move — one of them is not"
        ));
    };

    // The same distance tables selection builds, for two endpoints instead of twelve thousand.
    let mut bfs = graph::Bfs::new(common.words.len());
    let mut tables = [vec![u8::MAX; common.words.len()], vec![u8::MAX; common.words.len()]];
    let Some(par) = rows_for(common, config, &mut bfs, &mut tables, [src, tgt]) else {
        return Err(format!(
            "{from} cannot reach {to} through ordinary words within {} moves",
            config.max_par + config.slack
        ));
    };
    let mut slot_of: FxMap<u32, usize> = FxMap::default();
    slot_of.insert(src, 0);
    slot_of.insert(tgt, 1);

    // Every rule judged, so the report says everything the direction breaks rather than
    // whichever rule happens to run first. `mirrored` is false both times: the question here is
    // what each direction is worth on its own, not which of them a build would have kept first.
    let mut scratch = select::Scratch::new(common, legal);
    let overexposed = select::Overexposed::new(common);
    for (src, tgt) in [(src, tgt), (tgt, src)] {
        let verdict = select::judge_direction(
            src,
            tgt,
            par,
            common,
            common_subs,
            legal,
            config,
            rank,
            &tables[slot_of[&src]],
            &tables[slot_of[&tgt]],
            u8::MAX,
            true,
            false,
            &overexposed,
            &mut scratch,
        );
        report_direction(common, &verdict, common.word(src), common.word(tgt), par);
    }
    Ok(())
}

/// One direction of one pair, as the build sees it.
fn report_direction(
    common: &graph::Graph,
    verdict: &select::Verdict,
    from: &str,
    to: &str,
    par: u32,
) {
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
    for route in &puzzle.routes {
        eprintln!("    {route}");
    }
    eprintln!("  {}", words.join(" "));
}

/// Distance rows for the two ends of one pair, and the par between them.
///
/// What every rule reads, and the only per-pair setup there is. `None` for a pair the search
/// range does not join — which cannot happen for a pair out of the bank, but this is also how
/// one pair is set up by hand.
fn rows_for(
    common: &graph::Graph,
    config: &Config,
    bfs: &mut graph::Bfs,
    rows: &mut [Vec<u8>; 2],
    ends: [u32; 2],
) -> Option<u32> {
    let far = (config.max_par + config.slack) as u32;
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

/// The bank's answers that run through **all** of these words, in any order.
///
/// For reading a word's exposure rather than counting it: `pivots.test.ts` says `ions` is on 19%
/// of answers, and this says what those answers look like — which is the question that decides
/// whether the word belongs in `TOO_FREQUENT`. Several words at once is how a *cluster* is read:
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
    common: &graph::Graph,
    config: &Config,
    bank_path: &Path,
    words: &[String],
) -> Result<(), String> {
    let Some(bank) = bank::load(bank_path) else {
        return Err(format!(
            "no cached bank at {} — run `npm run data` first, then ask about it",
            bank_path.display()
        ));
    };

    /// Answers printed in full before the rest are only counted.
    const SHOWN: usize = 30;

    let mut bfs = graph::Bfs::new(common.words.len());
    let far = (config.max_par + config.slack) as u32;

    // Distances from each asked-for word, copied out of the shared scratch so all of them are
    // live at once while the bank is scanned.
    let mut asked: Vec<(&str, u32, Vec<u32>)> = Vec::new();
    for word in words {
        let Some(id) = common.id(word) else {
            eprintln!("{word}: not an ordinary word carrying a move — skipped");
            continue;
        };
        bfs.run(common, id, far);
        let mut row = vec![graph::UNREACHED; common.words.len()];
        for &near in &bfs.touched {
            row[near as usize] = bfs.get(near);
        }
        asked.push((word.as_str(), id, row));
    }
    if asked.is_empty() {
        return Err("none of those words are in the common graph".into());
    }

    let empty: FxSet<u32> = FxSet::default();
    let mut found = 0usize;
    let mut printed = 0usize;
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
        // What each word is on by itself, which is only for the summary below.
        for (slot, (_, _, row)) in asked.iter().enumerate() {
            if select::on_some_answer(puzzle.par, row[src as usize], row[tgt as usize]) {
                alone[slot] += 1;
            }
        }

        // All of them on one answer. The rules ask exactly this of `TOO_FREQUENT_CLUSTER`, so it
        // goes through the same function — `d(a, b)` being a row of `a` read at `b`.
        if !select::all_on_one_route(
            asked.len(),
            puzzle.par,
            &|i| asked[i].2[src as usize],
            &|i| asked[i].2[tgt as usize],
            &|i, j| asked[i].2[asked[j].1 as usize],
        ) {
            continue;
        }
        found += 1;

        // The order an answer meets them in: every step of a shortest route moves one further
        // from the source, so their distances from it are the order.
        order.clear();
        order.extend(0..asked.len());
        order.sort_by_key(|&slot| asked[slot].2[src as usize]);
        if printed >= SHOWN {
            continue;
        }
        printed += 1;

        // The answer, walked: source, the asked-for words in the order above, target. Each hop is
        // a shortest route, and distance from the source rises across the whole chain, so the
        // pieces join into one shortest answer and none of them revisits a word.
        let mut stops: Vec<u32> = vec![src];
        for &slot in &order {
            if *stops.last().expect("starts with the source") != asked[slot].1 {
                stops.push(asked[slot].1);
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
            route.iter().map(|&step| common.word(step)).collect::<Vec<_>>().join(" → ")
        );
    }

    // "a, b and c" rather than "a and b and c", which three words read as badly as it looks.
    let names: Vec<&str> = asked.iter().map(|(word, _, _)| *word).collect();
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
                .map(|((word, _, _), count)| format!("{word} {count}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    if found == 0 {
        eprintln!(
            "  nothing. A word in TOO_FREQUENT comes out at zero on its own, because the rule \
             refused every puzzle whose answer touched it; words with counts of their own and \
             nothing here share no single answer"
        );
    }
    Ok(())
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
                 RECURSE_ID_CHARS (now {}) and rebuild — but the length is a digest \
                 parameter, so that gives every puzzle a new id and every link \
                 already shared stops resolving",
                puzzle.id, other.source, other.target, puzzle.source, puzzle.target,
                config.id_chars,
            ));
        }
    }
    eprintln!(
        "  ids: {} unique at {} hex digits",
        puzzles.len(),
        config.id_chars
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

/// How the numbers in a rule table were arrived at. Both are exact counts over every
/// candidate; they differ in whether a candidate is judged past its first failure.
fn how_counted(config: &Config) -> &'static str {
    match config.audit {
        Audit::Off => "cascade — each candidate stops at its first failure, so a rule's \
                       count is the candidates that reached it (RECURSE_AUDIT=1 for the \
                       count that break it)",
        Audit::On => "audited — every rule judged against every candidate",
    }
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
/// Columns are the pars the search actually looked at (`RECURSE_MIN_PAR`..`MAX_PAR`), and the
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

/// How even the three lengths are, which is a property of the *rules* and not of the cuts.
///
/// Every day offers one short, one medium and one long board, so the bands have to be within
/// hailing distance of each other or the game runs out of one length while another still has
/// centuries left. The cuts are `RECURSE_BAND_CUTS`, but what each cut holds is decided by
/// which puzzles the rules let through — so a rule change moves these shares, and this report
/// is how that shows up. Printed on every build, beside the rule table, for that reason.
///
/// Every band runs the whole calendar; a band shorter than the longest one repeats to fill it,
/// so `repeats` is how many times over. The calendar's length is the longest band's, which is
/// what `write_calendar` writes and what "how many days there are" means.
fn report_bands(selection: &select::Selection, config: &Config) {
    let total = selection.puzzles.len().max(1);
    let days = calendar_days(&selection.puzzles);
    eprintln!(
        "  bands ({} puzzles over {days} days, {:.0} years, one of each length per day):",
        selection.puzzles.len(),
        days as f64 / 365.25,
    );
    eprintln!(
        "    {:<8} {:>6}  {:>9}  {:>7}  {}",
        "band", "pars", "puzzles", "share", "repeats"
    );
    for band in 0..select::BANDS {
        let held = selection.puzzles.iter().filter(|p| p.band == band).count();
        let (low, high) = band_pars(config, band);
        eprintln!(
            "    {:<8} {:>6}  {:>9}  {:>6.1}%  {:>7.2}x",
            select::band_name(band),
            format!("{low}-{high}"),
            held,
            100.0 * held as f64 / total as f64,
            days as f64 / held.max(1) as f64,
        );
    }
}

/// How many days the calendar runs: the longest band's length.
///
/// Every band fills every day — a shorter one by cycling — so the longest is what bounds it.
/// There is no second number here on purpose: a puzzle that shipped and could not be reached by
/// any date was the bug this replaced.
fn calendar_days(puzzles: &[select::Puzzle]) -> usize {
    (0..select::BANDS)
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

/// The bank in calendar order, with the answers the filters let through.
///
/// Judging taste means reading the actual puzzles, and stepping a thousand of them
/// through dev mode one at a time is not reading. This is the instrument for that:
/// change a filter, rebuild, diff the survey, see exactly which puzzles the change
/// let in or threw out. Each line carries the puzzle's id, so anything suspicious
/// can be opened at `/<id>` and played; `№` is its place in the calendar, which is
/// what dev mode steps through.
fn write_survey(
    path: &Path,
    config: &Config,
    selection: &select::Selection,
) -> Result<(), String> {
    let mut out = String::with_capacity(selection.puzzles.len() * 120);
    out.push_str(&format!(
        "{} puzzles, seed {}, par {}-{}, SCOWL {} legal over {} common\n\
         {} candidates, {} passed the rules\n",
        selection.puzzles.len(),
        config.seed,
        config.min_par,
        config.max_par,
        config.legal_scowl,
        config.common_scowl,
        selection.candidates,
        selection.passed,
    ));
    out.push_str(&format!(
        "by par: {}\n",
        par_histogram(selection)
            .iter()
            .map(|(p, n)| format!("{p}:{n}"))
            .collect::<Vec<_>>()
            .join(" ")
    ));
    // How even the three lengths came out, which is a property of the rules — see
    // `report_bands`. In the survey as well as the build output, because this is the file a
    // rule change gets diffed in.
    let total = selection.puzzles.len().max(1);
    for band in 0..select::BANDS {
        let held = selection.puzzles.iter().filter(|p| p.band == band).count();
        let (low, high) = band_pars(config, band);
        out.push_str(&format!(
            "band {:<6} par {low}-{high}: {held} puzzles ({:.1}%)\n",
            select::band_name(band),
            100.0 * held as f64 / total as f64,
        ));
    }
    // The whole rule table, so a survey read weeks later still says which settings
    // produced it. `only` is what relaxing that one rule would let back in.
    out.push_str(&format!("refused by each rule, {}:\n", how_counted(config)));
    for (rule, refused, sole) in rule_rows(selection) {
        let (what, knob) = rule.describe();
        out.push_str(&format!("  {refused:>7} ({sole:>6})  {what}  [{knob}]\n"));
    }
    out.push('\n');
    out.push_str(&rule_grid(selection));
    out.push('\n');

    for (i, puzzle) in selection.puzzles.iter().enumerate() {
        out.push_str(&format!(
            "№{:<5} {}  {} → {}   par {}{}  routes {}  board {}  rank {}\n",
            i,
            puzzle.id,
            puzzle.source,
            puzzle.target,
            puzzle.par,
            if puzzle.secret > 0 {
                format!(" (secret {})", puzzle.secret)
            } else {
                String::new()
            },
            puzzle.shortest_paths,
            puzzle.corridor_size,
            puzzle.max_rank,
        ));
        for route in &puzzle.routes {
            out.push_str(&format!("        {route}\n"));
        }
    }
    words::write_file(path, &out)?;
    eprintln!("  wrote tools/survey.txt ({} puzzles)", selection.puzzles.len());
    Ok(())
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
/// * A daily board is band `B` on day `N`, which `spread` has placed in shard
///   `(N * BANDS + B) % SHARDS` — so the three lengths a day offers are in three different
///   shards, and playing one costs one fetch.
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
    puzzles: &[select::Puzzle],
) -> Result<(), String> {
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
    let calendar = calendar_bodies(config, puzzles)?;

    // The digest covers every immutable file's contents — every shard and every calendar year —
    // so any change to any of them renames all of them.
    //
    // The calendar has to be in here, and leaving it out was a bug that only appears on the
    // second build: the version is a digest of the *shards*, and moving `RECURSE_EPOCH` rewrites
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
    // `bands` carries what each length holds, because the header says "short (par 3-4)" and
    // those numbers are `RECURSE_BAND_CUTS`, not the client's to know. It no longer carries a
    // per-band length: every band runs the whole calendar now, so there is one length and it
    // belongs to the calendar rather than to a band.
    //
    // The epoch ships because the client used to hard-code it, and a date that has to agree
    // between the builder and the browser should be written down once. See `RECURSE_EPOCH`.
    let bands = (0..select::BANDS)
        .map(|band| {
            let (low, high) = band_pars(config, band);
            format!(
                "{{\"name\":\"{}\",\"minPar\":{low},\"maxPar\":{high}}}",
                select::band_name(band),
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let days = calendar_days(puzzles);
    let epoch = config.epoch;
    let last = date::civil_from_days(
        date::days_from_civil(epoch) + days.saturating_sub(1) as i64,
    );
    let manifest = format!(
        "{{\"version\":\"{version}\",\"shards\":{},\"bands\":[{bands}],\"puzzles\":{},\
         \"epoch\":\"{:04}-{:02}-{:02}\",\"days\":{days},\"years\":[{},{}],\
         \"params\":{{\"slack\":{},\"minPar\":{},\"maxPar\":{}}}}}",
        id::SHARDS,
        puzzles.len(),
        epoch.year,
        epoch.month,
        epoch.day,
        epoch.year,
        last.year,
        config.slack,
        config.min_par,
        config.max_par,
    );

    let mut largest = 0usize;
    for (index, body) in bodies.iter().enumerate() {
        largest = largest.max(body.len());
        words::write_file(&dir.join(name_of(index)), body)?;
    }

    // Every pair and the address it lives at, for dev mode's lookup by words.
    //
    // A shard can only be found from an id, and an id is a digest of an answer, so there is
    // no way to get from "the puzzle about `warming` and `scolding`" to a board without an
    // index of the pairs — and the client holds one shard of the bank, not the bank. This is
    // that index: the whole calendar, three fields a line, sorted so it reads.
    //
    // Nothing a player does fetches it. Dev mode asks for it when the lookup is used, which
    // is why it is one file rather than part of the shards: a build that ships it costs
    // players nothing and costs whoever is judging the bank one download.
    let mut pairs: Vec<&select::Puzzle> = puzzles.iter().collect();
    pairs.sort_unstable_by(|a, b| {
        (&a.source, &a.target, &a.id).cmp(&(&b.source, &b.target, &b.id))
    });
    let mut index = String::with_capacity(pairs.len() * 32);
    for puzzle in &pairs {
        index.push_str(&puzzle.source);
        index.push('\t');
        index.push_str(&puzzle.target);
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
/// A band shorter than the calendar **cycles**: day `D` of band `B` is that band's puzzle number
/// `D % len(B)`. So the puzzles are stored once, in the shards, and a short list repeats in the
/// calendar rather than on disk.
fn calendar_bodies(
    config: &Config,
    puzzles: &[select::Puzzle],
) -> Result<Vec<(i32, String)>, String> {
    // Each band in day order. `spread` numbered them, so this is a sort into that order.
    let mut by_band: Vec<Vec<&select::Puzzle>> = vec![Vec::new(); select::BANDS];
    for puzzle in puzzles {
        by_band[puzzle.band].push(puzzle);
    }
    for band in by_band.iter_mut() {
        band.sort_unstable_by_key(|puzzle| puzzle.day);
    }

    let days = calendar_days(puzzles);
    if days == 0 {
        return Err("the bank is empty, so there is no calendar to write".into());
    }
    let epoch = date::days_from_civil(config.epoch);
    let last_year = date::civil_from_days(epoch + days as i64 - 1).year;

    let mut written: Vec<(i32, String)> = Vec::new();
    for year in config.epoch.year..=last_year {
        // Days of this year that the calendar actually covers: the first year starts at the
        // epoch rather than in January, and the last one stops when the calendar does.
        let january = date::days_from_civil(date::Date { year, month: 1, day: 1 });
        let from = january.max(epoch);
        let until = (january + date::days_in_year(year) as i64).min(epoch + days as i64);

        let mut runs: Vec<String> = Vec::with_capacity(select::BANDS);
        for band in 0..select::BANDS {
            let list = &by_band[band];
            let mut run = String::with_capacity(((until - from) as usize) * config.id_chars);
            for at in from..until {
                // Cycled, which is what fills a short band's share of a long calendar.
                run.push_str(&list[((at - epoch) as usize) % list.len()].id);
            }
            runs.push(run);
        }

        let offset = date::day_of_year(date::civil_from_days(from));
        let body = format!(
            "{{\"year\":{year},\"from\":{offset},\"idChars\":{},\"bands\":[{}]}}",
            config.id_chars,
            runs.iter().map(|run| format!("\"{run}\"")).collect::<Vec<_>>().join(","),
        );
        written.push((year, body));
    }
    Ok(written)
}

/// The pars a band holds, from the cuts. Inclusive at both ends.
fn band_pars(config: &Config, band: usize) -> (usize, usize) {
    let (short, medium) = config.band_cuts;
    match band {
        0 => (config.min_par, short as usize),
        1 => (short as usize + 1, medium as usize),
        _ => (medium as usize + 1, config.max_par),
    }
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

fn write_outputs(
    data: &Path,
    config: &Config,
    legal: &graph::Graph,
    common: &graph::Graph,
    legal_words: &[String],
    common_words: &[String],
    selection: &select::Selection,
) -> Result<(), String> {
    // The dictionary does double duty: the set of legal guesses, and the
    // canonical index the other two files refer to. One sorted list, so no word
    // is ever stored twice.
    let dictionary = format!("{{\"words\":\"{}\"}}", legal_words.join("\\n"));
    words::write_file(&data.join("dictionary.json"), &dictionary)?;

    let index: FxMap<&str, u32> = legal_words
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
        "{{\"params\":{{\"commonScowl\":{},\"legalScowl\":{},\"minWord\":{},\"minSub\":{}}}",
        config.common_scowl, config.legal_scowl, config.min_word, config.min_sub
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
    words::write_file(&data.join("graph.json"), &graph_json)?;

    write_puzzle_shards(data, config, &selection.puzzles)?;

    // Which dictionary words are ordinary ones. The client draws the board from
    // these and no others: the whole 189k list is what a player may *guess*, but a
    // board built from it shows routes through words nobody knows, and a gilt
    // "best route" that is not the answer the puzzle advertises.
    let mut common_ids: Vec<u32> = common_words
        .iter()
        .filter_map(|w| index.get(w.as_str()).copied())
        .collect();
    common_ids.sort_unstable();
    let mut common_json = String::with_capacity(common_ids.len() * 5 + 32);
    common_json.push_str("{\"common\":[");
    push_deltas(&mut common_json, common_ids);
    common_json.push_str("]}");
    words::write_file(&data.join("common.json"), &common_json)?;

    for name in ["dictionary.json", "graph.json", "common.json"] {
        let path = data.join(name);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        eprintln!("  wrote {name} ({} KB)", size / 1024);
    }
    Ok(())
}
