//! Configuration, read from the repo's `recurse.yaml`.
//!
//! The same file the rest of the project reads, so there is one place to change a
//! number. Values used are stamped into the emitted JSON, which is how the web app
//! learns them instead of duplicating the config.
//!
//! **Three levels, and the middle one is the point.** `Shared` is what cannot differ
//! between modes without breaking addressing or the calendar — the epoch, the seed, the
//! id length. `Mode` is every knob a game has. The file's `defaults` block sets all of
//! them once and each mode overrides what it wants, so adding a variant is a few lines
//! rather than a copy of the whole list.
//!
//! This was a flat `.env` of `RECURSE_*` numbers, which is exactly the shape that stops
//! working the moment there are two games in one bank: every knob needs a per-mode
//! answer and a flat file can only give it one. Environment overrides survive the move,
//! because they are the taste loop — see `Overrides`.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use yaml_rust2::{Yaml, YamlLoader};

use crate::id;

/// The config file's name, which is also how the repo root is found.
pub const FILE: &str = "recurse.yaml";

/// Which alphabet a mode's graph is built over.
///
/// The whole pipeline is byte-wise substring surgery over short ASCII strings, and it
/// does not care what the bytes mean — so this decides only how the corpus is turned
/// into strings, and nothing downstream of that. See phonetic.rs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Alphabet {
    /// A word is its spelling.
    Letters,
    /// A word is its pronunciation, one character per phoneme.
    Phonemes,
}

impl Alphabet {
    fn parse(raw: &str) -> Result<Alphabet, String> {
        match raw {
            "letters" => Ok(Alphabet::Letters),
            "phonemes" => Ok(Alphabet::Phonemes),
            other => Err(format!(
                "alphabet should be `letters` or `phonemes`, got {other:?}"
            )),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Alphabet::Letters => "letters",
            Alphabet::Phonemes => "phonemes",
        }
    }
}

/// What every mode in one bank has to agree about.
///
/// Not "settings that happen to be the same" — settings that *cannot* differ. Every
/// mode's puzzles share one id space, one set of shards and one calendar, so the id
/// length and the epoch are properties of the bank rather than of a game.
#[derive(Debug, Clone)]
pub struct Shared {
    /// Day one of the calendar. Only the calendar depends on it, so it is deliberately
    /// not part of the bank cache key — moving it re-dates every puzzle without
    /// re-searching anything.
    pub epoch: crate::date::Date,
    pub seed: u64,
    /// Hex digits of a puzzle's digest that make up its public id. See id.rs.
    pub id_chars: usize,
    pub min_gap: usize,
    /// What each downloaded corpus should be, by its cache file name.
    ///
    /// **A tripwire, and the outermost one there is.** Every list the build reads comes from
    /// an address that serves whatever is current — see the header of words.rs — so a fresh
    /// machine can quietly build against a different corpus from the one every shipped board
    /// was found in. `vocab:` would catch the ones that reach the word list, a mode at a time
    /// and without saying which file moved; this catches all of them, including the frequency
    /// list, which decides which end of a pair is the source without being in any vocabulary.
    ///
    /// Shared rather than per mode because a file is a file: two modes asking for the same
    /// SCOWL tier are reading one download, and pinning it twice would be two places to
    /// disagree. A name that no run reads is simply not checked.
    pub sources: BTreeMap<String, String>,
}

/// One game: an alphabet, the bands it offers, and every knob that shapes its bank.
#[derive(Debug, Clone)]
pub struct Mode {
    /// What this game is called. Appears in the manifest and the cache key,
    /// and is the prefix of its environment overrides.
    pub name: String,
    pub alphabet: Alphabet,
    /// The lengths this mode offers, in order. One name per band.
    pub bands: Vec<String>,
    /// Where the bands divide: the last par of each band but the final one, which takes
    /// everything above. Always one shorter than `bands`, so a single-band mode has none.
    pub band_cuts: Vec<u32>,
    /// Where this mode's bands start in the manifest's flattened band list. A band is
    /// addressed by that global index everywhere outside this struct.
    pub band_base: usize,
    /// Copied from `Shared`, because every function that builds a puzzle needs it and
    /// none of them otherwise needs the shared block. It is genuinely shared — a mode
    /// cannot set it — and `Config::parse` is the only writer.
    pub id_chars: usize,

