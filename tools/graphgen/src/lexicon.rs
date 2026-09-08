//! One mode's corpus, in that mode's alphabet.
//!
//! The whole builder works over strings and asks only two things about them that are not
//! pure string surgery: which words there are, and whether two of them are the same word in
//! different clothes. This is where both answers come from, so it is the only place that
//! knows an alphabet exists.
//!
//! A **token** is a node of the graph. In the letters alphabet a token is a spelling and
//! this module is nearly a no-op. In the phonemes alphabet a token is a pronunciation, one
//! character per phoneme (see phonetic.rs), and the two directions come apart:
//!
//! * A token has **several spellings** when they are homophones — `right`, `rite`, `wright`
//!   and `write` are one node. Which one is drawn is a display decision, made here by
//!   familiarity, and a guess of any of them is the same move.
//! * A spelling has **several tokens** when CMUdict lists more than one way to say it —
//!   `read`, `route`, `either`. Those are genuinely different nodes and a board can hold
//!   two of them at once, which is what the transcription under a label is for.
//!
//! Word families are the part that cannot be alphabet-blind. Snowball stems *spellings*, so
//! asking it about `TghUce` gets nonsense back. A token's family is therefore the family of
//! the spelling it is drawn as — and a fragment that is not a token has no family at all,
//! which is the honest answer for a run of phonemes that spells nothing.

use std::sync::Arc;

use crate::config::Alphabet;
use crate::graph::{FxMap, FxSet};
use crate::phonetic::Pronunciations;
use crate::word;

/// Is `token` the *first* pronunciation CMUdict lists for `spelling`?
///
/// The order in the file is the order the dictionary gives them in, so the first is the
/// ordinary reading and the rest are variants. See `label`.
fn says_first(said: &Pronunciations, spelling: &str, token: &str) -> bool {
    said.get(spelling).and_then(|ways| ways.first()).is_some_and(|first| first == token)
}

pub struct Lexicon {
    pub alphabet: Alphabet,
    /// Every token a player may guess in, sorted. The graph's legal tier.
    ///
    /// **Including tokens too short to play.** A word below `minWord` can never be a node and
    /// one below `minSub` can never be a subword either, so they are dead weight in the graph
    /// — but they are not dead weight in the *dictionary*, because that is also what a typed
    /// guess is resolved against. Drop them and `eye` comes back from the phonemes mode as a
    /// word nobody knows how to say, when the truth is that it is one sound long. The graph
    /// filters by length where it builds; this list does not.
    pub legal: Vec<String>,
    /// Every token a puzzle may be built from, sorted. A subset of `legal`.
    pub common: Vec<String>,
    /// Token to its spellings, best first. Empty for `Letters`, where a token is already its
    /// own spelling and a map of 189,000 words to themselves is waste.
    spellings: FxMap<String, Vec<String>>,
    /// Tokens that are some word's **primary** pronunciation.
    ///
    /// A node not in here is nobody's ordinary reading — every spelling that says it has some
    /// other pronunciation listed first — and drawing it as one of those words would be a lie
    /// about how that word is said. See `label`.
    primary: FxSet<String>,
    /// Token to the stem of its canonical spelling. Only for `Phonemes`; `Letters` goes
    /// straight to the stemmer, which has a cache of its own.
    stems: FxMap<String, Arc<str>>,
}

impl Lexicon {
    /// The letters alphabet: a token is a spelling, and nothing is translated.
    pub fn letters(legal: Vec<String>, common: Vec<String>) -> Lexicon {
        Lexicon {
            alphabet: Alphabet::Letters,
            legal,
            common,
            spellings: FxMap::default(),
            primary: FxSet::default(),
            stems: FxMap::default(),
        }
    }

