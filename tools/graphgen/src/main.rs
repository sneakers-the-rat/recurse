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
}

fn command(args: &[String]) -> Result<Command, String> {
    match args {
        [] => Ok(Command::Build),
        [verb] if verb == "-h" || verb == "--help" => Err(USAGE.to_string()),
        [verb, from, to] if verb == "pair" => Ok(Command::Pair(from.clone(), to.clone())),
        [verb, ..] if verb == "pair" => {
            Err(format!("`pair` takes exactly two words.\n\n{USAGE}"))
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
                aligned_days: [0; select::BANDS],
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
/// It goes through `judge_candidates`, which is the real thing — every rule, every knob, the
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
    let far = (config.max_par + config.slack) as u32;
    let unreachable_u8 = u8::MAX;
    let mut bfs = graph::Bfs::new(common.words.len());
    let mut tables: Vec<Vec<u8>> = Vec::with_capacity(2);
    for id in [src, tgt] {
        let mut row = vec![unreachable_u8; common.words.len()];
        bfs.run(common, id, far);
        for &word in &bfs.touched {
            row[word as usize] = bfs.get(word).min(u8::MAX as u32 - 1) as u8;
        }
        tables.push(row);
    }
    let mut slot_of: FxMap<u32, usize> = FxMap::default();
    slot_of.insert(src, 0);
    slot_of.insert(tgt, 1);

    let par = tables[0][tgt as usize];
    if par == unreachable_u8 {
        return Err(format!(
            "{from} cannot reach {to} through ordinary words within {far} moves"
        ));
    }
    let par = par as u32;

    // Every rule judged, so the report says everything the pair breaks rather than whichever
    // rule happens to run first.
    let progress = progress::Progress::new("pair", 1);
    let (puzzles, refused, _) = select::judge_candidates(
        &[(src, tgt, par)],
        common,
        common_subs,
        legal,
        config,
        rank,
        &tables,
        &slot_of,
        unreachable_u8,
        true,
        &progress,
    );

    eprintln!("{from} -> {to}  par {par}");
    let broken: Vec<&str> = select::Rule::ALL
        .iter()
        .enumerate()
        .filter(|&(slot, _)| refused[slot].iter().sum::<usize>() > 0)
        .map(|(_, rule)| rule.describe().0)
        .collect();
    if !broken.is_empty() {
        eprintln!("  refused: {}", broken.join("; "));
    }
    let Some(puzzle) = puzzles.first() else {
        return Ok(());
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
/// `days` is the calendar each band can be reached by date over; `by link` is the tail past
/// its shard alignment. The short band running out first is expected and is what the wrap in
/// `dayIndex` is for.
fn report_bands(selection: &select::Selection, config: &Config) {
    let total = selection.puzzles.len().max(1);
    eprintln!("  bands ({} puzzles, one of each per day):", selection.puzzles.len());
    eprintln!(
        "    {:<8} {:>6}  {:>9}  {:>7}  {:>8}  {}",
        "band", "pars", "puzzles", "share", "days", "years by date"
    );
    for band in 0..select::BANDS {
        let held = selection.puzzles.iter().filter(|p| p.band == band).count();
        let (low, high) = band_pars(config, band);
        let days = selection.aligned_days[band];
        eprintln!(
            "    {:<8} {:>6}  {:>9}  {:>6.1}%  {:>8}  {:>13.0}",
            select::band_name(band),
            format!("{low}-{high}"),
            held,
            100.0 * held as f64 / total as f64,
            days,
            days as f64 / 365.25,
        );
    }
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
            "band {:<6} par {low}-{high}: {held} puzzles ({:.1}%), {} days by date\n",
            select::band_name(band),
            100.0 * held as f64 / total as f64,
            selection.aligned_days[band],
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
    aligned_days: [usize; select::BANDS],
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

    // The digest covers every shard's contents, so any change to any puzzle — a new
    // answer, a different day — renames all of them.
    let mut everything = String::with_capacity(bodies.iter().map(String::len).sum());
    for body in &bodies {
        everything.push_str(body);
    }
    let version = id::digest(everything.as_bytes(), 8);

    let name_of = |index: usize| format!("{index:02x}-{version}.tsv");

    // What the client reads before anything else: the version its shard names are built
    // from, the shard arithmetic, and how long each band's calendar is. Without the lengths a
    // day past the end of a band would fetch a shard and find nothing in it; with them the
    // band wraps instead, which is what "the short one loops first" means.
    //
    // `bands` carries what each length holds as well as how long it runs, because the header
    // says "short (par 3-4)" and those numbers are `RECURSE_BAND_CUTS`, not the client's to
    // know.
    let bands = (0..select::BANDS)
        .map(|band| {
            let (low, high) = band_pars(config, band);
            format!(
                "{{\"name\":\"{}\",\"days\":{},\"minPar\":{low},\"maxPar\":{high}}}",
                select::band_name(band),
                aligned_days[band],
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let manifest = format!(
        "{{\"version\":\"{version}\",\"shards\":{},\"bands\":[{bands}],\"puzzles\":{},\
         \"params\":{{\"slack\":{},\"minPar\":{},\"maxPar\":{}}}}}",
        id::SHARDS,
        puzzles.len(),
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
    // Per band, because each has its own calendar and the shortest is the one that decides
    // when the game starts repeating itself.
    for band in 0..select::BANDS {
        let held = puzzles.iter().filter(|p| p.band == band).count();
        let (low, high) = band_pars(config, band);
        eprintln!(
            "  {:<6} par {low}-{high}: {held} puzzles, {} days by date, {} by link only",
            select::band_name(band),
            aligned_days[band],
            held.saturating_sub(aligned_days[band]),
        );
    }
    Ok(())
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

/// Delete shards, and the pair index, left over from an earlier version.
///
/// Every rebuild renames all 257 of them, so without this the directory grows by 28MB a
/// build and the old files ship. Only the names this function writes, at a *different*
/// version, are removed — nothing else in the directory is ever touched.
fn remove_stale_shards(dir: &Path, version: &str) -> Result<usize, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(0),
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.strip_suffix(".tsv") else {
            continue;
        };
        let Some((index, found)) = rest.split_once('-') else {
            continue;
        };
        // A shard, or the pair index, which is versioned the same way and would otherwise be
        // the one file that accumulated a copy per build.
        let versioned = !found.is_empty() && found.chars().all(|c| c.is_ascii_hexdigit());
        let ours = index == "pairs"
            || (index.len() == 2 && index.chars().all(|c| c.is_ascii_hexdigit()));
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

    write_puzzle_shards(data, config, &selection.puzzles, selection.aligned_days)?;

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