    pub min_word: usize,
    pub min_sub: usize,
    pub legal_scowl: u32,
    pub common_scowl: u32,
    pub slack: usize,
    pub min_par: usize,
    /// Longest answer the builder looks for. A ceiling on the search, not a filter on
    /// taste: par is recorded and reported, and every par in range ships.
    pub max_par: usize,
    pub min_source_moves: usize,
    /// How many longer ways through a puzzle declares, beyond the shortest ones.
    pub max_alt_ways: usize,
    /// How many moves past par one of those may take.
    pub alt_slack: usize,
    /// Consecutive words an alternative must spend away from everything already declared
    /// before it counts as another way round rather than a bulge.
    pub min_divergence: usize,
    /// How much surrounding graph is declared, as a percentage of the words on a way through.
    pub around_percent: usize,
    /// How long a chain running between two of the ways through may be.
    pub link_reach: usize,
    pub min_internal: usize,
    pub max_swaps: usize,
    pub min_alt_nodes: usize,
    /// Words banned from an answer for being overexposed. Per mode, because exposure is a
    /// property of one graph: a hub of the spelling graph means nothing to the sound one.
    pub too_frequent: Vec<String>,
    /// Sets of words banned only in combination. See `ContainsTooFrequentCluster` in select.rs.
    pub too_frequent_clusters: Vec<Vec<String>>,
    /// The vocabulary digest this mode expects to have, or none to accept whatever it has.
    ///
    /// **A tripwire, not a knob.** Every puzzle id is a digest of the game, its pair and its
    /// vocabulary, so a change to the word list or to `minWord`/`minSub` renames every board
    /// in the mode and invalidates every shared board code written against the old ones.
    /// Declaring the digest here means the build stops and says so instead. See `build_mode`,
    /// which computes it and compares, and `id::vocab_spec` for what goes into it.
    pub vocab: Option<String>,
    /// Vocabularies whose *addresses* still need forwarding, oldest first.
    ///
    /// **A migration, and it is meant to be deleted.** A puzzle's id used to be a digest of its
    /// vocabulary, so curating the word list renamed every board in the game and every link
    /// anybody had sent stopped resolving. It is not built that way any more — see id.rs — so
    /// nothing after that change needs forwarding, and what is left here is the one generation
    /// of links that was sent while it was.
    ///
    /// The builder knows every puzzle's pair, so for each of these it computes what that board
    /// was called then and writes the redirect out; the client follows it on a miss. See
    /// `redirect_bodies` in main.rs. Empty the list and the whole `puzzles/was/` directory
    /// goes with it, which is the right thing to do once nobody is holding a link that old.
    ///
    /// A digest here is one this mode has really had, and there is nothing left to check it
    /// against. The one mistake it can make is being the *current* vocabulary, which is a
    /// paste into the wrong line and which `build_mode` refuses.
    pub was_vocab: Vec<String>,
}

impl Mode {
    /// Which of this mode's bands a par belongs to, counting from zero within the mode.
    ///
    /// The cuts are the last par of each band but the last, which takes everything above.
    /// A mode with one band always answers zero.
    pub fn band_of(&self, par: u32) -> usize {
        self.band_cuts.iter().take_while(|&&cut| par > cut).count()
    }

    /// Where this band sits in the manifest's flattened list.
    pub fn global_band(&self, local: usize) -> usize {
        self.band_base + local
    }

    /// The pars one of this mode's bands holds, inclusive at both ends.
    pub fn band_pars(&self, local: usize) -> (usize, usize) {
        let low = match local.checked_sub(1).and_then(|i| self.band_cuts.get(i)) {
            Some(&cut) => cut as usize + 1,
            None => self.min_par,
        };
        let high = match self.band_cuts.get(local) {
            Some(&cut) => cut as usize,
            None => self.max_par,
        };
        (low, high)
    }

    /// What this band is *called*, which is a label and not an identity: two modes both
    /// offer a band called "short", and they are different games.
    pub fn band_name(&self, local: usize) -> &str {
        self.bands.get(local).map(String::as_str).unwrap_or("?")
    }

