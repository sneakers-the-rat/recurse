//! Pronunciations, as strings the rest of the builder can treat as words.
//!
//! **One character per phoneme, and everything else follows from that.** The pipeline is
//! byte-wise substring surgery over short ASCII strings — `graph::build`'s `&big[i..j]`,
//! `word::readings`, `has_internal_reading`, the shard TSV, the delta-encoded rows — and
//! none of it cares what the bytes mean. Encode `/kuːlʌst/` as the five characters `TghUce`
//! and the whole builder searches the sound graph unmodified. Using IPA directly would not
//! work: its symbols are multi-byte UTF-8 and some phonemes are digraphs (`tʃ`, `aɪ`), so
//! slicing by byte would cut a symbol in half, and every one of those functions would need
//! a second implementation. IPA is a rendering concern, and `PHONEMES` is what the client
//! renders with.
//!
//! **Stress is dropped, except where it is not stress.** CMUdict marks emphasis with a digit,
//! and for almost every symbol that is all it marks: `IY0` and `IY1` are both `/i/` and a game
//! that told them apart would refuse rhymes that plainly rhyme. Two are different: `AH` is
//! schwa unstressed and the STRUT vowel stressed, `ER` is `/ɚ/` against `/ɝ/`. Those really
//! are different sounds, so they get different characters and the digit decides which.
//!
//! That means the token is also the transcription — one character, one sound, one symbol —
//! and there is nothing to reconcile. Merging them and rendering afterwards was wrong twice
//! over: it printed every STRUT vowel as a schwa, and it let `/ləst/` and `/lʌst/` be the same
//! node, which is a move that does not sound like a move.
//!
//! **Nothing is invented.** A spelling has exactly the pronunciations CMUdict lists for it,
//! so `read` and `route` and `soloist` are several nodes and everything else is one. Words
//! CMUdict does not have are not in this alphabet at all; the build reports how many, and
//! the answer to a thin corpus is a better corpus rather than a guess.

use std::path::Path;

use crate::graph::FxMap;
use crate::words;

