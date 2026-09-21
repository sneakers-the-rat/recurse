//! Loading word lists.
//!
//! **Every list here comes from somewhere that can move under us.** The SCOWL tiers are
//! generated on demand by app.aspell.net, and the frequency list and CMUdict are the `master`
//! branch of a repository somebody else maintains. None of the three is a version; all three
//! are "whatever that address serves today". A build machine with a warm cache never notices,
//! and a fresh one — a clean checkout, or CI — downloads whatever is current.
//!
//! That matters more here than it would in most projects, because these bytes decide the
//! *addresses*. A word appearing or leaving changes the vocabulary digest, which changes every
//! puzzle id in the mode, which invalidates every board link and every shared round anyone has
//! posted. So what a build read is recorded as a digest per source and checked against
//! `sources:` in recurse.yaml — see `Sources`, and `vocab:` for the same idiom one layer down.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::id;

/// How much of a digest a source is named by. Eight hex digits, the same as a vocabulary,
/// because the two are read side by side and a person comparing them should not have to
/// count.
const SOURCE_CHARS: usize = 8;

/// What a build actually read, by cache name: a digest of each source's own bytes.
///
/// **Of the bytes, not of the words parsed out of them.** The point is to notice that the
/// upstream file moved, and a change that the parser happens to discard — a header line, a
/// proper noun, a comment — is still a change to the thing being pinned, and still the moment
/// to look. Parsing first would make the tripwire agree with the parser rather than with the
/// source.
///
/// Ordered, so what the build prints is stable and a diff of two runs is readable.
#[derive(Debug, Default, Clone)]
pub struct Sources(BTreeMap<String, String>);

impl Sources {
    fn note(&mut self, name: &str, bytes: &[u8]) {
        self.0.insert(name.to_string(), id::digest(bytes, SOURCE_CHARS));
    }

    /**
        What this build read, against what recurse.yaml says it should be.

        **The outermost of the three tripwires, and the only one that names a file.** `vocab:`
        catches a word list that has moved, but only once it has become a mode's dictionary —
        one mode at a time, saying "the vocabulary moved" without saying which of three
        downloads did it. And the frequency list is outside it altogether: it decides which end
        of a pair is written as the source and which words look familiar, so it shapes the bank
        while belonging to no vocabulary at all.

        The failure this is for is not a careless edit — nobody edits these files — but a *clean
        machine*. A warm cache is what hides it: the laptop that built the shipped bank goes on
        agreeing with itself for as long as its cache survives, and CI, which has none,
        downloads today's.

        **Only what was actually read.** Asking about the letters game never fetches CMUdict, and
        a declaration for a file this run had no use for is not something to refuse over.

        Refusing is the whole of it, and none of this goes into the bank cache key. A key would
        mean a changed corpus silently invalidated a cached bank and cost a quarter of an hour;
        refusing means it cannot be built against at all until somebody says it may be, and then
        there is no stale bank left to reuse.
    */
    pub fn check(&self, declared: &BTreeMap<String, String>) -> Result<(), String> {
        for (name, digest) in &self.0 {
            match declared.get(name) {
                Some(want) if want != digest => {
                    return Err(format!(
                        "corpus {name} is {digest}, and recurse.yaml declares {want}.\n\
                         This file is fetched from an address that serves whatever is current, \
                         so a build against a different copy of it is a different set of \
                         puzzles: the ids it finds are digests of the word list, and every board \
                         link and shared round already posted was written against the old one.\n\
                         If the new corpus is intended, set `{name}: {digest}` under `sources:` \
                         and expect every `vocab:` in the file to move with it; if it is not, \
                         delete {name} from the cache and let it download again, or restore the \
                         copy the bank was built from",
                    ));
                }
                // Printed either way, so the block is filled in by pasting and never by
                // computing anything — the same arrangement `vocab:` has.
                Some(_) => eprintln!("  corpus {name}: {digest}, as declared"),
                None => {
                    eprintln!("  corpus {name}: {digest} — declare it under `sources:` to pin it")
                }
            }
        }
        Ok(())
    }
}