    /// The phonemes alphabet: a token is a pronunciation CMUdict lists for some spelling in
    /// the tier.
    ///
    /// A spelling CMUdict has never heard of is simply not in this alphabet. That is a real
    /// loss — it is most of SCOWL's long tail — and it is reported rather than papered over,
    /// because the fix is a better pronunciation corpus and not a guess at the missing ones.
    ///
    /// `rank` is the frequency ordering, and it decides which spelling a homophone is drawn
    /// as: `write` rather than `wright`. Spellings the common tier holds come first
    /// regardless, so a node the board draws is never labelled with a word nobody knows when
    /// an ordinary one says the same thing.
    pub fn phonemes(
        legal_words: &[String],
        common_words: &[String],
        said: &Pronunciations,
        rank: &FxMap<String, usize>,
    ) -> Lexicon {
        let ordinary: FxSet<&str> = common_words.iter().map(String::as_str).collect();

        let mut spellings: FxMap<String, Vec<String>> = FxMap::default();
        // Tokens that some word says *first*. CMUdict lists a word's pronunciations in order,
        // so this is "the ordinary way to say at least one of the spellings that say it".
        let mut primary: FxSet<String> = FxSet::default();

        for spelling in legal_words {
            for (at, token) in said.get(spelling).into_iter().flatten().enumerate() {
                spellings.entry(token.clone()).or_default().push(spelling.clone());
                if at == 0 {
                    primary.insert(token.clone());
                }
            }
        }

        for (token, drawn) in spellings.iter_mut() {
            drawn.sort_by(|a, b| {
                let key = |w: &String| {
                    (
                        // **A word that says it this way first.** `/kən/` is `can`'s second
                        // pronunciation — its first is `/kæn/` — so drawing that node as
                        // `can` shows a word nobody would read as the sound on the board.
                        // Any spelling whose *primary* reading this is beats every spelling
                        // for which it is an afterthought.
                        !says_first(said, w, token),
                        // Then an ordinary word over a rare one, then the more familiar of
                        // two, then alphabetically so a rebuild draws the same label twice.
                        !ordinary.contains(w.as_str()),
                        rank.get(w).copied().unwrap_or(usize::MAX),
                        w.clone(),
                    )
                };
                key(a).cmp(&key(b))
            });
        }

        let tokens = |words: &[String]| -> Vec<String> {
            let mut out: Vec<String> = words
                .iter()
                .filter_map(|spelling| said.get(spelling))
                .flatten()
                .cloned()
                .collect();
            out.sort_unstable();
            out.dedup();
            out
        };
        let legal = tokens(legal_words);
        let common = tokens(common_words);

        // One stemming per token rather than one per comparison. `same_family` is asked tens
        // of millions of times a build and the answer never changes.
        let stems = spellings
            .iter()
            .filter_map(|(token, drawn)| {
                drawn.first().map(|best| (token.clone(), word::stem(best)))
            })
            .collect();

        Lexicon { alphabet: Alphabet::Phonemes, legal, common, spellings, primary, stems }
    }

    /// What to draw a token as.
    ///
    /// **One word if one word honestly says it, otherwise all of them.** A node that is some
    /// spelling's primary pronunciation is drawn as that spelling and the rest are accepted
    /// silently — `right`, `rite`, `wright` and `write` are one sound and `right` stands for
    /// it. A node that is *nobody's* primary reading has no such word: `/kən/` is the second
    /// pronunciation of `can`, of `con` and of a dozen others, and drawing it as any one of
    /// them shows a word whose ordinary reading is a different sound. Those are drawn as the
    /// whole set, which is the true answer — "one of these, said this way".
    ///
    /// A token with no spelling at all is drawn as itself, which can only happen for a
    /// fragment that is not a node.
    pub fn label(&self, token: &str) -> String {
        let Some(drawn) = self.spellings.get(token) else {
            return token.to_string();
        };
        if self.primary.contains(token) {
            return drawn.first().cloned().unwrap_or_else(|| token.to_string());
        }
        drawn.join("/")
    }

    /// Is this node some word's ordinary reading? See `label`.
    pub fn is_primary(&self, token: &str) -> bool {
        self.primary.contains(token)
    }

    /// Every spelling that names this token, most familiar first.
    ///
    /// Empty when the alphabet keeps no map — which is the letters one, where a token is
    /// already its own only label and `label` is the whole answer.
    pub fn labels(&self, token: &str) -> &[String] {
        match self.spellings.get(token) {
            Some(drawn) => drawn.as_slice(),
            None => &[],
        }
    }

