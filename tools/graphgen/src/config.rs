//! Configuration, read from the repo's `.env`.
//!
//! The same file the rest of the project reads, so there is one place to change
//! a number. Values used are stamped into the emitted JSON, which is how the web
//! app learns them instead of duplicating the config.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct Config {
    pub min_word: usize,
    pub min_sub: usize,
    pub legal_scowl: u32,
    pub common_scowl: u32,
    pub slack: usize,
    /// Passed through to the client, not used here: what the board draws.
    pub draw_slack: usize,
    pub draw_max: usize,
    pub min_par: usize,
    pub max_par: usize,
    pub endpoint_pool: usize,
    pub min_source_moves: usize,
    pub min_internal: usize,
    pub max_swaps: usize,
    pub min_alt_nodes: usize,
    pub min_gap: usize,
    pub seed: u64,
    pub audit: Audit,
}

/// How thoroughly to attribute each refusal.
///
/// Ordinarily the rules run as a cascade and each candidate stops at its first
/// failure, so every cost lands on whichever rule runs earliest. Auditing judges
/// every rule against a candidate instead, which costs a legal-graph search each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audit {
    /// Cascade. What a plain build does.
    Off,
    /// Judge an evenly spread sample and scale the counts up. Seconds, and it
    /// answers the same question. `RECURSE_AUDIT=1`.
    Sampled,
    /// Judge one candidate in `n`; `Every(1)` is exact and takes minutes.
    /// `RECURSE_AUDIT=full`, or `RECURSE_AUDIT=<n>`.
    Every(usize),
}

impl Audit {
    fn parse(raw: Option<&str>) -> Audit {
        match raw {
            None | Some("0") | Some("false") | Some("") => Audit::Off,
            // `full` used to map to 1, which is the *sampled* mode — so the one
            // setting documented as exact was the one that could not be had.
            Some("full") => Audit::Every(1),
            Some("1") => Audit::Sampled,
            Some(n) => Audit::Every(n.parse::<usize>().unwrap_or(1).max(1)),
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

        let config = Config {
            min_word: num("RECURSE_MIN_WORD")?,
            min_sub: num("RECURSE_MIN_SUB")?,
            legal_scowl: num("RECURSE_LEGAL_SCOWL")? as u32,
            common_scowl: num("RECURSE_COMMON_SCOWL")? as u32,
            slack: num("RECURSE_SLACK")?,
            draw_slack: num("RECURSE_DRAW_SLACK")?,
            draw_max: num("RECURSE_DRAW_MAX")?,
            min_par: num("RECURSE_MIN_PAR")?,
            max_par: num("RECURSE_MAX_PAR")?,
            endpoint_pool: num("RECURSE_ENDPOINT_POOL")?,
            min_source_moves: num("RECURSE_MIN_SOURCE_MOVES")?,
            min_internal: num("RECURSE_MIN_INTERNAL")?,
            max_swaps: num("RECURSE_MAX_SWAPS")?,
            min_alt_nodes: num("RECURSE_MIN_ALT_NODES")?,
            min_gap: num("RECURSE_MIN_GAP")?,
            seed: num("RECURSE_SEED")? as u64,
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
        for (key, value) in [
            ("RECURSE_SLACK", config.slack),
            ("RECURSE_DRAW_SLACK", config.draw_slack),
        ] {
            if value % 2 != 0 {
                return Err(format!(
                    "{key} ({value}) should be even: parity means an odd value covers \
                     exactly what the even value below it covers"
                ));
            }
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
        assert_eq!(Audit::parse(Some("1")), Audit::Sampled);
        // The case that was broken: `full` has to mean every candidate.
        assert_eq!(Audit::parse(Some("full")), Audit::Every(1));
        assert_eq!(Audit::parse(Some("50")), Audit::Every(50));
        assert_eq!(Audit::parse(Some("nonsense")), Audit::Every(1));
    }
}