fn scowl_url(size: u32) -> String {
    format!(
        "http://app.aspell.net/create?max_size={size}&spelling=US&max_variant=0\
         &diacritic=strip&download=wordlist&encoding=utf-8&format=inline"
    )
}

/// Fetch into the cache if absent. Shells out to curl rather than taking an HTTP
/// dependency; this runs once per word list and then never again.
fn ensure_cached(cache: &Path, name: &str, url: &str) -> Result<PathBuf, String> {
    let path = cache.join(name);
    if path.exists() {
        return Ok(path);
    }
    fs::create_dir_all(cache).map_err(|e| format!("could not create {}: {e}", cache.display()))?;
    eprintln!("  downloading {name}");
    let output = Command::new("curl")
        .args(["-sSL", "--max-time", "120", "-o"])
        .arg(&path)
        .arg(url)
        .output()
        .map_err(|e| format!("could not run curl: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&path);
        return Err(format!(
            "curl failed for {name}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(path)
}

/// A cached corpus, as text, with its bytes noted. Downloads it the first time and then
/// never again.
pub fn fetch(cache: &Path, name: &str, url: &str, seen: &mut Sources) -> Result<String, String> {
    read_source(&ensure_cached(cache, name, url)?, name, seen)
}

/// Read a source and record what it was, which is the one path a pinned file may arrive by.
///
/// The digest is taken over what is *on disk*, so a cache filled by an earlier build is
/// checked exactly as a fresh download is. A stale cache is the likelier of the two ways to
/// end up building against a file nobody meant to use.
fn read_source(path: &Path, name: &str, seen: &mut Sources) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    seen.note(name, &bytes);
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// A SCOWL list, lowercase entries only.
///
/// SCOWL puts a prose header before the words and preserves capitalisation, so
/// keeping lines that are entirely lowercase ASCII letters skips the header and
/// drops proper nouns (Heather, Ford, Lear, Superman) in the same pass.
pub fn load_scowl(cache: &Path, size: u32, seen: &mut Sources) -> Result<HashSet<String>, String> {
    let name = format!("scowl{size}.txt");
    let path = ensure_cached(cache, &name, &scowl_url(size))?;
    let text = read_source(&path, &name, seen)?;
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase()))
        .map(str::to_string)
        .collect())
}

const FREQ_URL: &str = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/\
                        master/content/2018/en/en_50k.txt";

/// Words ranked most to least frequent. Supplies an *ordering* only — it decides
/// which endpoints feel familiar, never which words are legal.
pub fn load_frequency(cache: &Path, seen: &mut Sources) -> Result<Vec<String>, String> {
    let path = ensure_cached(cache, "en_50k.txt", FREQ_URL)?;
    let text = read_source(&path, "en_50k.txt", seen)?;
    Ok(text
        .lines()
        .filter_map(|line| line.split(' ').next())
        .map(str::trim)
        .filter(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase()))
        .map(str::to_string)
        .collect())
}

