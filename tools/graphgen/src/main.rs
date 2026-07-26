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
//!     graph.json       the edge list, as delta-encoded dictionary index pairs
//!     puzzles.json     the puzzle bank

mod config;
mod graph;
mod select;
mod word;
mod words;

use std::path::{Path, PathBuf};
use std::time::Instant;

use config::Config;
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

    eprintln!("config: {:?}", config);

    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

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

    // ------------------------------------------------------------ legal graph
    let phase = Instant::now();
    let legal_subs: FxSet<&str> = legal_words.iter().map(String::as_str).collect();
    let legal_nodes: Vec<String> = legal_words
        .iter()
        .filter(|w| w.len() >= config.min_word)
        .cloned()
        .collect();
    let legal = graph::build(
        legal_nodes,
        &legal_subs,
        config.min_word,
        config.min_sub,
        false,
        threads,
    );
    eprintln!(
        "legal graph:  {} edges over {} words in {:.1}s",
        legal.edges.len(),
        legal.adjacency.iter().filter(|a| !a.is_empty()).count(),
        phase.elapsed().as_secs_f64()
    );

    // ----------------------------------------------------------- common graph
    let phase = Instant::now();
    let common_subs: FxSet<&str> = common_words.iter().map(String::as_str).collect();
    let common_nodes: Vec<String> = common_words
        .iter()
        .filter(|w| w.len() >= config.min_word)
        .cloned()
        .collect();
    let common = graph::build(
        common_nodes,
        &common_subs,
        config.min_word,
        config.min_sub,
        false,
        threads,
    );
    eprintln!(
        "common graph: {} edges over {} words in {:.1}s",
        common.edges.len(),
        common.adjacency.iter().filter(|a| !a.is_empty()).count(),
        phase.elapsed().as_secs_f64()
    );

    // Quality is judged on the legal graph inside select(), because that is the
    // graph a player moves in — see solutions_are_interesting.

    // --------------------------------------------------------------- puzzles
    let phase = Instant::now();
    let selection = select::select(&common, &common_subs, &legal, &config, &rank);
    eprintln!(
        "puzzles: {} selected from {} candidates in {:.1}s",
        selection.puzzles.len(),
        selection.candidates,
        phase.elapsed().as_secs_f64()
    );
    report_rules(&selection, config.audit > 0);
    if selection.unplaceable > 0 {
        eprintln!("  {} could not be spaced apart", selection.unplaceable);
    }

    let mut by_par: FxMap<u32, usize> = FxMap::default();
    for puzzle in &selection.puzzles {
        *by_par.entry(puzzle.par).or_insert(0) += 1;
    }
    let mut pars: Vec<_> = by_par.into_iter().collect();
    pars.sort();
    eprintln!(
        "  by par: {}",
        pars.iter()
            .map(|(p, n)| format!("{p}:{n}"))
            .collect::<Vec<_>>()
            .join(" ")
    );
    for puzzle in selection.puzzles.iter().take(5) {
        eprintln!(
            "    {} -> {} par={} board={} alt={}",
            puzzle.source, puzzle.target, puzzle.par, puzzle.corridor_size, puzzle.alt_nodes
        );
    }

    // ----------------------------------------------------------------- output
    write_outputs(&data, &config, &legal, &legal_words, &common_words, &selection)?;
    write_survey(&root.join("tools").join("survey.txt"), &config, &selection)?;
    eprintln!("done in {:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}

/// What each rule cost, and which rules are actually doing the work.
///
/// `refused` is how many candidates the rule turned down. `only reason` is how
/// many it was the sole objection to — the number that matters when tuning, since
/// it is exactly what relaxing that one rule would let in. Without `RECURSE_AUDIT`
/// the rules run as a cascade and every candidate stops at its first failure, so
/// the two columns are the same and both are attributed to whichever rule ran
/// earliest. With it, each rule is judged against every candidate.
fn report_rules(selection: &select::Selection, audited: bool) {
    let mut rows: Vec<(select::Rule, usize, usize)> = selection
        .rejections
        .alone
        .iter()
        .zip(selection.rejections.only.iter())
        .map(|((rule, refused), (_, sole))| (*rule, *refused, *sole))
        .filter(|(_, refused, _)| *refused > 0)
        .collect();
    rows.sort_by_key(|(_, refused, _)| std::cmp::Reverse(*refused));

    eprintln!(
        "  rules ({}):",
        if audited { "audited independently" } else { "cascade — first failure only" }
    );
    eprintln!("    {:>9}  {:>9}   {:<48} {}", "refused", "only reason", "rule", "knob");
    for (rule, refused, sole) in rows {
        let (what, knob) = rule.describe();
        eprintln!("    {refused:>9}  {sole:>11}   {what:<48} {knob}");
    }

}

/// The bank in calendar order, with the answers the filters let through.
///
/// Judging taste means reading the actual puzzles, and stepping a thousand of them
/// through dev mode one at a time is not reading. This is the instrument for that:
/// change a filter, rebuild, diff the survey, see exactly which puzzles the change
/// let in or threw out. `№` is the `?puzzle=` index, so anything suspicious can be
/// opened and played.
fn write_survey(
    path: &Path,
    config: &Config,
    selection: &select::Selection,
) -> Result<(), String> {
    let mut out = String::with_capacity(selection.puzzles.len() * 120);
    out.push_str(&format!(
        "{} puzzles, seed {}, par {}-{}, SCOWL {} legal over {} common\n",
        selection.puzzles.len(),
        config.seed,
        config.min_par,
        config.max_par,
        config.legal_scowl,
        config.common_scowl,
    ));
    // The whole rule table, so a survey read weeks later still says which settings
    // produced it. `only` is what relaxing that one rule would let back in.
    out.push_str("refused by each rule (only reason it was refused, in brackets):\n");
    let mut rows: Vec<(select::Rule, usize, usize)> = selection
        .rejections
        .alone
        .iter()
        .zip(selection.rejections.only.iter())
        .map(|((rule, refused), (_, sole))| (*rule, *refused, *sole))
        .filter(|(_, refused, _)| *refused > 0)
        .collect();
    rows.sort_by_key(|(_, refused, _)| std::cmp::Reverse(*refused));
    for (rule, refused, sole) in rows {
        let (what, knob) = rule.describe();
        out.push_str(&format!("  {refused:>7} ({sole:>6})  {what}  [{knob}]\n"));
    }
    out.push('\n');

    for (i, puzzle) in selection.puzzles.iter().enumerate() {
        out.push_str(&format!(
            "№{:<5} {} → {}   par {}{}  routes {}  board {}  rank {}\n",
            i,
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

fn write_outputs(
    data: &Path,
    config: &Config,
    legal: &graph::Graph,
    legal_words: &[String],
    common_words: &[String],
    selection: &select::Selection,
) -> Result<(), String> {
    // The dictionary does double duty: the set of legal guesses, and the
    // canonical index the edge list refers to. One sorted list, so the graph
    // never repeats a word.
    let mut dictionary = String::from("{\"words\":\"");
    for (i, word) in legal_words.iter().enumerate() {
        if i > 0 {
            dictionary.push_str("\\n");
        }
        dictionary.push_str(word);
    }
    dictionary.push_str("\"}");
    words::write_file(&data.join("dictionary.json"), &dictionary)?;

    // Edges carry only the two words: the subword and its position are
    // recoverable from the pair plus the dictionary, and deriving the handful
    // actually displayed beats shipping hundreds of thousands of them.
    let index: FxMap<&str, u32> = legal_words
        .iter()
        .enumerate()
        .map(|(i, w)| (w.as_str(), i as u32))
        .collect();
    let mut pairs: Vec<(u32, u32)> = legal
        .edges
        .iter()
        .filter_map(|e| {
            Some((
                *index.get(legal.word(e.big))?,
                *index.get(legal.word(e.small))?,
            ))
        })
        .collect();
    pairs.sort_unstable();
    pairs.dedup();

    let mut graph_json = String::with_capacity(pairs.len() * 12 + 512);
    graph_json.push_str("{\"params\":{");
    graph_json.push_str(&format!("\"commonScowl\":{},", config.common_scowl));
    graph_json.push_str(&format!("\"legalScowl\":{},", config.legal_scowl));
    graph_json.push_str(&format!("\"minWord\":{},", config.min_word));
    graph_json.push_str(&format!("\"minSub\":{},", config.min_sub));
    graph_json.push_str("\"internalOnly\":false},\"edges\":[");
    // First element delta-encoded: sorted deltas are small repeated integers,
    // which gzip handles far better than absolute indices.
    let mut previous = 0i64;
    for (i, (big, small)) in pairs.iter().enumerate() {
        if i > 0 {
            graph_json.push(',');
        }
        graph_json.push_str(&(*big as i64 - previous).to_string());
        graph_json.push(',');
        graph_json.push_str(&small.to_string());
        previous = *big as i64;
    }
    graph_json.push_str("]}");
    words::write_file(&data.join("graph.json"), &graph_json)?;

    let mut puzzles_json = String::with_capacity(selection.puzzles.len() * 96 + 256);
    puzzles_json.push_str(&format!(
        "{{\"params\":{{\"slack\":{},\"drawSlack\":{},\"drawMax\":{},\
         \"minPar\":{},\"maxPar\":{}}},\"puzzles\":[",
        config.slack, config.draw_slack, config.draw_max, config.min_par, config.max_par
    ));
    for (i, puzzle) in selection.puzzles.iter().enumerate() {
        if i > 0 {
            puzzles_json.push(',');
        }
        puzzles_json.push_str(&format!(
            "{{\"source\":\"{}\",\"target\":\"{}\",\"par\":{},\"secret\":{},\
             \"corridorSize\":{},\"altNodes\":{},\"shortestPaths\":{},\"maxRank\":{}}}",
            puzzle.source,
            puzzle.target,
            puzzle.par,
            puzzle.secret,
            puzzle.corridor_size,
            puzzle.alt_nodes,
            puzzle.shortest_paths,
            puzzle.max_rank
        ));
    }
    puzzles_json.push_str("]}");
    words::write_file(&data.join("puzzles.json"), &puzzles_json)?;

    // Which dictionary words are ordinary ones. The client draws the board from
    // these and no others: the whole 189k list is what a player may *guess*, but a
    // board built from it shows routes through words nobody knows, and a gilt
    // "best route" that is not the answer the puzzle advertises. Delta-encoded
    // indices into the dictionary, which gzip handles far better than the words.
    let mut common_ids: Vec<u32> = common_words
        .iter()
        .filter_map(|w| index.get(w.as_str()).copied())
        .collect();
    common_ids.sort_unstable();
    let mut common_json = String::with_capacity(common_ids.len() * 5 + 32);
    common_json.push_str("{\"common\":[");
    let mut previous = 0i64;
    for (i, &id) in common_ids.iter().enumerate() {
        if i > 0 {
            common_json.push(',');
        }
        common_json.push_str(&(id as i64 - previous).to_string());
        previous = id as i64;
    }
    common_json.push_str("]}");
    words::write_file(&data.join("common.json"), &common_json)?;

    for name in ["dictionary.json", "graph.json", "puzzles.json", "common.json"] {
        let path = data.join(name);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        eprintln!("  wrote {name} ({} KB)", size / 1024);
    }
    Ok(())
}