    /// What this band *is*: the mode's name and the band's, joined.
    ///
    /// **A band is one flat game variant, and this is its name.** `letters-long` and
    /// `phonemes-long` are two different games that happen to share a label, so anything
    /// storing, keying or comparing a band uses this rather than `band_name` — the client
    /// keys a saved game and a stats record on it. Grouping the two games' bands under
    /// their mode is something the masthead menu does when it draws them, and nothing else
    /// in either codebase knows about it.
    ///
    /// It is not what a band is *addressed* by inside the bank: that is still the global
    /// index, because a band index is a position in a calendar year's run of ids and has to
    /// stay an integer. This is the name that survives the list being reordered.
    pub fn band_id(&self, local: usize) -> String {
        format!("{}-{}", self.name, self.band_name(local))
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    pub shared: Shared,
    pub modes: Vec<Mode>,
    pub audit: Audit,
}

impl Config {
    /// Every band in every mode, flattened, as the manifest lists them.
    pub fn bands(&self) -> Vec<(&Mode, usize)> {
        self.modes
            .iter()
            .flat_map(|mode| (0..mode.bands.len()).map(move |local| (mode, local)))
            .collect()
    }

    /// How many bands the calendar has to write a run for.
    pub fn band_count(&self) -> usize {
        self.modes.iter().map(|mode| mode.bands.len()).sum()
    }
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

/// The environment variable a key answers to.
///
/// `minSub` becomes `RECURSE_MIN_SUB`, and `RECURSE_PHONEMES_MIN_SUB` for one mode. The
/// taste loop runs on these — `RECURSE_MAX_SWAPS=1 npm run data` — so they had to survive
/// the move out of a file that was nothing but environment variables.
fn env_name(mode: Option<&str>, key: &str) -> String {
    let mut out = String::from("RECURSE_");
    if let Some(mode) = mode {
        out.push_str(&mode.to_ascii_uppercase());
        out.push('_');
    }
    for (i, ch) in key.chars().enumerate() {
        if ch.is_ascii_uppercase() && i > 0 {
            out.push('_');
        }
        out.push(ch.to_ascii_uppercase());
    }
    out
}

/// Where one key's value comes from, most specific first.
///
/// A mode's own entry beats `defaults`, and an environment variable beats both — the
/// mode-scoped one first, so `RECURSE_PHONEMES_MIN_SUB=1` moves one game and
/// `RECURSE_MIN_SUB=1` moves all of them.
struct Lookup<'a> {
    mode: Option<&'a str>,
    /// The mode's own block, when there is one.
    own: &'a Yaml,
    /// The `defaults` block, or the `shared` block for shared keys.
    fallback: &'a Yaml,
}

impl Lookup<'_> {
    /// The raw value, as a string, wherever it comes from.
    fn raw(&self, key: &str) -> Option<String> {
        if let Some(mode) = self.mode {
            if let Ok(value) = std::env::var(env_name(Some(mode), key)) {
                return Some(value);
            }
        }
        if let Ok(value) = std::env::var(env_name(None, key)) {
            return Some(value);
        }
        for source in [self.own, self.fallback] {
            match &source[key] {
                Yaml::BadValue | Yaml::Null => continue,
                found => return scalar(found),
            }
        }
        None
    }

    fn num(&self, key: &str) -> Result<usize, String> {
        let raw = self.want(key)?;
        raw.parse::<usize>()
            .map_err(|_| format!("{key} should be a number, got {raw:?}"))
    }

    fn want(&self, key: &str) -> Result<String, String> {
        self.raw(key)
            .ok_or_else(|| format!("{key} is missing from {FILE} (and from `defaults`)"))
    }

    /// A list of strings, from the file only.
    ///
    /// Not overridable by an environment variable: these are the ban lists, and a comma
    /// separated word list in a shell is a worse way to edit them than the file is.
    fn words(&self, key: &str) -> Result<Vec<String>, String> {
        for source in [self.own, self.fallback] {
            match &source[key] {
                Yaml::BadValue | Yaml::Null => continue,
                Yaml::Array(items) => {
                    return items
                        .iter()
                        .map(|item| {
                            scalar(item).ok_or_else(|| format!("{key} should be a list of words"))
                        })
                        .collect()
                }
                _ => return Err(format!("{key} should be a list of words")),
            }
        }
        Ok(Vec::new())
    }

