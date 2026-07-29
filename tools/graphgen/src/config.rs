//! Configuration, read from the repo's `.env`.
//!
//! The same file the rest of the project reads, so there is one place to change
//! a number. Values used are stamped into the emitted JSON, which is how the web
//! app learns them instead of duplicating the config.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::id;

#[derive(Debug, Clone)]
pub struct Config {
    pub min_word: usize,
    pub min_sub: usize,
    pub legal_scowl: u32,
    pub common_scowl: u32,
    pub slack: usize,
    pub min_par: usize,
    /// Longest answer the builder looks for. A ceiling on the search, not a filter
    /// on taste: par is recorded and reported, and every par in range ships.
    pub max_par: usize,
    pub min_source_moves: usize,
    /// How many longer ways through a puzzle declares, beyond the shortest ones. See board.rs.
    pub max_alt_ways: usize,
    /// How many moves past par one of those may take.
    pub alt_slack: usize,
    /// Consecutive words an alternative must spend away from everything already declared
    /// before it counts as another way round rather than a bulge. See board.rs.
    pub min_divergence: usize,
    /// How much surrounding graph is declared, as a percentage of the words on a way through.
    pub around_percent: usize,
    /// How long a chain running between two of the ways through may be. See board_words.
    pub link_reach: usize,
    pub min_internal: usize,
    pub max_swaps: usize,
    pub min_alt_nodes: usize,
    pub min_gap: usize,
    /// Where the three lengths divide: the last par of the short band, then of the medium
    /// one. Long is everything above. See `band_of`.
    pub band_cuts: (u32, u32),
    pub seed: u64,
    /// Hex digits of a puzzle's digest that make up its public id. See id.rs.
    pub id_chars: usize,
    pub audit: Audit,
}

/// How each refusal is attributed. Both settings report exact counts over every
/// candidate; nothing is ever sampled or estimated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audit {
    /// Cascade: each candidate stops at its first failure, so a rule's tally is the
    /// candidates that reached it and failed. Cheap, and what a plain build does.
    Off,
    /// Judge every rule against every candidate, so a rule's tally is exactly the
    /// candidates that break it. Costs a legal-graph search and a full walk of the
    /// answers per candidate. `RECURSE_AUDIT=1`.
    On,
}

impl Audit {
    fn parse(raw: Option<&str>) -> Audit {
        match raw {
            None | Some("0") | Some("false") | Some("") => Audit::Off,
            _ => Audit::On,
        }
    }
}

fn parse_env(text: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let value = value.split('#').next().unwrap_or("").trim();
            map.insert(key.trim().to_string(), value.to_string());
        }
    }
    map
}

