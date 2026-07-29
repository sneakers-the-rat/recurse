//! Puzzle identifiers: the address a shared board is reached at.
//!
//! A puzzle's id is a BLAKE2s digest of its answer, written as a canonical JSON
//! array of the words, asked for at exactly `RECURSE_ID_CHARS` hex digits:
//!
//!     ["passing","starring"]  ->  5be37f57  ->  /recurse/5be37f57
//!
//! Asked for, not cut down to: the digest length is one of BLAKE2's parameters and
//! goes into the state before a byte of message does, so a 4-byte digest is its own
//! digest rather than the front of the 32-byte one. Every id therefore changes
//! completely if `RECURSE_ID_CHARS` ever does — that knob is not a display width.
//!
//! Two decisions worth knowing.
//!
//! **Why a digest and not the bank index.** `/recurse/12` invites reading
//! `/recurse/13`, which is tomorrow's puzzle: an enumerable address hands out the
//! whole calendar. A digest is a name that can be given away without also giving
//! away its neighbours.
//!
//! **Why the answer and not the word pair.** The puzzle *is* its solution, so the
//! id names what the player is meant to find. The consequence is that a rebuild
//! which changes an answer changes that puzzle's address and old links to it stop
//! resolving; one that leaves the answer alone keeps them working.
//!
//! Eight hex digits is 32 bits, which over a bank of a few thousand puzzles makes
//! a collision a fraction of a percent likely — small, but not zero, so `main.rs`
//! checks rather than trusting it. Six was the first proposal and would have been
//! a coin flip at this bank size.

use blake2::digest::{Update, VariableOutput};
use blake2::Blake2sVar;

/// Hex digits in the longest id BLAKE2s can produce: its 32-byte maximum.
pub const MAX_CHARS: usize = 64;

/// How many files the bank is split into for the client, and the width of the id
/// prefix that names one. Two hex digits, so 256.
///
/// The split lives with the id rather than with the file writing, because it is a
/// property of the address: an id names its own shard, which is what lets a shared
/// link be fetched in one request with nothing looked up first.
pub const SHARDS: usize = 256;

/// Which shard an id belongs to.
pub fn shard_of(id: &str) -> usize {
    usize::from_str_radix(id.get(..2).unwrap_or("0"), 16).unwrap_or(0)
}

/// The canonical JSON array of an answer — the exact bytes an id is a digest of.
///
/// Words are letters, so nothing here needs escaping. Written out rather than
/// hashing the words directly so the input stays a thing you can print, paste into
/// any other blake2s and check by hand.
pub fn answer_spec(answer: &[String]) -> String {
    let mut spec = String::with_capacity(answer.iter().map(|w| w.len() + 3).sum::<usize>() + 2);
    spec.push('[');
    for (i, word) in answer.iter().enumerate() {
        if i > 0 {
            spec.push(',');
        }
        spec.push('"');
        spec.push_str(word);
        spec.push('"');
    }
    spec.push(']');
    spec
}

/// A puzzle's public address: a `chars`-digit BLAKE2s digest of its answer.
///
/// `chars` must be even and between 2 and 64 — a hex digit is half a byte and the
/// digest is a whole number of them. config.rs enforces that on the knob, so a bad
/// value here is a programming error rather than a misconfiguration.
pub fn puzzle_id(answer: &[String], chars: usize) -> String {
    digest(answer_spec(answer).as_bytes(), chars)
}

/// A BLAKE2s digest of `message`, `chars` hex digits long.
///
/// `chars` must be even and between 2 and 64 — a hex digit is half a byte and the
/// digest is a whole number of them. config.rs enforces that on the knob, so a bad
/// value here is a programming error rather than a misconfiguration.
pub fn digest(message: &[u8], chars: usize) -> String {
    assert!(
        chars % 2 == 0 && (2..=MAX_CHARS).contains(&chars),
        "a digest is between 2 and {MAX_CHARS} hex digits, in pairs; got {chars}"
    );
    let mut hasher = Blake2sVar::new(chars / 2).expect("a length BLAKE2s allows");
    hasher.update(message);
    let mut bytes = vec![0u8; chars / 2];
    hasher
        .finalize_variable(&mut bytes)
        .expect("the buffer is the length the hasher was built for");
    let mut hex = String::with_capacity(chars);
    for byte in bytes {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pinned against what the rest of the world computes for these bytes:
    ///
    ///     python3 -c 'import hashlib; print(hashlib.blake2s(b"[\"abc\"]", digest_size=4).hexdigest())'
    ///
    /// Worth pinning even with a crate doing the work. An id is a digest at a
    /// requested *length*, and every plausible way of getting that wrong — asking
    /// for bytes where digits were meant, or cutting a long digest down — compiles
    /// perfectly well and produces confident nonsense.
    #[test]
    fn hashes_what_every_other_blake2s_hashes() {
        let answer = vec!["abc".to_string()];
        assert_eq!(answer_spec(&answer), r#"["abc"]"#);
        assert_eq!(puzzle_id(&answer, 8), "679cceb4");
        assert_eq!(puzzle_id(&answer, 12), "d882ea846e9f");
        assert_eq!(
            puzzle_id(&answer, MAX_CHARS),
            "0e94fd51cc5e9cf0f8108cd2fc1a286a559c38edb404eacdf15f1a3b7607094c"
        );
    }

    /// The length is a BLAKE2 parameter, so a shorter id is not the front of a
    /// longer one. This is the assertion that pins the difference: get it by
    /// truncating instead and the first digits would match, which is why the
    /// distinction is easy to miss and worth a test of its own.
    #[test]
    fn a_shorter_id_is_its_own_digest_not_a_prefix() {
        let answer = vec!["abc".to_string()];
        let short = puzzle_id(&answer, 8);
        assert_eq!(short.len(), 8);
        assert!(!puzzle_id(&answer, MAX_CHARS).starts_with(&short));
    }

    #[test]
    fn ids_name_the_answer_and_nothing_else() {
        let short = vec!["passing".to_string(), "starring".to_string()];
        assert_eq!(answer_spec(&short), r#"["passing","starring"]"#);
        assert_eq!(puzzle_id(&short, 8), "5be37f57");
        // Same endpoints, different route through them: a different puzzle, and so
        // a different address.
        let longer = vec![
            "passing".to_string(),
            "passings".to_string(),
            "starring".to_string(),
        ];
        assert_ne!(puzzle_id(&longer, 8), puzzle_id(&short, 8));
    }
}
