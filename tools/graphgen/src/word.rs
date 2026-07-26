//! What a pair of words means to each other.
//!
//! The three questions the taste filters keep asking, in one place: how can this
//! pair be read as one insertion, are these two the same word in different
//! clothes, and is this middle word just its neighbours glued together. They were
//! previously inlined into the filters as one-off string surgery, which is why the
//! swap rule only ever caught the exact case and missed `nations → carnations →
//! cars`.
//!
//! `readings` is deliberately the same definition as `insertionSpots` in
//! src/lib/moves.ts, which is the client's version of the same question. Two
//! implementations is the price of the builder needing this over 190k words while
//! the client needs it per keystroke; keeping them to the same *definition* is
//! what stops the two sides from disagreeing about what a move is.

/// One way a pair can be read: the run at `pos` in the longer word, `len` long.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reading {
    pub pos: usize,
    pub len: usize,
}

impl Reading {
    /// Strictly inside the longer word — the move that finds a word in a word,
    /// rather than gluing one onto an end.
    pub fn is_internal(&self, longer_len: usize) -> bool {
        self.pos > 0 && self.pos + self.len < longer_len
    }
}

/// Every way a contiguous run could be inserted into `shorter` to give `longer`.
///
/// Brute force over positions, because repeated letters mean there can genuinely
/// be several readings and the game accepts any of them: `lifetime → lime` can be
/// read as dropping `ifet` or `feti`, and a filter that looks at only one reading
/// is judging a move the player may not be making.
pub fn readings(shorter: &str, longer: &str) -> Vec<Reading> {
    if longer.len() <= shorter.len() {
        return Vec::new();
    }
    let gap = longer.len() - shorter.len();
    let mut found = Vec::new();
    for pos in 0..=(longer.len() - gap) {
        if longer[..pos] == shorter[..pos] && longer[pos + gap..] == shorter[pos..] {
            found.push(Reading { pos, len: gap });
        }
    }
    found
}

/// Order a pair shortest-first, which every question here is asked in terms of.
pub fn by_length<'a>(a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    if a.len() <= b.len() {
        (a, b)
    } else {
        (b, a)
    }
}

/// Endings that make one word another form of the same word.
const INFLECTIONS: &[&str] = &[
    "s", "es", "ies", "ed", "d", "ing", "ings", "er", "ers", "est", "ly", "y", "like", "ness",
    "less", "ful", "fully", "able", "ible", "ment", "ments", "ion", "ions", "tion", "tions",
    "ish", "ist", "ists", "ive", "ity", "ities", "ance", "ence", "ize", "ized", "izes", "eth",
];

/// Are these the same word in different clothes?
///
/// `car`/`cars`, `carry`/`carries`, `bake`/`baking`, `stop`/`stopping`. A puzzle
/// that contains both members of a family somewhere on its route has a move that
/// is bookkeeping rather than discovery, and — the case that mattered — a compound
/// swap can hide behind an inflection: `carnations` is `car` glued to `nations`,
/// so reaching `cars` from `nations` through it discovers nothing, even though no
/// two of those three words are literally concatenated.
pub fn same_family(a: &str, b: &str) -> bool {
    let (short, long) = by_length(a, b);
    if short == long {
        return true;
    }
    for ending in INFLECTIONS {
        if long.len() <= short.len() || !long.ends_with(ending) {
            continue;
        }
        let stem = &long[..long.len() - ending.len()];
        if stem == short {
            return true;
        }
        // carry -> carries: stem "carr" against short "carry"
        if short.ends_with('y') && stem == &short[..short.len() - 1] {
            return true;
        }
        // stop -> stopping: stem "stopp" against short "stop"
        if stem.len() == short.len() + 1
            && stem.starts_with(short)
            && stem.as_bytes().last() == short.as_bytes().last()
        {
            return true;
        }
        // bake -> baking: stem "bak" against short "bake"
        if short.ends_with('e') && stem == &short[..short.len() - 1] {
            return true;
        }
    }
    false
}