impl Config {
    pub fn load(root: &Path) -> Result<Config, String> {
        let path = root.join(".env");
        let text = fs::read_to_string(&path)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        let env = parse_env(&text);

        // Environment variables win, so a one-off run can override without
        // editing the file: RECURSE_MIN_SUB=3 cargo run --release
        let get = |key: &str| -> Result<String, String> {
            if let Ok(value) = std::env::var(key) {
                return Ok(value);
            }
            env.get(key)
                .cloned()
                .ok_or_else(|| format!("{key} is missing from .env"))
        };
        let num = |key: &str| -> Result<usize, String> {
            let raw = get(key)?;
            raw.parse::<usize>()
                .map_err(|_| format!("{key} should be a number, got {raw:?}"))
        };
        /// Two numbers separated by a comma, which is how a pair of cuts reads in a file
        /// of single values.
        let pair = |key: &str| -> Result<(u32, u32), String> {
            let raw = get(key)?;
            let mut parts = raw.split(',').map(str::trim);
            let bad = || format!("{key} should be two numbers separated by a comma, got {raw:?}");
            let first: u32 = parts.next().ok_or_else(bad)?.parse().map_err(|_| bad())?;
            let second: u32 = parts.next().ok_or_else(bad)?.parse().map_err(|_| bad())?;
            if parts.next().is_some() {
                return Err(bad());
            }
            Ok((first, second))
        };

        let config = Config {
            min_word: num("RECURSE_MIN_WORD")?,
            min_sub: num("RECURSE_MIN_SUB")?,
            legal_scowl: num("RECURSE_LEGAL_SCOWL")? as u32,
            common_scowl: num("RECURSE_COMMON_SCOWL")? as u32,
            slack: num("RECURSE_SLACK")?,
            min_par: num("RECURSE_MIN_PAR")?,
            max_par: num("RECURSE_MAX_PAR")?,
            min_source_moves: num("RECURSE_MIN_SOURCE_MOVES")?,
            max_alt_ways: num("RECURSE_ALT_WAYS")?,
            alt_slack: num("RECURSE_ALT_SLACK")?,
            min_divergence: num("RECURSE_MIN_DIVERGENCE")?,
            around_percent: num("RECURSE_AROUND_PERCENT")?,
            link_reach: num("RECURSE_LINK_REACH")?,
            min_internal: num("RECURSE_MIN_INTERNAL")?,
            max_swaps: num("RECURSE_MAX_SWAPS")?,
            min_alt_nodes: num("RECURSE_MIN_ALT_NODES")?,
            min_gap: num("RECURSE_MIN_GAP")?,
            band_cuts: pair("RECURSE_BAND_CUTS")?,
            seed: num("RECURSE_SEED")? as u64,
            id_chars: num("RECURSE_ID_CHARS")?,
            // Not in .env: a way of looking at the bank, not a property of it.
            audit: Audit::parse(std::env::var("RECURSE_AUDIT").ok().as_deref()),
        };

        if config.min_sub < 1 {
            return Err("RECURSE_MIN_SUB must be at least 1".into());
        }
        if config.min_word <= config.min_sub {
            return Err(format!(
                "RECURSE_MIN_WORD ({}) must exceed RECURSE_MIN_SUB ({}), or every \
                 word would be its own subword",
                config.min_word, config.min_sub
            ));
        }
        if config.min_par > config.max_par {
            return Err("RECURSE_MIN_PAR must not exceed RECURSE_MAX_PAR".into());
        }
        // Three bands means two cuts, and each one has to have something in it: a cut at or
        // below the shortest par, or at or above the longest, leaves a band the game offers
        // and the bank cannot fill.
        let (short, medium) = config.band_cuts;
        if (short as usize) < config.min_par
            || short >= medium
            || (medium as usize) >= config.max_par
        {
            return Err(format!(
                "RECURSE_BAND_CUTS ({short},{medium}) has to leave three non-empty bands \
                 inside par {}-{}: the first cut at or above MIN_PAR, the second above it, \
                 and MAX_PAR above that",
                config.min_par, config.max_par
            ));
        }
        // A hex digit is half a byte and a digest is a whole number of them, so the
        // length comes in pairs. Four digits is 65,536 addresses, which a bank of a
        // few thousand puzzles cannot fill without colliding; 64 is BLAKE2s' most.
        if config.id_chars % 2 != 0 || !(4..=id::MAX_CHARS).contains(&config.id_chars) {
            return Err(format!(
                "RECURSE_ID_CHARS ({}) should be an even number between 4 and {} — a \
                 puzzle's id is a digest of that many hex digits",
                config.id_chars,
                id::MAX_CHARS
            ));
        }
        // Parity: an odd slack covers exactly what the even value below it covers.
        if config.slack % 2 != 0 {
            return Err(format!(
                "RECURSE_SLACK ({}) should be even: parity means an odd value covers \
                 exactly what the even value below it covers",
                config.slack
            ));
        }
        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::Audit;

    #[test]
    fn reads_every_audit_setting() {
        assert_eq!(Audit::parse(None), Audit::Off);
        assert_eq!(Audit::parse(Some("0")), Audit::Off);
        assert_eq!(Audit::parse(Some("false")), Audit::Off);
        assert_eq!(Audit::parse(Some("")), Audit::Off);
        // Anything else means judge every rule against every candidate. There is no
        // sampled setting: a reported tally is always a count.
        assert_eq!(Audit::parse(Some("1")), Audit::On);
        assert_eq!(Audit::parse(Some("full")), Audit::On);
        assert_eq!(Audit::parse(Some("nonsense")), Audit::On);
    }
}
