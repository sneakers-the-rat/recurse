//! Puzzle identifiers: the address a shared board is reached at, and the root of a
//! small hash tree.
//!
//! A puzzle's id is a BLAKE2s digest of a canonical JSON array — the game it belongs
//! to, its two words in sorted order, and the digest of the vocabulary they were
//! found in — asked for at exactly `idChars` hex digits:
//!
//!     ["letters","passing","starring","9f2c1e77"]  ->  a8ccda3b
//!
//! **The vocabulary digest is in there because a shared board's code depends on it.**
//! A code (see src/lib/boardCode.ts) says "the third of the legal moves from here"
//! and "dictionary word 3187", so it is only meaningful against the exact word list
//! and edge rules it was written against. Putting that digest in the address makes
//! the dependency a *parent* of the thing that depends on it: an id resolves only
//! where its codes resolve, and a new vocabulary is honestly a new set of puzzles
//! rather than the same ones quietly reinterpreted. See `vocab_spec`.
//!
//! Nothing else about the bank is in it, and that is the other half of the trade.
//! Par, the answer, the words the board draws and every selection knob can move
//! without touching an address, because none of them can change what a code means.
//!
//! Asked for, not cut down to: the digest length is one of BLAKE2's parameters and
//! goes into the state before a byte of message does, so a 4-byte digest is its own
//! digest rather than the front of the 32-byte one. Every id therefore changes
//! completely if `idChars` ever does — that knob is not a display width.
//!
//! Two decisions worth knowing.
//!
//! **Why a digest and not the bank index.** `/recurse/12` invites reading
//! `/recurse/13`, which is tomorrow's puzzle: an enumerable address hands out the
//! whole calendar. A digest is a name that can be given away without also giving
//! away its neighbours.
//!
//! **Why the pair sorted, and not as found.** A move is an insertion or a removal
//! and the two are inverses, so `carts → heartens` and `heartens → carts` are one
//! puzzle — and which of them the builder writes first is a *finding* of the rules
//! (see `judge_candidates`), so it moves when a rule moves. Sorting makes the
//! address blind to that, and the board format is blind to it for the same reason:
//! a code counts its stands from the sorted pair, not from `source`.
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

/// A canonical JSON array of words — the exact bytes a digest here is taken of.
///
/// Tokens are letters or phoneme codes, so nothing needs escaping. Written out
/// rather than hashing the pieces directly so the input stays a thing you can
/// print, paste into any other blake2s and check by hand.
fn spec(parts: &[&str]) -> String {
    let mut out = String::with_capacity(parts.iter().map(|p| p.len() + 3).sum::<usize>() + 2);
    out.push('[');
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        out.push_str(part);
        out.push('"');
    }
    out.push(']');
    out
}

/// The digest of a *vocabulary*: everything that decides which moves exist.
///
/// A board's code indexes into two lists and nothing else — the legal moves from a
/// word, and the dictionary — and both are functions of exactly this: the sorted
/// list of every token a player may guess, the alphabet those tokens are in, and
/// the two lengths that decide whether a run inside a word counts as a move. Hash
/// those and every index in every code is pinned; leave one out and a code can come
/// back as a different legal move, which is worse than not coming back at all.
///
/// **What is deliberately absent is as important.** The common tier, the selection
/// rules, the frequency lists, the calendar: all of them change what the bank
/// *holds* and none of them can change what a code *means*, so none of them belongs
/// in an address. That is the whole reason this is a separate digest and not the
/// bank version — see `bank::key`, which covers the opposite set.
///
/// The words are the bulk of it and they are already sorted, so this is one pass
/// over the shipped dictionary, once per mode per build.
pub fn vocab_spec(alphabet: &str, min_word: usize, min_sub: usize, words: &[String]) -> String {
    let mut out = String::with_capacity(words.iter().map(|w| w.len() + 1).sum::<usize>() + 32);
    out.push_str(alphabet);
    out.push('|');
    out.push_str(&min_word.to_string());
    out.push('|');
    out.push_str(&min_sub.to_string());
    for word in words {
        out.push('\n');
        out.push_str(word);
    }
    out
}