    /// Are these two strings the same word wearing different clothes?
    ///
    /// The one question the rules ask that an alphabet can answer differently.
    /// `SameFamilyOnRoute` asks it about two nodes; `is_compound_swap` also asks it about a
    /// *fragment* of one, which is why the phoneme answer falls back to equality: a run of
    /// phonemes that is not a word has no inflections to be a form of.
    pub fn same_family(&self, a: &str, b: &str) -> bool {
        if a == b {
            return true;
        }
        match self.alphabet {
            Alphabet::Letters => word::same_family(a, b),
            Alphabet::Phonemes => match (self.stems.get(a), self.stems.get(b)) {
                (Some(x), Some(y)) => x == y,
                _ => false,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pronunciations for a word, in CMUdict's own order — so the first is primary.
    fn said(pairs: &[(&str, &[&str])]) -> Pronunciations {
        pairs
            .iter()
            .map(|(word, tokens)| {
                ((*word).to_string(), tokens.iter().map(|t| (*t).to_string()).collect())
            })
            .collect()
    }

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().map(|w| (*w).to_string()).collect()
    }

    #[test]
    fn homophones_are_one_token_with_several_spellings() {
        let lex = Lexicon::phonemes(
            &words(&["right", "write", "wright"]),
            &words(&["right", "write"]),
            &said(&[("right", &["bFe"]), ("write", &["bFe"]), ("wright", &["bFe"])]),
            &[("write".to_string(), 100), ("right".to_string(), 10)].into_iter().collect(),
        );
        assert_eq!(lex.common, vec!["bFe".to_string()]);
        // One node, and it is drawn as the most familiar ordinary spelling of the three.
        assert_eq!(lex.label("bFe"), "right");
        assert_eq!(lex.labels("bFe").len(), 3);
        // `wright` is legal but not common, so it sorts last however frequent it is.
        assert_eq!(lex.labels("bFe")[2], "wright");
    }

    #[test]
    fn will_not_draw_a_sound_as_a_word_that_is_usually_said_otherwise() {
        // `/kən/` is `can`'s *second* pronunciation — its first is `/kæn/` — and the same is
        // true of `con`. Drawing that node as `can` puts a word on the board whose ordinary
        // reading is a different sound, which is the complaint that produced this rule. With
        // no word to stand for it honestly, the node is drawn as all of them.
        let lex = Lexicon::phonemes(
            &words(&["can", "con"]),
            &words(&["can", "con"]),
            &said(&[("can", &["TBW", "TCW"]), ("con", &["TAW", "TCW"])]),
            &FxMap::default(),
        );
        assert!(!lex.is_primary("TCW"));
        assert_eq!(lex.label("TCW"), "can/con");
        // And the ones that *are* somebody's ordinary reading are drawn as that word.
        assert!(lex.is_primary("TBW"));
        assert_eq!(lex.label("TBW"), "can");
    }

    #[test]
    fn prefers_a_word_that_says_it_first_over_a_more_familiar_one_that_does_not() {
        // `rare` is the only word whose *primary* reading this is, so it wins over `common`
        // however much more often `common` is written — a label has to be a word somebody
        // would read as the sound on the board.
        let rank = [("common".to_string(), 1), ("rare".to_string(), 90_000)]
            .into_iter()
            .collect();
        let lex = Lexicon::phonemes(
            &words(&["common", "rare"]),
            &words(&["common", "rare"]),
            &said(&[("common", &["TAV", "cKe"]), ("rare", &["cKe"])]),
            &rank,
        );
        assert_eq!(lex.label("cKe"), "rare");
        // Both still play: only which one is drawn changed.
        assert_eq!(lex.labels("cKe"), words(&["rare", "common"]).as_slice());
    }

    #[test]
    fn a_spelling_said_two_ways_is_two_tokens() {
        let lex = Lexicon::phonemes(
            &words(&["read"]),
            &words(&["read"]),
            &said(&[("read", &["bKI", "bRI"])]),
            &FxMap::default(),
        );
        assert_eq!(lex.common, vec!["bKI".to_string(), "bRI".to_string()]);
        assert_eq!(lex.label("bKI"), "read");
        assert_eq!(lex.label("bRI"), "read");
    }

    #[test]
    fn a_spelling_cmudict_lacks_is_not_in_the_alphabet() {
        let lex = Lexicon::phonemes(
            &words(&["cat", "abaciscus"]),
            &words(&["cat"]),
            &said(&[("cat", &["TBe"])]),
            &FxMap::default(),
        );
        assert_eq!(lex.legal, vec!["TBe".to_string()]);
    }

    #[test]
    fn a_token_is_the_family_of_the_spelling_it_is_drawn_as() {
        // `bake` and `baking` are one family, and the question has to survive being asked
        // about their pronunciations rather than their spellings.
        let lex = Lexicon::phonemes(
            &words(&["bake", "baking", "cat"]),
            &words(&["bake", "baking", "cat"]),
            &said(&[("bake", &["GMT"]), ("baking", &["GMTQX"]), ("cat", &["TBe"])]),
            &FxMap::default(),
        );
        assert!(lex.same_family("GMT", "GMTQX"));
        assert!(!lex.same_family("GMT", "TBe"));
        // A run of phonemes that is not a word has no family but itself. This is what
        // `is_compound_swap` asks about the halves of a token it has split.
        assert!(!lex.same_family("GM", "GMT"));
        assert!(lex.same_family("GM", "GM"));
    }

    #[test]
    fn the_letters_alphabet_answers_exactly_as_it_always_did() {
        let lex = Lexicon::letters(words(&["car", "cars"]), words(&["car"]));
        assert!(lex.same_family("car", "cars"));
        assert!(lex.same_family("bake", "baking"));
        assert!(!lex.same_family("cage", "courage"));
        assert_eq!(lex.label("anything"), "anything");
    }
}