    /// A list of lists of strings, from the file only. See `words`.
    fn word_sets(&self, key: &str) -> Result<Vec<Vec<String>>, String> {
        for source in [self.own, self.fallback] {
            match &source[key] {
                Yaml::BadValue | Yaml::Null => continue,
                Yaml::Array(items) => {
                    return items
                        .iter()
                        .map(|set| match set {
                            Yaml::Array(words) => words
                                .iter()
                                .map(|w| {
                                    scalar(w).ok_or_else(|| {
                                        format!("{key} should be a list of lists of words")
                                    })
                                })
                                .collect(),
                            _ => Err(format!("{key} should be a list of lists of words")),
                        })
                        .collect()
                }
                _ => return Err(format!("{key} should be a list of lists of words")),
            }
        }
        Ok(Vec::new())
    }

    /// Numbers separated by commas, which is how a list reads when it arrives from a shell.
    fn numbers(&self, key: &str) -> Result<Vec<u32>, String> {
        let bad = || format!("{key} should be a list of numbers");
        // An environment override arrives as `4,6`; the file has a real list.
        if let Some(mode) = self.mode {
            if let Ok(value) = std::env::var(env_name(Some(mode), key)) {
                return split_numbers(&value).ok_or_else(bad);
            }
        }
        if let Ok(value) = std::env::var(env_name(None, key)) {
            return split_numbers(&value).ok_or_else(bad);
        }
        for source in [self.own, self.fallback] {
            match &source[key] {
                Yaml::BadValue | Yaml::Null => continue,
                Yaml::Array(items) => {
                    return items
                        .iter()
                        .map(|item| {
                            scalar(item)
                                .and_then(|s| s.parse::<u32>().ok())
                                .ok_or_else(bad)
                        })
                        .collect()
                }
                found => return scalar(found).and_then(|s| split_numbers(&s)).ok_or_else(bad),
            }
        }
        Ok(Vec::new())
    }
}

fn split_numbers(raw: &str) -> Option<Vec<u32>> {
    raw.split(',')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(|part| part.parse::<u32>().ok())
        .collect()
}

/// A YAML scalar as the string it was written as.
///
/// The loader resolves `12` to an integer and `2025-01-01` to a string, and both are
/// wanted as text here so that a value from the file and the same value from an
/// environment variable go down one path.
fn scalar(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(s) => Some(s.clone()),
        Yaml::Integer(n) => Some(n.to_string()),
        Yaml::Real(s) => Some(s.clone()),
        Yaml::Boolean(b) => Some(b.to_string()),
        _ => None,
    }
}

impl Config {
    pub fn load(root: &Path) -> Result<Config, String> {
        let path = root.join(FILE);
        let text = fs::read_to_string(&path)
            .map_err(|e| format!("could not read {}: {e}", path.display()))?;
        Config::parse(&text)
    }

