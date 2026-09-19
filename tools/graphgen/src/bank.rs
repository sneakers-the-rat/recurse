//! The bank, cached between runs.
//!
//! Finding the puzzles and shipping them are separate jobs, and they cost wildly
//! different amounts. The search reads two graphs, enumerates 28 million candidate
//! pairs and judges every answer of every one: eight minutes. Ordering the calendar,
//! splitting the bank into shards costs seconds of string
//! formatting over the result. Keeping them in one pass meant that changing the *shape
//! of a file* re-ran the whole search.
//!
//! So the search writes its result here and reads it back when nothing that determines
//! it has changed. What "determines it" means is the point: the digest below covers the
//! corpora, the graph shape and every rule knob, and deliberately excludes
//!
//! * `seed` and `minGap`, which only order the calendar, and
//! * `bandCuts`, which only labels what was found — `build_mode` re-bands a bank it reads
//!   back, so a cut can be moved and the whole calendar rewritten in seconds.
//!
//! so tuning any of those is instant. Change a rule and the digest moves, the cache
//! misses, and the search runs — which is the only time it should.
//!
//! Tab separated, one puzzle per line, because the values are ASCII words and numbers
//! and this is a cache rather than an interchange format. The alternative was a JSON
//! parser this crate does not otherwise need.

use std::path::{Path, PathBuf};

use crate::config::Mode;
use crate::id::digest;
use crate::select::{self, Rejections, Rule, Selection};

/// Bumped when the file's layout changes, or when a rule does.
///
/// The layout half is obvious. The rules half is the trap: the digest below covers every
/// *knob*, so a rule with a hard-coded threshold — `MIN_BOARD`, `OFF_ROUTE_PER_MOVE`, the
/// halfway test, how much of an answer has to find a word inside a word — moves nothing in the
/// key, and a cached bank chosen by the old rules would be read straight back and shipped.
/// Adding or changing one of those means bumping this.
const FORMAT: u32 = 13;

