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

fn main() {
    if let Err(message) = run() {
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

fn run() -> Result<(), String> {
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
                aligned_days: 0,
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
    let mut rows: Vec<(select::Rule, usize, usize)> = selection
        .rejections
        .alone
        .iter()
        .zip(selection.rejections.only.iter())
        .map(|((rule, refused), (_, sole))| (*rule, *refused, *sole))
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
    // The whole rule table, so a survey read weeks later still says which settings
    // produced it. `only` is what relaxing that one rule would let back in.
    out.push_str(&format!("refused by each rule, {}:\n", how_counted(config)));
    for (rule, refused, sole) in rule_rows(selection) {
        let (what, knob) = rule.describe();
        out.push_str(&format!("  {refused:>7} ({sole:>6})  {what}  [{knob}]\n"));
    }
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
/// * The daily board is day `N`, which `spread` has placed in shard `N % SHARDS`.
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
    aligned_days: usize,
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
                    "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
                    puzzle.id,
                    puzzle.day,
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
    // from, the shard arithmetic, and how long the calendar is. Without the length a day
    // past the end of the bank would fetch a shard and find nothing in it.
    let manifest = format!(
        "{{\"version\":\"{version}\",\"shards\":{},\"days\":{},\"puzzles\":{},\
         \"params\":{{\"slack\":{},\"minPar\":{},\"maxPar\":{}}}}}",
        id::SHARDS,
        aligned_days,
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
        "  calendar: {aligned_days} days reachable by date, {} more playable by link only",
        puzzles.len().saturating_sub(aligned_days),
    );
    Ok(())
}

/// Delete shards left over from an earlier version.
///
/// Every rebuild renames all 256 of them, so without this the directory grows by 25MB a
/// build and the old files ship. Only names matching the shard pattern at a *different*
/// version are removed, so nothing else in the directory is ever touched.
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
        let looks_like_a_shard = index.len() == 2
            && index.chars().all(|c| c.is_ascii_hexdigit())
            && !found.is_empty()
            && found.chars().all(|c| c.is_ascii_hexdigit());
        if looks_like_a_shard && found != version && std::fs::remove_file(entry.path()).is_ok() {
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