    pub fn parse(text: &str) -> Result<Config, String> {
        let documents =
            YamlLoader::load_from_str(text).map_err(|e| format!("{FILE} is not valid YAML: {e}"))?;
        let doc = documents
            .first()
            .ok_or_else(|| format!("{FILE} is empty"))?;

        let none = Yaml::BadValue;
        let shared_block = &doc["shared"];
        let shared_at = Lookup { mode: None, own: shared_block, fallback: &none };
        let shared = Shared {
            epoch: crate::date::Date::parse(&shared_at.want("epoch")?)?,
            seed: shared_at.num("seed")? as u64,
            id_chars: shared_at.num("idChars")?,
            min_gap: shared_at.num("minGap")?,
            sources: parse_sources(&shared_block["sources"])?,
        };

        // A hex digit is half a byte and a digest is a whole number of them, so the length
        // comes in pairs. Four digits is 65,536 addresses, which a bank of a few thousand
        // puzzles cannot fill without colliding; 64 is BLAKE2s' most.
        if shared.id_chars % 2 != 0 || !(4..=id::MAX_CHARS).contains(&shared.id_chars) {
            return Err(format!(
                "idChars ({}) should be an even number between 4 and {} — a puzzle's id is a \
                 digest of that many hex digits",
                shared.id_chars,
                id::MAX_CHARS
            ));
        }

        let defaults = &doc["defaults"];
        let Yaml::Array(listed) = &doc["modes"] else {
            return Err(format!("{FILE} needs a `modes:` list with at least one game in it"));
        };
        if listed.is_empty() {
            return Err(format!("{FILE} needs a `modes:` list with at least one game in it"));
        }

        let mut modes: Vec<Mode> = Vec::with_capacity(listed.len());
        let mut band_base = 0usize;
        for entry in listed {
            let name = scalar(&entry["name"])
                .ok_or_else(|| "every mode needs a `name`".to_string())?;
            let at = Lookup { mode: Some(&name), own: entry, fallback: defaults };
            let bands: Vec<String> = at.words("bands")?;
            let mode = Mode {
                alphabet: Alphabet::parse(&at.want("alphabet")?)
                    .map_err(|e| format!("mode {name}: {e}"))?,
                band_cuts: at.numbers("bandCuts")?,
                band_base,
                id_chars: shared.id_chars,
                min_word: at.num("minWord")?,
                min_sub: at.num("minSub")?,
                legal_scowl: at.num("legalScowl")? as u32,
                common_scowl: at.num("commonScowl")? as u32,
                slack: at.num("slack")?,
                min_par: at.num("minPar")?,
                max_par: at.num("maxPar")?,
                min_source_moves: at.num("minSourceMoves")?,
                max_alt_ways: at.num("altWays")?,
                alt_slack: at.num("altSlack")?,
                min_divergence: at.num("minDivergence")?,
                around_percent: at.num("aroundPercent")?,
                link_reach: at.num("linkReach")?,
                min_internal: at.num("minInternal")?,
                max_swaps: at.num("maxSwaps")?,
                min_alt_nodes: at.num("minAltNodes")?,
                too_frequent: at.words("tooFrequent")?,
                too_frequent_clusters: at.word_sets("tooFrequentClusters")?,
                vocab: at.raw("vocab"),
                was_vocab: at.words("wasVocab")?,
                bands,
                name: name.clone(),
            };
            check(&mode).map_err(|e| format!("mode {name}: {e}"))?;
            band_base += mode.bands.len();
            modes.push(mode);
        }

        let mut seen: Vec<&str> = Vec::new();
        for mode in &modes {
            if seen.contains(&mode.name.as_str()) {
                return Err(format!(
                    "two modes are called {:?} — a mode's name is part of its cache key and \
                     its environment overrides, so they have to differ",
                    mode.name
                ));
            }
            seen.push(&mode.name);
        }

        Ok(Config {
            shared,
            modes,
            // Not in the file: a way of looking at the bank, not a property of it.
            audit: Audit::parse(std::env::var("RECURSE_AUDIT").ok().as_deref()),
        })
    }
}

/// Everything a mode has to satisfy on its own, checked once at load rather than
/// discovered as a strange bank hours later.
/**
    A declared digest is eight hex digits, and YAML has an opinion about digits.

    `68336fe4` reads as a string, but `01234567` reads as the *integer* 1234567 and comes back
    a digit short — so the build would stop and accuse the corpus of moving, about a value
    copied verbatim from the line it printed. One digest in about four hundred starts with a
    zero. Say what to do instead.

    Shared by every tripwire in the file — `vocab:` per mode and `sources:` per corpus — because
    they are all the same value pasted from the same printed line, and the trap is the same one
    each time.
*/
fn check_digest(what: &str, declared: &str) -> Result<(), String> {
    if declared.len() == 8 && declared.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(());
    }
    // A short run of decimal digits is the tell: YAML read the digest as a number and dropped
    // its leading zeros on the way back out.
    let numeric = declared.len() < 8 && declared.chars().all(|c| c.is_ascii_digit());
    Err(format!(
        "{what} is eight hex digits and {declared:?} is not.{}",
        if numeric {
            " It looks like a digest that YAML read as a number, which loses a leading zero — \
             write it in quotes"
        } else {
            " Copy the eight digits the build prints"
        }
    ))
}