/// Everything one mode's search depends on, as one hex string.
///
/// The corpora are named by their SCOWL sizes rather than their contents: a tier is
/// downloaded once and never edited. The blocklist *is* hashed, because it is a file in
/// this repo that someone may add a word to.
///
/// **`vocab` is in it because the puzzle ids are.** An id is a digest of the game, the
/// pair and the vocabulary (see id.rs), so a cached bank is only good for the vocabulary
/// its ids were computed against — and the vocabulary digest is the one thing here that
/// is taken over the corpus *contents* rather than its name.
///
/// **Per mode, and the alphabet is in it.** Each mode searches its own graph and caches
/// its own bank, so the key has to separate them — two modes with identical knobs and
/// different alphabets are two entirely different banks, and sharing a cache file between
/// them would serve one game's puzzles to the other.
pub fn key(mode: &Mode, blocklist: &[String], id_chars: usize, vocab: &str) -> String {
    let mut message = format!(
        "v{FORMAT}|vocab={vocab}|mode={}|alphabet={}|min_word={}|min_sub={}|legal={}|common={}|slack={}|\
         min_par={}|max_par={}|min_source_moves={}|min_internal={}|max_swaps={}|\
         min_alt_nodes={}|id_chars={}|alt_ways={}|alt_slack={}|min_divergence={}|\
         around_percent={}|link_reach={}",
        mode.name,
        mode.alphabet.name(),
        mode.min_word,
        mode.min_sub,
        mode.legal_scowl,
        mode.common_scowl,
        mode.slack,
        mode.min_par,
        mode.max_par,
        mode.min_source_moves,
        mode.min_internal,
        mode.max_swaps,
        mode.min_alt_nodes,
        id_chars,
        // The board is part of the cached bank, so what shapes it has to be part of the key.
        // Left out, tuning an alternative-route knob silently reused boards built by the old
        // one — the numbers moved and the data did not.
        mode.max_alt_ways,
        mode.alt_slack,
        mode.min_divergence,
        mode.around_percent,
        mode.link_reach,
    );
    // The ban lists are rules, so they belong in the key for the same reason every other
    // knob does. They live in the config file rather than in this source, so a build that
    // reused a bank chosen by yesterday's list would be the `FORMAT` trap with no bump to
    // catch it.
    for word in &mode.too_frequent {
        message.push_str("|freq=");
        message.push_str(word);
    }
    for set in &mode.too_frequent_clusters {
        message.push_str("|cluster=");
        message.push_str(&set.join(","));
    }
    // **The alphabet's own definition**, for a mode that has one. Splitting a phoneme in two
    // changes every token in the corpus and so every puzzle in the bank, while moving no knob
    // at all — exactly the `FORMAT` trap, and one that a bump cannot catch because the table
    // is not a rule. Hashed in, so editing `PHONEMES` invalidates the cache by itself.
    if mode.alphabet == crate::config::Alphabet::Phonemes {
        for phoneme in &crate::phonetic::PHONEMES {
            message.push_str("|ph=");
            message.push_str(phoneme.arpabet);
            message.push(phoneme.code);
            if let Some((code, _)) = phoneme.stressed {
                message.push(code);
            }
        }
    }
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

/// What the search found, without the calendar: `calendar::deal` runs on the way out every
/// time, because its knobs are not part of the key.
pub struct Bank {
    pub puzzles: Vec<crate::select::Puzzle>,
    pub rejections: Rejections,
    pub candidates: usize,
}

pub fn save(path: &Path, selection: &Selection) -> Result<(), String> {
    let mut out = String::with_capacity(selection.puzzles.len() * 128);
    // Header: the counts and the rule tallies, which the report prints and which
    // cannot be recovered from the puzzles alone.
    out.push_str(&format!("candidates\t{}\n", selection.candidates));
    // One line per rule per par, because that is the grid the report prints and none of it
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
            // Which band, which is decided where the puzzle is built rather than by
            // `schedule` — so unlike the day it survives the cache. Written for
            // readability rather than because it is trusted: `build_mode` recomputes it
            // from `par` on the way back in, since `bandCuts` is not in the key above.
            puzzle.band,
            puzzle.source,
            puzzle.target,
            puzzle.par,
            puzzle.secret,
            puzzle.corridor_size,
            puzzle.alt_nodes,
            puzzle.shortest_paths,
            puzzle.max_rank,
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
                let band = field.next()?.parse().ok()?;
                let source = field.next()?.to_string();
                let target = field.next()?.to_string();
                let par = field.next()?.parse().ok()?;
                let secret = field.next()?.parse().ok()?;
                let corridor_size = field.next()?.parse().ok()?;
                let alt_nodes = field.next()?.parse().ok()?;
                let shortest_paths = field.next()?.parse().ok()?;
                let max_rank = field.next()?.parse().ok()?;
                puzzles.push(crate::select::Puzzle {
                    id,
                    // Assigned by `calendar::deal`, which runs on every build.
                    day: 0,
                    source,
                    target,
                    par,
                    secret,
                    corridor_size,
                    alt_nodes,
                    shortest_paths,
                    max_rank,
                    // Filled by the `b` line that follows.
                    board: String::new(),
                    band,
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

#[cfg(test)]
mod tests {
    use crate::config::Config;

    /// Enough of a file to load, differing only in the knob under test.
    fn mode(extra: &str) -> crate::config::Mode {
        Config::parse(&format!(
            "shared:\n  epoch: 2025-01-01\n  seed: 1\n  idChars: 12\n  minGap: 45\n\
             defaults:\n  alphabet: letters\n  minWord: 4\n  minSub: 2\n  legalScowl: 80\n  \
             commonScowl: 35\n  slack: 6\n  minPar: 3\n  maxPar: 10\n  minSourceMoves: 2\n  \
             altWays: 4\n  altSlack: 4\n  minDivergence: 2\n  aroundPercent: 45\n  \
             linkReach: 3\n  minInternal: 1\n  maxSwaps: 0\n  minAltNodes: 4\n  \
             minComponent: 3\n\
             modes:\n  - name: letters\n    bands: [short, medium, long]\n    \
             bandCuts: [4, 6]\n{extra}"
        ))
        .expect("loads")
        .modes
        .remove(0)
    }

    /**
        The bank's key covers the knobs that decide **which puzzles exist**, and nothing else.

        `minComponent` decides which words the explore mode draws a map of. It refuses no
        candidate, moves no endpoint and changes no board — so putting it in the key would cost
        a quarter of an hour of searching to arrive at exactly the bank that was already
        cached, every time somebody tuned the map. That is the failure this guards: it is
        silent, and the only sign of it is a build that suddenly takes fifteen minutes.

        The other direction is guarded by every other line of `key`: a knob that *does* decide
        which puzzles exist and is left out means a stale bank chosen by the old rules is read
        straight back. See the note on `FORMAT`.
    */
    #[test]
    fn the_key_ignores_a_knob_that_decides_no_puzzle() {
        let three = mode("    minComponent: 3\n");
        let nine = mode("    minComponent: 9\n");
        assert_eq!(three.min_component, 3);
        assert_eq!(nine.min_component, 9);
        assert_eq!(
            super::key(&three, &[], 12, "abcd1234"),
            super::key(&nine, &[], 12, "abcd1234"),
            "minComponent decides the map and not the bank, so it must not invalidate one"
        );
    }

    /// And the ones that *do* decide a puzzle still move it, so the guard above is not vacuous.
    #[test]
    fn the_key_moves_with_a_knob_that_does() {
        let one = mode("");
        let other = mode("    minInternal: 2\n");
        assert_ne!(super::key(&one, &[], 12, "abcd1234"), super::key(&other, &[], 12, "abcd1234"));
    }
}