/// Shortest part a glued word can be split into. Below this the halves are
/// fragments rather than words, and family comparison starts finding nonsense.
const MIN_PART: usize = 2;

/// Is `whole` these two words glued together, in either order, allowing either to
/// appear as another form of itself?
fn is_glued_from(whole: &str, x: &str, y: &str) -> bool {
    if whole.len() < MIN_PART * 2 {
        return false;
    }
    (MIN_PART..=whole.len() - MIN_PART).any(|cut| {
        let (left, right) = whole.split_at(cut);
        (same_family(left, x) && same_family(right, y))
            || (same_family(left, y) && same_family(right, x))
    })
}

/// Do three consecutive words on a route merely split or merge a compound?
///
/// The degenerate shape is `while` + `mean` = `meanwhile`, then drop `while` and
/// land on `mean`: the word added last turn becomes the whole word this turn, so
/// nothing was found inside anything. Phrased over words rather than subwords it
/// is symmetric and free of the ambiguity that dogs subword readings — the middle
/// word is its neighbours glued together, in either order, or the first word is.
///
/// Family-aware, which is the whole point: `coast → coastlands → lands` was always
/// caught, but `nations → carnations → cars` was not, and it is the same move.
pub fn is_compound_swap(a: &str, b: &str, c: &str) -> bool {
    is_glued_from(b, a, c) || is_glued_from(a, b, c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_insertion_point() {
        // Three ways, and the client's insertionSpots finds the same three: b·aseb·all
        // and ba·seba·ll are real readings of the edit even though only `base` is a
        // word. Enumerating all of them is what lets the caller pick the one that is.
        assert_eq!(
            readings("ball", "baseball"),
            vec![
                Reading { pos: 0, len: 4 },
                Reading { pos: 1, len: 4 },
                Reading { pos: 2, len: 4 },
            ]
        );
        // all -> ball: only one way.
        assert_eq!(readings("all", "ball"), vec![Reading { pos: 0, len: 1 }]);
        // Repeated letters give genuinely several readings.
        assert_eq!(readings("lime", "lifetime").len(), 2);
        assert!(readings("cage", "courage").iter().any(|r| r.pos == 1 && r.len == 3));
        assert!(readings("baseball", "ball").is_empty());
    }

    #[test]
    fn knows_internal_from_boundary() {
        // courage -> cage removes "our" from strictly inside.
        let inside = readings("cage", "courage");
        assert!(inside.iter().any(|r| r.is_internal("courage".len())));
        // base -> baseball glues "ball" onto the end.
        let glued = readings("base", "baseball");
        assert!(!glued.iter().any(|r| r.is_internal("baseball".len())));
    }

    #[test]
    fn groups_inflections_into_families() {
        for (a, b) in [
            ("car", "cars"),
            ("carry", "carries"),
            ("bake", "baking"),
            ("stop", "stopping"),
            ("land", "lands"),
            ("border", "borders"),
        ] {
            assert!(same_family(a, b), "{a} and {b} should be one family");
            assert!(same_family(b, a), "family test must be symmetric");
        }
        for (a, b) in [("coast", "borders"), ("cage", "courage"), ("lands", "islands")] {
            assert!(!same_family(a, b), "{a} and {b} are different words");
        }
    }

    #[test]
    fn catches_compound_swaps_through_an_inflection() {
        // The case that was always caught: exact concatenation.
        assert!(is_compound_swap("coast", "coastlands", "lands"));
        // The case that was missed: "car" arrives, "cars" leaves.
        assert!(is_compound_swap("nations", "carnations", "cars"));
        // And with the inflection on the other side.
        assert!(is_compound_swap("lands", "borderlands", "borders"));
        assert!(is_compound_swap("day", "daydreams", "dreams"));
        // A word found strictly inside another is not a swap.
        assert!(!is_compound_swap("courage", "cage", "rage"));
        assert!(!is_compound_swap("showed", "shadowed", "sowed"));
    }
}