/// The `sources:` block: a cache file name against the digest it is expected to have.
///
/// Absent is fine and means nothing is pinned, which is what a first build wants — the build
/// prints what it read either way, so the block is filled in by pasting rather than by
/// computing anything. See `Shared::sources`.
fn parse_sources(block: &Yaml) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    let entries = match block {
        Yaml::BadValue | Yaml::Null => return Ok(out),
        Yaml::Hash(entries) => entries,
        _ => return Err("sources should be a map of file name to digest".into()),
    };
    for (name, value) in entries {
        let name = scalar(name).ok_or("a source name should be a file name")?;
        let declared =
            scalar(value).ok_or_else(|| format!("source {name} should be a digest"))?;
        check_digest(&format!("source {name}"), &declared)?;
        out.insert(name, declared);
    }
    Ok(out)
}

fn check(mode: &Mode) -> Result<(), String> {
    // The mode name goes into every puzzle id in the mode (see id.rs) and into the manifest
    // JSON unescaped, so it has to be a word rather than an arbitrary string: a name holding a
    // quote or a comma could make one id's input read as another's.
    if mode.name.is_empty() || !mode.name.chars().all(|c| c.is_ascii_lowercase()) {
        return Err("a name is lowercase ascii letters — it goes into every id in the mode".into());
    }
    if let Some(declared) = mode.vocab.as_deref() {
        check_digest("vocab", declared)?;
    }
    // Every past vocabulary is a digest, and each one costs a redirect file per shard it
    // reaches — so a repeat is a line that writes nothing and reads as a second generation
    // that never happened. Checked here rather than deduplicated silently, because a repeated
    // digest in a list of them is more likely a paste that meant to say something else.
    for (at, was) in mode.was_vocab.iter().enumerate() {
        check_digest("wasVocab", was)?;
        if mode.was_vocab[..at].contains(was) {
            return Err(format!("wasVocab lists {was} twice"));
        }
    }
    if mode.min_sub < 1 {
        return Err("minSub must be at least 1".into());
    }
    // if mode.min_word <= mode.min_sub {
    //     return Err(format!(
    //         "minWord ({}) must exceed minSub ({}), or every word would be its own subword",
    //         mode.min_word, mode.min_sub
    //     ));
    // }
    if mode.min_par > mode.max_par {
        return Err("minPar must not exceed maxPar".into());
    }
    if mode.bands.is_empty() {
        return Err("a mode needs at least one band".into());
    }
    // Parity: an odd slack covers exactly what the even value below it covers.
    if mode.slack % 2 != 0 {
        return Err(format!(
            "slack ({}) should be even: parity means an odd value covers exactly what the \
             even value below it covers",
            mode.slack
        ));
    }
    // N bands means N-1 cuts, and each one has to have something in it: a cut at or below
    // the shortest par, or at or above the longest, leaves a band the game offers and the
    // bank cannot fill.
    if mode.band_cuts.len() + 1 != mode.bands.len() {
        return Err(format!(
            "{} bands need {} cuts, got {}",
            mode.bands.len(),
            mode.bands.len() - 1,
            mode.band_cuts.len()
        ));
    }
    let mut floor = mode.min_par;
    for &cut in &mode.band_cuts {
        if (cut as usize) < floor || cut as usize >= mode.max_par {
            return Err(format!(
                "bandCuts {:?} has to leave {} non-empty bands inside par {}-{}, each cut at \
                 or above the one before it and all of them below maxPar",
                mode.band_cuts,
                mode.bands.len(),
                mode.min_par,
                mode.max_par
            ));
        }
        floor = cut as usize + 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn names_the_environment_variable_a_key_answers_to() {
        assert_eq!(env_name(None, "minSub"), "RECURSE_MIN_SUB");
        assert_eq!(env_name(None, "epoch"), "RECURSE_EPOCH");
        assert_eq!(env_name(Some("phonemes"), "minSub"), "RECURSE_PHONEMES_MIN_SUB");
        assert_eq!(env_name(None, "aroundPercent"), "RECURSE_AROUND_PERCENT");
    }

    /// Enough of a file to load, so a test can say what it is about and nothing else.
    fn config(modes: &str) -> Result<Config, String> {
        Config::parse(&format!(
            "shared:\n  epoch: 2025-01-01\n  seed: 1\n  idChars: 12\n  minGap: 45\n\
             defaults:\n  alphabet: letters\n  minWord: 4\n  minSub: 2\n  legalScowl: 80\n  \
             commonScowl: 35\n  slack: 6\n  minPar: 3\n  maxPar: 10\n  minSourceMoves: 2\n  \
             altWays: 4\n  altSlack: 4\n  minDivergence: 2\n  aroundPercent: 45\n  \
             linkReach: 3\n  minInternal: 1\n  maxSwaps: 0\n  minAltNodes: 4\n\
             modes:\n{modes}"
        ))
    }

    #[test]
    fn a_mode_inherits_the_defaults_and_overrides_what_it_wants() {
        let loaded = config(
            "  - name: letters\n    bands: [short, medium, long]\n    bandCuts: [4, 6]\n\
             \x20 - name: phonemes\n    alphabet: phonemes\n    bands: [short, medium, long]\n\
             \x20   bandCuts: [4, 6]\n    minWord: 3\n",
        )
        .expect("loads");
        assert_eq!(loaded.modes[0].alphabet, Alphabet::Letters);
        assert_eq!(loaded.modes[0].min_word, 4);
        assert_eq!(loaded.modes[1].alphabet, Alphabet::Phonemes);
        assert_eq!(loaded.modes[1].min_word, 3);
        // Inherited, not restated.
        assert_eq!(loaded.modes[1].min_sub, 2);
        assert_eq!(loaded.modes[1].around_percent, 45);
    }

    #[test]
    fn bands_are_numbered_across_the_whole_file() {
        let loaded = config(
            "  - name: letters\n    bands: [short, medium, long]\n    bandCuts: [4, 6]\n\
             \x20 - name: phonemes\n    bands: [short, medium, long]\n    bandCuts: [4, 6]\n",
        )
        .expect("loads");
        assert_eq!(loaded.band_count(), 6);
        assert_eq!(loaded.modes[0].global_band(2), 2);
        // The second mode's bands pick up where the first mode's left off, which is what
        // makes a band index mean one thing across the manifest.
        assert_eq!(loaded.modes[1].global_band(0), 3);
        assert_eq!(loaded.modes[1].global_band(2), 5);
    }

    /// Both modes call a band "short", and they are different games. The label is what a
    /// player reads and the id is what anything storing or comparing a band uses — the
    /// client keys a saved game on it, so two boards at par 3 in two alphabets cannot
    /// collide on one key.
    #[test]
    fn a_bands_id_carries_its_mode_and_its_label_does_not() {
        let loaded = config(
            "  - name: letters\n    bands: [short, medium, long]\n    bandCuts: [4, 6]\n\
             \x20 - name: phonemes\n    bands: [short, medium, long]\n    bandCuts: [4, 6]\n",
        )
        .expect("loads");
        assert_eq!(loaded.modes[0].band_name(0), loaded.modes[1].band_name(0));
        assert_eq!(loaded.modes[0].band_id(0), "letters-short");
        assert_eq!(loaded.modes[1].band_id(2), "phonemes-long");
    }

    #[test]
    fn cuts_divide_the_pars_between_the_bands() {
        let loaded = config(
            "  - name: letters\n    bands: [short, medium, long]\n    bandCuts: [4, 6]\n",
        )
        .expect("loads");
        let mode = &loaded.modes[0];
        assert_eq!((mode.band_of(3), mode.band_of(4)), (0, 0));
        assert_eq!((mode.band_of(5), mode.band_of(6)), (1, 1));
        assert_eq!((mode.band_of(7), mode.band_of(10)), (2, 2));
        assert_eq!(mode.band_pars(0), (3, 4));
        assert_eq!(mode.band_pars(1), (5, 6));
        assert_eq!(mode.band_pars(2), (7, 10));
    }

    /// No shipped mode is single-banded, but the mechanism has to stay: a mode that offers
    /// one board a day is a config away, and it is the case with no cuts to read.
    #[test]
    fn one_band_takes_every_par_and_needs_no_cuts() {
        let loaded = config("  - name: solo\n    bands: [only]\n").expect("loads");
        let mode = &loaded.modes[0];
        assert_eq!(mode.band_of(3), 0);
        assert_eq!(mode.band_of(10), 0);
        assert_eq!(mode.band_pars(0), (3, 10));
    }

    #[test]
    fn refuses_a_mode_whose_bands_and_cuts_disagree() {
        // Three bands need two cuts. One would leave a band the game offers and the bank
        // cannot fill, which is only discoverable hours into a build.
        let bad = config("  - name: letters\n    bands: [short, medium, long]\n    bandCuts: [4]\n");
        assert!(bad.unwrap_err().contains("cuts"));
    }

    /// The vocabularies a mode has had, which is what lets a link from before a curation still
    /// open its board. Absent is the ordinary state and means a mode has only ever had one.
    #[test]
    fn reads_the_vocabularies_a_mode_used_to_have() {
        let loaded = config(
            "  - name: letters\n    bands: [a]\n    vocab: e4c1f7b6\n\
             \x20   wasVocab: [68336fe4, aabbccdd]\n\
             \x20 - name: phonemes\n    bands: [b]\n",
        )
        .expect("loads");
        assert_eq!(loaded.modes[0].was_vocab, ["68336fe4", "aabbccdd"]);
        assert!(loaded.modes[1].was_vocab.is_empty());
    }

    /// A repeat writes no second redirect and reads as a generation that never happened, so it
    /// is likelier a paste that meant to say something else than a harmless duplicate.
    #[test]
    fn refuses_a_past_vocabulary_listed_twice() {
        let bad = config("  - name: letters\n    bands: [a]\n    wasVocab: [68336fe4, 68336fe4]\n")
            .expect_err("refuses");
        assert!(bad.contains("twice"), "{bad}");
        // And each one still has to be a digest, with the same YAML-ate-the-leading-zero trap.
        assert!(config("  - name: letters\n    bands: [a]\n    wasVocab: [nope]\n").is_err());
    }

    #[test]
    fn refuses_two_modes_with_one_name() {
        let bad = config("  - name: letters\n    bands: [a]\n  - name: letters\n    bands: [b]\n");
        assert!(bad.unwrap_err().contains("two modes"));
    }

    /// The corpus tripwire, read straight off the block. See `Shared::sources`.
    #[test]
    fn pins_each_corpus_by_name() {
        let block = YamlLoader::load_from_str(
            "sources:\n  scowl80.txt: b8849bb6\n  cmudict.dict: 4cf72c4c\n",
        )
        .unwrap();
        let read = parse_sources(&block[0]["sources"]).unwrap();
        assert_eq!(read.get("scowl80.txt").map(String::as_str), Some("b8849bb6"));
        assert_eq!(read.get("cmudict.dict").map(String::as_str), Some("4cf72c4c"));
    }

    /// Nothing pinned is the state a first build is in, and it is not an error — the build
    /// prints what it read and the block is filled in by pasting.
    #[test]
    fn a_file_with_no_sources_pins_nothing() {
        assert!(parse_sources(&Yaml::BadValue).unwrap().is_empty());
        assert!(config("  - name: letters\n    bands: [a]\n").unwrap().shared.sources.is_empty());
    }

    /**
        The YAML integer trap, which is the one way a correct paste turns into a wrong value.

        `01234567` is a perfectly good digest and YAML reads it as the number 1,234,567 — which
        comes back seven digits long. Left to run, the build would refuse and accuse the corpus
        of moving, about a value copied verbatim from the line it printed. So it is caught where
        it can still be explained.
    */
    #[test]
    fn refuses_a_digest_yaml_read_as_a_number() {
        let block = YamlLoader::load_from_str("sources:\n  scowl80.txt: 01234567\n").unwrap();
        let complaint = parse_sources(&block[0]["sources"]).unwrap_err();
        assert!(complaint.contains("scowl80.txt"), "{complaint}");
        assert!(complaint.contains("quotes"), "{complaint}");
        // Quoted, the same digest is fine — which is what the message tells you to do.
        let fixed = YamlLoader::load_from_str("sources:\n  scowl80.txt: '01234567'\n").unwrap();
        assert!(parse_sources(&fixed[0]["sources"]).is_ok());
    }

    /// Anything that is not eight hex digits, whatever it looks like.
    #[test]
    fn refuses_a_source_digest_that_is_not_one() {
        for bad in ["nothex!!", "b8849bb", "b8849bb6ff"] {
            assert!(check_digest("source scowl80.txt", bad).is_err(), "accepted {bad:?}");
        }
        assert!(check_digest("vocab", "b8849bb6").is_ok());
    }
}