/// One phoneme: how CMUdict writes it, how it is rendered, and the character it is
/// encoded as.
///
/// The codes are **written down rather than derived**, because they decide every token in
/// the sound bank and therefore every puzzle id in it. Assigning them by position in a
/// sorted list would mean that a corpus which one day mentions a fortieth phoneme
/// renumbers the other thirty-nine and silently rewrites every address ever shared.
pub struct Phoneme {
    pub arpabet: &'static str,
    /// General American, as a dictionary would print it. The unstressed reading for the two
    /// symbols that have both.
    pub ipa: &'static str,
    /// The character a token spells it with, which is also what decides identity: two words
    /// are the same node when these agree.
    pub code: char,
    /// The character and symbol used instead when CMUdict marks it stressed.
    ///
    /// Only `AH` and `ER` have one, because they are the only two whose digit marks a
    /// different *sound* rather than only emphasis. Adding another splits a phoneme in two and
    /// changes every token that holds it, so it changes every puzzle id as well.
    pub stressed: Option<(char, &'static str)>,
}

/// The 39 symbols of CMUdict, which are 41 sounds: `AH` and `ER` are each two.
///
/// The codes are **written down rather than derived**, because they decide every token in the
/// sound bank and therefore every puzzle id in it.
pub const PHONEMES: [Phoneme; 39] = [
    Phoneme { arpabet: "AA", ipa: "ɑ", code: 'A', stressed: None },
    Phoneme { arpabet: "AE", ipa: "æ", code: 'B', stressed: None },
    Phoneme { arpabet: "AH", ipa: "ə", code: 'C', stressed: Some(('n', "ʌ")) },
    Phoneme { arpabet: "AO", ipa: "ɔ", code: 'D', stressed: None },
    Phoneme { arpabet: "AW", ipa: "aʊ", code: 'E', stressed: None },
    Phoneme { arpabet: "AY", ipa: "aɪ", code: 'F', stressed: None },
    Phoneme { arpabet: "B", ipa: "b", code: 'G', stressed: None },
    Phoneme { arpabet: "CH", ipa: "tʃ", code: 'H', stressed: None },
    Phoneme { arpabet: "D", ipa: "d", code: 'I', stressed: None },
    Phoneme { arpabet: "DH", ipa: "ð", code: 'J', stressed: None },
    Phoneme { arpabet: "EH", ipa: "ɛ", code: 'K', stressed: None },
    Phoneme { arpabet: "ER", ipa: "ɚ", code: 'L', stressed: Some(('o', "ɝ")) },
    Phoneme { arpabet: "EY", ipa: "eɪ", code: 'M', stressed: None },
    Phoneme { arpabet: "F", ipa: "f", code: 'N', stressed: None },
    Phoneme { arpabet: "G", ipa: "ɡ", code: 'O', stressed: None },
    Phoneme { arpabet: "HH", ipa: "h", code: 'P', stressed: None },
    Phoneme { arpabet: "IH", ipa: "ɪ", code: 'Q', stressed: None },
    Phoneme { arpabet: "IY", ipa: "i", code: 'R', stressed: None },
    Phoneme { arpabet: "JH", ipa: "dʒ", code: 'S', stressed: None },
    Phoneme { arpabet: "K", ipa: "k", code: 'T', stressed: None },
    Phoneme { arpabet: "L", ipa: "l", code: 'U', stressed: None },
    Phoneme { arpabet: "M", ipa: "m", code: 'V', stressed: None },
    Phoneme { arpabet: "N", ipa: "n", code: 'W', stressed: None },
    Phoneme { arpabet: "NG", ipa: "ŋ", code: 'X', stressed: None },
    Phoneme { arpabet: "OW", ipa: "oʊ", code: 'Y', stressed: None },
    Phoneme { arpabet: "OY", ipa: "ɔɪ", code: 'Z', stressed: None },
    Phoneme { arpabet: "P", ipa: "p", code: 'a', stressed: None },
    Phoneme { arpabet: "R", ipa: "ɹ", code: 'b', stressed: None },
    Phoneme { arpabet: "S", ipa: "s", code: 'c', stressed: None },
    Phoneme { arpabet: "SH", ipa: "ʃ", code: 'd', stressed: None },
    Phoneme { arpabet: "T", ipa: "t", code: 'e', stressed: None },
    Phoneme { arpabet: "TH", ipa: "θ", code: 'f', stressed: None },
    Phoneme { arpabet: "UH", ipa: "ʊ", code: 'g', stressed: None },
    Phoneme { arpabet: "UW", ipa: "u", code: 'h', stressed: None },
    Phoneme { arpabet: "V", ipa: "v", code: 'i', stressed: None },
    Phoneme { arpabet: "W", ipa: "w", code: 'j', stressed: None },
    Phoneme { arpabet: "Y", ipa: "j", code: 'k', stressed: None },
    Phoneme { arpabet: "Z", ipa: "z", code: 'l', stressed: None },
    Phoneme { arpabet: "ZH", ipa: "ʒ", code: 'm', stressed: None },
];

/// The character one ARPAbet symbol encodes as, digit and all.
///
/// The digit is read here and nowhere else: for `AH` and `ER` it picks the other character,
/// and for everything else it is emphasis and thrown away.
fn code_of(symbol: &str) -> Option<char> {
    let loud = symbol.ends_with(|c: char| c.is_ascii_digit() && c != '0');
    let bare = symbol.trim_end_matches(|c: char| c.is_ascii_digit());
    PHONEMES.iter().find(|phoneme| phoneme.arpabet == bare).map(|phoneme| {
        match phoneme.stressed {
            Some((code, _)) if loud => code,
            _ => phoneme.code,
        }
    })
}

/// How one character reads.
fn ipa_of(code: char) -> &'static str {
    for phoneme in &PHONEMES {
        if phoneme.code == code {
            return phoneme.ipa;
        }
        if let Some((stressed, ipa)) = phoneme.stressed {
            if stressed == code {
                return ipa;
            }
        }
    }
    "?"
}

/// Render a token the way a dictionary would print it. One character in, one symbol out.
pub fn to_ipa(token: &str) -> String {
    token.chars().map(ipa_of).collect()
}

const CMUDICT_URL: &str = "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict";

/// Every spelling CMUdict knows, and the tokens it may be said as — **in the order CMUdict
/// lists them**, so the first is that word's primary pronunciation.
///
/// That order is load-bearing: a node that is nobody's primary reading has no one word that
/// honestly stands for it. See `Lexicon::label`.
///
/// A spelling with variants — `read`, `route`, `either` — comes back with one entry each,
/// deduplicated, because two CMUdict entries can still encode alike once emphasis is dropped.
pub type Pronunciations = FxMap<String, Vec<String>>;