/// One banned word per line with `#` comments, as used by `tools/blocklist.txt` and
/// `tools/nonwords.txt`.
///
/// A file that is not there is an empty list rather than an error — both are optional, and a
/// checkout that has deleted one has said what it means.
pub fn load_list(path: &Path) -> Result<HashSet<String>, String> {
    if !path.exists() {
        return Ok(HashSet::new());
    }
    let text = read_lossy(path)?;
    Ok(text
        .lines()
        .map(|line| line.split('#').next().unwrap_or("").trim().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect())
}

fn read_lossy(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let mut file =
        fs::File::create(path).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(entries: &[(&str, &[u8])]) -> Sources {
        let mut out = Sources::default();
        for (name, bytes) in entries {
            out.note(name, bytes);
        }
        out
    }

    fn declared(entries: &[(&str, &str)]) -> BTreeMap<String, String> {
        entries.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// The bytes, not the words in them: a change the parser would discard is still the
    /// upstream file moving, and still the moment to be told.
    #[test]
    fn a_source_is_a_digest_of_its_own_bytes() {
        let one = seen(&[("scowl80.txt", b"base\nball\n")]);
        let other = seen(&[("scowl80.txt", b"base\nball\ncannon\n")]);
        assert_ne!(one.0["scowl80.txt"], other.0["scowl80.txt"]);
        // A header line is a change, though `load_scowl` drops every one of them.
        let with_header = seen(&[("scowl80.txt", b"# generated today\nbase\nball\n")]);
        assert_ne!(one.0["scowl80.txt"], with_header.0["scowl80.txt"]);
        // And it is stable, or the tripwire would fire on every run.
        assert_eq!(one.0["scowl80.txt"], seen(&[("scowl80.txt", b"base\nball\n")]).0["scowl80.txt"]);
    }

    #[test]
    fn accepts_a_corpus_that_is_what_it_was_declared_to_be() {
        let read = seen(&[("scowl80.txt", b"base\nball\n")]);
        let digest = read.0["scowl80.txt"].clone();
        assert!(read.check(&declared(&[("scowl80.txt", &digest)])).is_ok());
    }

    /// The whole point: a file that moved under a build stops it, and says which file.
    #[test]
    fn refuses_a_corpus_that_has_moved_and_names_it() {
        let read = seen(&[("scowl80.txt", b"base\nball\n")]);
        let complaint = read.check(&declared(&[("scowl80.txt", "deadbeef")])).unwrap_err();
        assert!(complaint.contains("scowl80.txt"));
        assert!(complaint.contains("deadbeef"));
        // And says what to write to accept it, so the fix is a paste.
        assert!(complaint.contains(&read.0["scowl80.txt"]));
    }

    /// Nothing declared is not an error. A first build has no digests to declare yet, and it
    /// is the build's own output that supplies them.
    #[test]
    fn pins_nothing_when_nothing_is_declared() {
        assert!(seen(&[("scowl80.txt", b"base\n")]).check(&BTreeMap::new()).is_ok());
    }

    /// One word per line, and everything from a `#` onwards is not one.
    #[test]
    fn reads_a_word_list_a_line_at_a_time() {
        let dir = std::env::temp_dir().join("graphgen-load-list");
        fs::create_dir_all(&dir).expect("a temp dir");
        let path = dir.join("list.txt");
        write_file(
            &path,
            "# a comment\n\
             ing\n\
             \n\
             ST  # trailing comments, and case\n",
        )
        .expect("writes");
        let read = load_list(&path).expect("reads");
        assert_eq!(read.len(), 2);
        assert!(read.contains("ing"));
        assert!(read.contains("st"));
        // Not the comment, and not the `#` that started it.
        assert!(!read.contains("comment"));
        assert!(!read.contains("#"));
        fs::remove_file(&path).ok();
    }

    /// Neither list is required. A checkout with no `nonwords.txt` is a game with nothing
    /// struck out of its word list, which is a state to build in rather than fail in.
    #[test]
    fn a_list_that_is_not_there_is_an_empty_one() {
        assert!(load_list(Path::new("no/such/list.txt")).expect("no error").is_empty());
    }

    /// Asking only about the letters game never downloads CMUdict, so a declaration for a file
    /// this run had no use for is not something to refuse over.
    #[test]
    fn ignores_a_source_this_run_never_read() {
        let read = seen(&[("scowl80.txt", b"base\n")]);
        let digest = read.0["scowl80.txt"].clone();
        let both = declared(&[("scowl80.txt", &digest), ("cmudict.dict", "deadbeef")]);
        assert!(read.check(&both).is_ok());
    }
}
