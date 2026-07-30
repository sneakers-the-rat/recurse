//! The bank, cached between runs.
//!
//! Finding the puzzles and shipping them are separate jobs, and they cost wildly
//! different amounts. The search reads two graphs, enumerates 28 million candidate
//! pairs and judges every answer of every one: eight minutes. Ordering the calendar,
//! splitting the bank into shards and writing the survey are seconds of string
//! formatting over the result. Keeping them in one pass meant that changing the *shape
//! of a file* re-ran the whole search.
//!
//! So the search writes its result here and reads it back when nothing that determines
//! it has changed. What "determines it" means is the point: the digest below covers the
//! corpora, the graph shape and every rule knob, and deliberately excludes
//!
//! * `RECURSE_SEED` and `RECURSE_MIN_GAP`, which only order the calendar,
//!
//! so tuning either of those is instant. Change a rule and the digest moves, the cache
//! misses, and the search runs — which is the only time it should.
//!
//! Tab separated, one puzzle per line, because the values are ASCII words and numbers
//! and this is a cache rather than an interchange format. The alternative was a JSON
//! parser this crate does not otherwise need.

use std::path::{Path, PathBuf};

use crate::config::Config;
use crate::id::digest;
use crate::select::{self, Rejections, Rule, Selection};

/// Bumped when the file's layout changes, or when a rule does.
///
/// The layout half is obvious. The rules half is the trap: the digest below covers every
/// *knob*, so a rule with a hard-coded threshold — `MIN_BOARD`, `OFF_ROUTE_PER_MOVE`, the
/// halfway test, how much of an answer has to find a word inside a word — moves nothing in the
/// key, and a cached bank chosen by the old rules would be read straight back and shipped.
/// Adding or changing one of those means bumping this.
const FORMAT: u32 = 11;

/// Everything the search's result depends on, as one hex string.
///
/// The corpora are named by their SCOWL sizes rather than their contents: a tier is
/// downloaded once and never edited. The blocklist *is* hashed, because it is a file in
/// this repo that someone may add a word to.
pub fn key(config: &Config, blocklist: &[String], id_chars: usize) -> String {
    let mut message = format!(
        "v{FORMAT}|min_word={}|min_sub={}|legal={}|common={}|slack={}|min_par={}|max_par={}|\
         min_source_moves={}|min_internal={}|max_swaps={}|min_alt_nodes={}|id_chars={}|\
         alt_ways={}|alt_slack={}|min_divergence={}|around_percent={}|link_reach={}",
        config.min_word,
        config.min_sub,
        config.legal_scowl,
        config.common_scowl,
        config.slack,
        config.min_par,
        config.max_par,
        config.min_source_moves,
        config.min_internal,
        config.max_swaps,
        config.min_alt_nodes,
        id_chars,
        // The board is part of the cached bank, so what shapes it has to be part of the key.
        // Left out, tuning an alternative-route knob silently reused boards built by the old
        // one — the numbers moved and the data did not.
        config.max_alt_ways,
        config.alt_slack,
        config.min_divergence,
        config.around_percent,
        config.link_reach,
    );
    let mut blocked: Vec<&String> = blocklist.iter().collect();
    blocked.sort();
    for word in blocked {
        message.push('|');
        message.push_str(word);
    }
    digest(message.as_bytes(), 8)
}

pub fn path(cache: &Path, key: &str) -> PathBuf {
    cache.join(format!("bank-{key}.tsv"))
}

/// What the search found, without the calendar: `spread` runs on the way out every
/// time, because its knobs are not part of the key.
pub struct Bank {
    pub puzzles: Vec<crate::select::Puzzle>,
    pub rejections: Rejections,
    pub candidates: usize,
}

pub fn save(path: &Path, selection: &Selection) -> Result<(), String> {
    let mut out = String::with_capacity(selection.puzzles.len() * 128);
    // Header: the counts and the rule tallies, which the survey prints and which
    // cannot be recovered from the puzzles alone.
    out.push_str(&format!("candidates\t{}\n", selection.candidates));
    // One line per rule per par, because that is the grid the survey prints and none of it
    // can be recovered from the puzzles that survived.
    for rule in Rule::ALL {
        for par in 0..select::PAR_SLOTS {
            let refused = selection.rejections.alone[rule.slot()][par];
            let sole = selection.rejections.only[rule.slot()][par];
            if refused == 0 && sole == 0 {
                continue;
            }
            out.push_str(&format!("rule\t{}\t{par}\t{refused}\t{sole}\n", rule.slot()));
        }
    }
    for puzzle in &selection.puzzles {
        out.push_str(&format!(
            "p\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            puzzle.id,
            puzzle.source,
            puzzle.target,
            puzzle.par,
            puzzle.secret,
            puzzle.corridor_size,
            puzzle.alt_nodes,
            puzzle.shortest_paths,
            puzzle.max_rank,
            puzzle.routes.join("|"),
        ));
        out.push_str(&format!("b\t{}\n", puzzle.board));
    }
    crate::words::write_file(path, &out)
}

/// Read a cached bank. A file that does not parse is treated as absent rather than as
/// an error: a cache is never the reason a build cannot run.
pub fn load(path: &Path) -> Option<Bank> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut puzzles = Vec::new();
    let mut candidates = 0usize;
    let mut alone = select::empty_tally();
    let mut only = select::empty_tally();

    for line in text.lines() {
        let mut field = line.split('\t');
        match field.next()? {
            "candidates" => candidates = field.next()?.parse().ok()?,
            "rule" => {
                let slot: usize = field.next()?.parse().ok()?;
                if slot >= Rule::ALL.len() {
                    return None;
                }
                let par: usize = field.next()?.parse().ok()?;
                if par >= select::PAR_SLOTS {
                    return None;
                }
                alone[slot][par] = field.next()?.parse().ok()?;
                only[slot][par] = field.next()?.parse().ok()?;
            }
            "p" => {
                let id = field.next()?.to_string();
                let source = field.next()?.to_string();
                let target = field.next()?.to_string();
                let par = field.next()?.parse().ok()?;
                let secret = field.next()?.parse().ok()?;
                let corridor_size = field.next()?.parse().ok()?;
                let alt_nodes = field.next()?.parse().ok()?;
                let shortest_paths = field.next()?.parse().ok()?;
                let max_rank = field.next()?.parse().ok()?;
                let routes = field.next().unwrap_or("");
                puzzles.push(crate::select::Puzzle {
                    id,
                    // Assigned by `spread`, which runs on every build.
                    day: 0,
                    source,
                    target,
                    par,
                    secret,
                    corridor_size,
                    alt_nodes,
                    shortest_paths,
                    max_rank,
                    routes: if routes.is_empty() {
                        Vec::new()
                    } else {
                        routes.split('|').map(str::to_string).collect()
                    },
                    // Filled by the `b` line that follows.
                    board: String::new(),
                    // Derived from par by `schedule`, along with the day.
                    band: 0,
                });
            }
            // The board of the puzzle just read. Its own line because it holds spaces and
            // semicolons and would otherwise have to be escaped into the puzzle's row.
            "b" => {
                let board = field.next().unwrap_or("").to_string();
                puzzles.last_mut()?.board = board;
            }
            _ => return None,
        }
    }
    Some(Bank {
        puzzles,
        rejections: Rejections::from_tallies(&alone, &only),
        candidates,
    })
}