/// Load CMUdict, encoded.
///
/// The file's own shape: one entry per line, `word  PH PH PH`, with a variant written
/// `word(2)` and a `#` comment allowed at the end. Entries that are not plain lowercase
/// words are skipped in the same pass, which drops the abbreviations, the punctuation
/// entries and the proper nouns SCOWL would have refused anyway.
pub fn load(cache: &Path) -> Result<Pronunciations, String> {
    let text = words::fetch(cache, "cmudict.dict", CMUDICT_URL)?;
    let mut found: Pronunciations = FxMap::default();
    let mut unknown: Vec<String> = Vec::new();

    for line in text.lines() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut fields = line.split_whitespace();
        let Some(raw) = fields.next() else { continue };
        // `read(2)` is a second pronunciation of `read`, not a different headword.
        let spelling = match raw.split_once('(') {
            Some((head, _)) => head,
            None => raw,
        };
        if spelling.is_empty() || !spelling.bytes().all(|b| b.is_ascii_lowercase()) {
            continue;
        }

        let mut token = String::with_capacity(12);
        let mut ok = true;
        for symbol in fields {
            match code_of(symbol) {
                Some(code) => token.push(code),
                None => {
                    let bare = symbol.trim_end_matches(|c: char| c.is_ascii_digit());
                    if !unknown.iter().any(|seen| seen == bare) {
                        unknown.push(bare.to_string());
                    }
                    ok = false;
                    break;
                }
            }
        }
        if !ok || token.is_empty() {
            continue;
        }
        let said = found.entry(spelling.to_string()).or_default();
        // Two entries can encode alike once emphasis is dropped, and a word said one way is
        // one node however many times the file says so. The first wins, which keeps CMUdict's
        // own order — and so keeps which pronunciation is primary.
        if !said.contains(&token) {
            said.push(token);
        }
    }

    // A symbol the table does not have is a corpus this code has not been read against, and
    // silently dropping the words that use it would thin the graph for a reason nobody
    // could see. `PHONEMES` is the fix, not a filter here.
    if !unknown.is_empty() {
        return Err(format!(
            "cmudict uses {} symbol(s) PHONEMES does not have: {}. Add them to phonetic.rs \
             — but note that the codes decide every id in the sound bank, so append rather \
             than renumber",
            unknown.len(),
            unknown.join(" "),
        ));
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_phoneme_has_its_own_code() {
        let mut codes: Vec<char> = PHONEMES.iter().map(|p| p.code).collect();
        codes.sort_unstable();
        let before = codes.len();
        codes.dedup();
        assert_eq!(codes.len(), before, "two phonemes share a code");
        // ASCII letters only: a token travels through a tab-separated shard, a
        // newline-joined dictionary and a JSON string, and must not need escaping in any of
        // them.
        assert!(PHONEMES.iter().all(|p| p.code.is_ascii_alphabetic()));
    }

    #[test]
    fn a_token_is_one_character_per_sound_and_reads_back_as_itself() {
        // coolest: K UW1 L AH0 S T.
        let token: String = ["K", "UW1", "L", "AH0", "S", "T"]
            .iter()
            .map(|p| code_of(p).expect("in the table"))
            .collect();
        assert_eq!(token.chars().count(), 6);
        assert_eq!(to_ipa(&token), "kuləst");
    }

    #[test]
    fn the_two_vowels_whose_digit_is_not_emphasis_are_two_sounds() {
        // `/ləst/` and `/lʌst/` are different words said differently, so they are different
        // nodes. Merging them made a move out of a pair that does not sound like one.
        assert_ne!(code_of("AH0"), code_of("AH1"));
        assert_eq!(code_of("AH1"), code_of("AH2"));
        assert_eq!(to_ipa(&code_of("AH0").unwrap().to_string()), "ə");
        assert_eq!(to_ipa(&code_of("AH1").unwrap().to_string()), "ʌ");
        assert_eq!(to_ipa(&code_of("ER0").unwrap().to_string()), "ɚ");
        assert_eq!(to_ipa(&code_of("ER1").unwrap().to_string()), "ɝ");
    }

    #[test]
    fn every_other_digit_is_only_emphasis() {
        // `IY0` and `IY1` are both /i/, and a game that told them apart would refuse rhymes
        // that plainly rhyme.
        for symbol in ["IY", "AA", "EH", "OW", "UW"] {
            assert_eq!(code_of(&format!("{symbol}0")), code_of(&format!("{symbol}1")));
        }
    }
}