/// A puzzle's public address: the game, its two words sorted, and the vocabulary.
///
/// `chars` must be even and between 2 and 64 — a hex digit is half a byte and the
/// digest is a whole number of them. config.rs enforces that on the knob, so a bad
/// value here is a programming error rather than a misconfiguration.
pub fn puzzle_id(mode: &str, a: &str, b: &str, vocab: &str, chars: usize) -> String {
    let (first, second) = if a <= b { (a, b) } else { (b, a) };
    digest(spec(&[mode, first, second, vocab]).as_bytes(), chars)
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
        assert_eq!(spec(&["abc"]), r#"["abc"]"#);
        assert_eq!(digest(spec(&["abc"]).as_bytes(), 8), "679cceb4");
        assert_eq!(digest(spec(&["abc"]).as_bytes(), 12), "d882ea846e9f");
        assert_eq!(
            digest(spec(&["abc"]).as_bytes(), MAX_CHARS),
            "0e94fd51cc5e9cf0f8108cd2fc1a286a559c38edb404eacdf15f1a3b7607094c"
        );
    }

    /// The length is a BLAKE2 parameter, so a shorter id is not the front of a
    /// longer one. This is the assertion that pins the difference: get it by
    /// truncating instead and the first digits would match, which is why the
    /// distinction is easy to miss and worth a test of its own.
    #[test]
    fn a_shorter_id_is_its_own_digest_not_a_prefix() {
        let short = digest(spec(&["abc"]).as_bytes(), 8);
        assert_eq!(short.len(), 8);
        assert!(!digest(spec(&["abc"]).as_bytes(), MAX_CHARS).starts_with(&short));
    }

    /// The address names the game, the pair and the vocabulary — and nothing else,
    /// which is what lets par and the drawn board move without breaking a link.
    #[test]
    fn ids_name_the_game_the_pair_and_the_vocabulary() {
        let one = puzzle_id("letters", "passing", "starring", "9f2c1e77", 8);
        // The literal from this file's own header, which claims the input is a thing you can
        // paste into any other blake2s and check by hand:
        //
        //     python3 -c 'import hashlib; print(hashlib.blake2s(
        //         b"[\"letters\",\"passing\",\"starring\",\"9f2c1e77\"]",
        //         digest_size=4).hexdigest())'
        //
        // Asserted because the header said something else for a while and nothing noticed.
        assert_eq!(one, "a8ccda3b");
        // Read the other way round it is the same puzzle, so the same address: a
        // move is its own inverse, and which end the builder wrote first is a
        // finding of the rules rather than a fact about the puzzle.
        assert_eq!(puzzle_id("letters", "starring", "passing", "9f2c1e77", 8), one);
        // A different game, or a different vocabulary, is a different set of
        // puzzles — and a code written against one cannot be read against another.
        assert_ne!(puzzle_id("phonemes", "passing", "starring", "9f2c1e77", 8), one);
        assert_ne!(puzzle_id("letters", "passing", "starring", "00000000", 8), one);
    }

    /// Every input is on its own side of a delimiter, so no two different sets of
    /// parts can produce one address by running into each other.
    #[test]
    fn parts_cannot_run_together() {
        assert_ne!(
            puzzle_id("letters", "pass", "ingstarring", "9f2c1e77", 8),
            puzzle_id("letters", "passing", "starring", "9f2c1e77", 8)
        );
    }

    /// A vocabulary digest is a pass over the shipped dictionary, and the lengths
    /// are in it because they decide which runs inside a word count as moves.
    #[test]
    fn a_vocabulary_is_its_words_and_its_lengths() {
        let words = vec!["base".to_string(), "ball".to_string()];
        let one = vocab_spec("letters", 3, 2, &words);
        assert_eq!(one, "letters|3|2\nbase\nball");
        assert_ne!(vocab_spec("letters", 4, 2, &words), one);
        assert_ne!(vocab_spec("letters", 3, 3, &words), one);
        assert_ne!(vocab_spec("phonemes", 3, 2, &words), one);
        assert_ne!(vocab_spec("letters", 3, 2, &words[..1]), one);
    }
}
