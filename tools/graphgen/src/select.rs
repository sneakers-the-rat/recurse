//! Choosing which puzzles to offer.
//!
//! Legality and quality are kept strictly apart. Every move in the legal graph
//! stays playable no matter what happens here; these filters only decide which
//! *puzzles* get offered, so that the intended solution is fair and interesting.
//!
//! Filters run cheapest first, because the last one — proving par cannot be
//! beaten anywhere in the 190k-word graph — is by far the most expensive.


use crate::config::{Alphabet, Audit, Mode};
use crate::graph::{Bfs, FxMap, FxSet, Graph, UNREACHED};
use crate::id::puzzle_id;
use crate::progress::{Progress, BATCH};
use crate::lexicon::Lexicon;
use crate::word::{by_length, is_compound_swap, readings};

#[derive(Debug, Clone)]
pub struct Puzzle {
    /// The puzzle's public address: a digest of the game and its two words, sorted. See id.rs.
    ///
    /// Stamped here rather than anywhere later because this is where a puzzle comes into
    /// existence — but it is **recomputed on the way out of the bank cache**, the same as
    /// `band` and for the same reason: the search does not depend on it, so the formula is
    /// deliberately not part of what the cache is keyed on. See `build_mode`.
    pub id: String,
    /// The first day of the calendar this puzzle appears on, assigned by `calendar::deal`.
    /// Metadata rather
    /// than an address — no URL carries it — but it is what the header calls the
    /// puzzle and what the client looks up to find today's board.
    pub day: usize,
    pub source: String,
    pub target: String,
    pub par: u32,
    pub corridor_size: usize,
    pub alt_nodes: usize,
    pub shortest_paths: u64,
    pub max_rank: usize,
    /// Moves in the best route the *legal* graph allows, when that is fewer than
    /// par — a corner some rarer word cuts. Zero when there is no such shortcut.
    ///
    /// Par is measured over common words, so it is the best anyone is expected to
    /// find. A rarer word beating it used to disqualify the puzzle, which threw
    /// away 33,000 candidates to protect a claim nobody needs: a player who finds
    /// one has done something better than solving it, and the game should say so.
    pub secret: u32,
    /// The board this puzzle declares: its ways through and a little of what joins them,
    /// encoded for the shard files. See board.rs — the client draws exactly this.
    pub board: String,
    /// Which band this is, indexing the manifest's flattened list across every mode — so
    /// the letters mode's three lengths are 0, 1, 2 and the phonemes mode's are 3, 4, 5.
    ///
    /// Set where the puzzle is built rather than by `schedule`, because par divides a
    /// *mode's* bands and `schedule` runs once over the merged bank. See `Mode::band_of`.
    /// Recomputed when a bank is read back from the cache, because `bandCuts` is not part
    /// of the cache key — see `build_mode`.
    pub band: usize,
}

/// Fewest words a board may have and still be worth drawing.
const MIN_BOARD: usize = 10;

/// Words off the answer a board needs per move of it, for `OffRouteTooFew`.
const OFF_ROUTE_PER_MOVE: usize = 2;

/// How far past par the search for a way out of the source will look, as a multiple
/// of par. A bound on pointless work rather than a property of a good puzzle: a
/// branch that has to wander further than this to reach the target is not a route
/// any answer presents.
const BRANCH_REACH: u32 = 3;

// The two frequency lists — `tooFrequent` and `tooFrequentClusters` — live in
// `recurse.yaml`, per mode, because exposure is a property of one graph: a hub of the
// spelling graph means nothing to the sound one, and a list tuned for one game applied to
// another refuses puzzles for a reason that was never measured there.
//
// **Not the content blocklist.** `tools/blocklist.txt` is about words nobody wants to read;
// these are about words everybody has read already this week. Both are bans and they are
// answering opposite questions, so they are kept apart: a word here is perfectly good and
// simply overexposed, and the lists should shrink as a corpus grows rather than being tuned
// for taste. A word on one still **plays**: it is legal, it is drawn, and a route through it
// is a perfectly good thing to find. What it may not be is on the answer a puzzle advertises.
//
// `tooFrequent` bans a word outright. `tooFrequentClusters` bans **combinations**, because a
// set is really one hub wearing several names: `cons → contractions → ions` is a fixed
// three-step, and `npm run data -- routes cons contractions ions` finds all three on one
// answer 7,119 times — exactly as often as it finds any two. Banning a single member would
// leave the others doing the same work, while banning all three outright would cost three
// times as much of the bank as the problem is worth. A puzzle is refused when one answer
// walks the whole of *any* one set, in any order or position — see `all_on_one_route`.

/// Every reason a candidate pair can be refused.
///
/// Named rather than counted, because tuning taste means knowing which rule threw
/// a puzzle out — and, more to the point, which rule is the *only* one that would
/// have. A cascade of `continue`s can only ever report the first reason each
/// candidate hit, which makes a rule that runs late look cheap when it is not.
/// Rules deliberately *not* here, having been tried and removed as bad for the
/// game rather than good for it:
///
/// * A degree ceiling on the words in the middle of an answer ("rhyme hubs"). It
///   refused five candidates in six, because it was really catching every word
///   that is also an affix — `over`, `less`, `able` — at a threshold below the
///   25th percentile of the distribution. What it was reaching for is covered,
///   and covered more precisely, by the compound-swap and internal-move rules.
/// * A ceiling on how many words the board would draw. That is the client's
///   business: it has its own budget and trims to fit. It was the single most
///   expensive rule in the bank for a reason that no longer existed.
/// * A ceiling on how many equally short answers a puzzle may have, whether phrased
///   as taste or as a cap on the route walk. Several ways through is a strength, so
///   every answer of exactly par is enumerated and judged.
/// * A rarer word beating par. Now a *secret*, not a rejection — see `secret` on
///   Puzzle. Finding one is the best thing that can happen to a player.
/// * Refusing a puzzle because one of its endpoints appears in another puzzle.
///   Endpoint reuse is a matter of *calendar order* — see calendar.rs, which never
///   rejects anything.
/// * A ceiling on par. Par is a difficulty statistic, recorded on every puzzle;
///   `maxPar` bounds the search and nothing else.
///
/// Every filter that can remove a puzzle from the bank is a variant here. A filter
/// outside this enum is a filter nobody is auditing — which is exactly what
/// `ReverseAlreadyAdded` was before it had a name. Dropping one direction of every pair
/// happened in the candidate enumeration, where it looked like arithmetic rather than taste,
/// and it silently decided which end of every puzzle is the source. See `judge_candidates`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Rule {
    BoardTooSmall,
    NoAlternatives,
    OffRouteTooFew,
    NoLateBranch,
    OpeningForced,
    NotInLegalGraph,
    SameFamilyOnRoute,
    CompoundSwap,
    NoInternalMove,
    ReverseAlreadyAdded,
    ContainsTooFrequentWord,
    ContainsTooFrequentCluster,
}

impl Rule {
    pub const ALL: [Rule; 12] = [
        Rule::BoardTooSmall,
        Rule::NoAlternatives,
        Rule::OffRouteTooFew,
        Rule::NoLateBranch,
        Rule::OpeningForced,
        Rule::NotInLegalGraph,
        Rule::SameFamilyOnRoute,
        Rule::CompoundSwap,
        Rule::NoInternalMove,
        Rule::ReverseAlreadyAdded,
        Rule::ContainsTooFrequentWord,
        Rule::ContainsTooFrequentCluster,
    ];

    /// What the rule asks, and the knob that sets it.
    pub fn describe(self) -> (&'static str, &'static str) {
        match self {
            Rule::BoardTooSmall => ("nothing around the answer to weigh", "10, fixed"),
            Rule::NoAlternatives => ("no genuine longer way round", "minAltNodes"),
            Rule::OffRouteTooFew => ("too little off the answer for its length", "2 x par, fixed"),
            Rule::NoLateBranch => ("nothing joins the answer past halfway", "par / 2, fixed"),
            // Asked of the source, and a pair is offered both ways round, so what it refuses
            // is a pair with a branch at *neither* end.
            Rule::OpeningForced => {
                ("first move is forced — no branch at the root", "minSourceMoves")
            }
            Rule::NotInLegalGraph => ("an endpoint has no moves in the legal graph", "none"),
            Rule::SameFamilyOnRoute => ("two words on the answer are the same word", "none"),
            Rule::CompoundSwap => ("answer splits or merges a compound", "maxSwaps"),
            Rule::NoInternalMove => {
                ("too few moves find a word inside a word", "max(MIN_INTERNAL, par/2-1)")
            }
            Rule::ReverseAlreadyAdded => ("the same pair the other way round", "none"),
            Rule::ContainsTooFrequentWord => {
                ("the answer runs through an overexposed word", "tooFrequent")
            }
            Rule::ContainsTooFrequentCluster => {
                ("the answer walks a whole overexposed cluster", "tooFrequentClusters")
            }
        }
    }

    /// What the rule has to look at, which is what decides the order they run in.
    pub fn needs(self) -> Needs {
        match self {
            Rule::ReverseAlreadyAdded => Needs::Mirror,
            Rule::ContainsTooFrequentWord | Rule::ContainsTooFrequentCluster => Needs::Distance,
            Rule::SameFamilyOnRoute | Rule::CompoundSwap | Rule::NoInternalMove => Needs::Chain,
            Rule::BoardTooSmall
            | Rule::NoAlternatives
            | Rule::OffRouteTooFew
            | Rule::NoLateBranch
            | Rule::OpeningForced
            | Rule::NotInLegalGraph => Needs::Neighbourhood,
        }
    }

    pub fn slot(self) -> usize {
        Rule::ALL.iter().position(|&r| r == self).expect("every rule is in ALL")
    }
}

/// How much a rule has to look at to answer.
///
/// This is the difference between a rule that costs nothing and a rule that costs
/// most of the build, so it decides the order they are judged in: every `Chain` rule
/// runs before any `Neighbourhood` rule.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Needs {
    /// Whether the same pair the other way round was already kept, which is a boolean
    /// the worker is holding. Free, so it is asked first.
    Mirror,
    /// Two entries of the endpoint distance tables, which are built before any candidate is
    /// judged. Cheaper than reading the answers, because it never has to find them: a word lies
    /// on some shortest route exactly when its distances to the two ends add up to par.
    Distance,
    /// The words on the answers, and nothing else. The answers come out of a walk of
    /// the route DAG over distances that are already tabulated, so no search and no
    /// scan is involved — a few string tests over seven words.
    Chain,
    /// The graph around the answer: a scan of the neighbourhood, or a search through
    /// it. Two to three orders of magnitude dearer than a `Chain` rule.
    Neighbourhood,
}

impl Needs {
    pub fn label(self) -> &'static str {
        match self {
            Needs::Mirror => "mirror",
            Needs::Distance => "dist",
            Needs::Chain => "chain",
            Needs::Neighbourhood => "graph",
        }
    }
}

/// Longest par a tally has a column for. `maxPar` is bounded well inside this, and
/// a par past it is counted in the last column rather than panicking a build over a report.
pub const PAR_SLOTS: usize = 16;

/// One tally per rule *per par*, sized from `Rule::ALL`.
///
/// Per par because that is the question tuning actually asks. A rule that refuses a tenth of
/// the bank is doing something quite different depending on whether that tenth is spread over
/// every length or is the whole of par 10 — and the rules that scale with par (see
/// `internal_wanted`, `OffRouteTooFew`, `NoLateBranch`) cannot be read any other way.
pub type Tally = [[usize; PAR_SLOTS]; Rule::ALL.len()];

/// A fresh grid. `[[0; _]; _]` inline everywhere reads as noise.
pub fn empty_tally() -> Tally {
    [[0; PAR_SLOTS]; Rule::ALL.len()]
}

/// Which column a par counts in.
pub fn par_slot(par: u32) -> usize {
    (par as usize).min(PAR_SLOTS - 1)
}

/// How each rule fared over every candidate, independent of the others.
///
/// Both grids are per rule per par; the totals are sums along a row. See `Tally`.
#[derive(Debug, Clone)]
pub struct Rejections {
    /// Candidates each rule refused, whether or not any other rule also did.
    pub alone: Tally,
    /// Candidates each rule was the *only* objection to — what relaxing it buys.
    pub only: Tally,
}

impl Default for Rejections {
    fn default() -> Rejections {
        Rejections { alone: empty_tally(), only: empty_tally() }
    }
}

impl Rejections {
    pub fn from_tallies(alone: &Tally, only: &Tally) -> Rejections {
        Rejections { alone: *alone, only: *only }
    }

    /// One rule's whole row: what it refused at every par.
    pub fn total(grid: &Tally, rule: Rule) -> usize {
        grid[rule.slot()].iter().sum()
    }
}

/// Can this pair be joined by removing a run from strictly inside the longer word?
///
/// Computed from the pair rather than looked up, so it works on the legal graph
/// without materialising a set over its 269k edges.
fn has_internal_reading(a: &str, b: &str, is_word: &dyn Fn(&str) -> bool, min_sub: usize) -> bool {
    let (short, long) = by_length(a, b);
    readings(short, long).iter().any(|reading| {
        reading.len >= min_sub
            && reading.is_internal(long.len())
            && is_word(&long[reading.pos..reading.pos + reading.len])
    })
}

/// Does every intended answer make an interesting puzzle?
///
/// Judged on the *common* graph, over routes of exactly par, because that is the
/// answer the puzzle advertises and the only one the board shows. The legal graph
/// is a different question: it can cut the corner with a rarer word, and that is a
/// secret to be found rather than a route to be judged. Judging the legal best
/// instead meant that on two puzzles in five the rules were vetting a line the
/// player was never expected to walk — `grand → grandmaster → ster → slaughter`
/// passed on the strength of `ster`.
///
/// Reports every rule any answer breaks, not just the first: the audit needs to
/// know that a puzzle would have been refused for two independent reasons, because
/// a rule that only ever fires alongside another one is not earning its place.
#[allow(clippy::too_many_arguments)]
fn judge_solutions(
    common: &Graph,
    subs: &FxSet<&str>,
    src: u32,
    tgt: u32,
    depth_from_tgt: &dyn Fn(u32) -> u32,
    mode: &Mode,
    lex: &Lexicon,
    stop_early: bool,
    broken: &mut Vec<Rule>,
) {
    // One buffer for the whole walk, pushed and popped as it descends. The answer
    // reads source-first, which is the order the swap rule is defined in.
    let mut path: Vec<u32> = Vec::with_capacity(mode.max_par + 1);
    path.push(src);
    descend(common, subs, tgt, depth_from_tgt, mode, lex, stop_early, broken, &mut path);
}

/// Walk every answer of exactly par, depth first, judging each as it completes.
///
/// The route DAG is walked forwards from the source using distances *to the target*:
/// a step is any neighbour one closer, and every such walk arrives in exactly par
/// moves, so this enumerates the answers and nothing else.
///
/// `path` is one buffer for the whole walk — pushed on the way down, popped on the way
/// back up. A candidate averages a handful of answers but a hub-heavy one can have
/// thousands, and cloning the path at every branch made the number of allocations a
/// multiple of the number of DAG edges rather than of the answers.
#[allow(clippy::too_many_arguments)]
fn descend(
    common: &Graph,
    subs: &FxSet<&str>,
    tgt: u32,
    depth_from_tgt: &dyn Fn(u32) -> u32,
    mode: &Mode,
    lex: &Lexicon,
    stop_early: bool,
    broken: &mut Vec<Rule>,
    path: &mut Vec<u32>,
) {
    let last = *path.last().expect("never empty");
    if last == tgt {
        judge_one_answer(common, subs, path, mode, lex, broken);
        return;
    }

    let depth = depth_from_tgt(last);
    for &next in common.neighbors(last) {
        // One refusal is enough for a plain build, and there is no more to learn once
        // every rule a walk can find has fired.
        if stop_early && !broken.is_empty() {
            return;
        }
        let closer = depth_from_tgt(next);
        if closer != UNREACHED && closer + 1 == depth {
            path.push(next);
            descend(common, subs, tgt, depth_from_tgt, mode, lex, stop_early, broken, path);
            path.pop();
        }
    }
}

/// The three chain rules, against one complete answer.
///
/// Reads only the words on the answer, so it costs no search and no scan — which is
/// why these run before anything that touches the neighbourhood.
fn judge_one_answer(
    common: &Graph,
    subs: &FxSet<&str>,
    path: &[u32],
    mode: &Mode,
    lex: &Lexicon,
    broken: &mut Vec<Rule>,
) {
    // No two words anywhere on the route may be forms of the same word.
    let family_clash = (0..path.len()).any(|i| {
        ((i + 1)..path.len())
            .any(|j| lex.same_family(common.word(path[i]), common.word(path[j])))
    });
    if family_clash {
        note(broken, Rule::SameFamilyOnRoute);
    }

    let swaps = path
        .windows(3)
        .filter(|w| is_compound_swap(lex, common.word(w[0]), common.word(w[1]), common.word(w[2])))
        .count();
    if swaps > mode.max_swaps {
        note(broken, Rule::CompoundSwap);
    }

    let is_word = |w: &str| subs.contains(w);
    let internal = path
        .windows(2)
        .filter(|w| {
            has_internal_reading(common.word(w[0]), common.word(w[1]), &is_word, mode.min_sub)
        })
        .count();
    if internal < internal_wanted(mode, (path.len() - 1) as u32) {
        note(broken, Rule::NoInternalMove);
    }
}

/// How many of an answer's moves have to find a word *inside* a word, at this par.
///
/// Finding a word inside a word is the move the game is about; gluing one onto the end is the
/// move anybody can see. One of them is enough to make a three-move answer a puzzle, but a
/// ten-move answer made of nine compound joins and one discovery is a long walk with one idea
/// in it — so what is asked scales with the length: `par / 2 - 1`, floored at the knob.
///
///     par  3 4 5 6 7 8 9 10
///     want 1 1 1 2 2 3 3 4
fn internal_wanted(mode: &Mode, par: u32) -> usize {
    mode.min_internal.max((par as usize / 2).saturating_sub(1))
}

/// Record a broken rule once, however many answers break it.
fn note(broken: &mut Vec<Rule>, rule: Rule) {
    if !broken.contains(&rule) {
        broken.push(rule);
    }
}

/// The words a puzzle draws.
///
/// One filter, and it produces exactly what ships. The board used to be a ball around the
/// answer with its dead ends pruned off, which is a different filter reaching for the same
/// thing and needing a second one on top: a ball wide enough to hold an alternative holds
/// hundreds of words that are not on one, and pruning degree-1 nodes removes spurs without
/// distinguishing a genuine way round from a bulge on the answer.
///
/// So the board is built out of routes instead of pared down to them:
///
/// 1. **The answer**, and every other route of exactly par — gold. Found by blocking one
///    interior word at a time and asking again, so a puzzle with several equally short answers
///    shows all of them and not whichever the walk happened to find first.
/// 2. **A second way out of each end.** Both ends, because the player stands on both: the goal
///    is somewhere to guess from, so a board that offers a choice at the source and a single
///    line into the goal offers one to whoever happens to play it forwards. Cheap, in practice
///    — the two branches usually rejoin the answer, and the words they pass through are
///    largely words some other route already declared.
/// 3. **Longer ways round** — green. Same trick as 1, allowing `alt_slack` extra moves, and kept
///    only if the route spends `min_divergence` consecutive words away from everything already
///    on the board. That last test is the whole difference between a board that shows a choice
///    and one that shows the answer with warts: in a graph averaging 2.1 moves per word almost
///    any neighbour of the answer can step off it and back a move later, and those detours are
///    worthless. Requiring the route to *stay* away is what a player means by another way.
/// 4. **What joins them** — words with at least two neighbours already on the board, best
///    connected first, capped at `around_percent` of it. Two and not one, because one drawn
///    neighbour is a spur that says only "there is more graph out here", while two shows the
///    ways through are one neighbourhood rather than parallel lines.
#[allow(clippy::too_many_arguments)]
pub fn board_words(
    common: &Graph,
    src: u32,
    tgt: u32,
    par: u32,
    from_src: &dyn Fn(u32) -> u32,
    from_tgt: &dyn Fn(u32) -> u32,
    mode: &Mode,
    bfs: &mut Bfs,
) -> Vec<u32> {
    let empty: FxSet<u32> = FxSet::default();
    let Some(primary) = bfs.route_avoiding(common, src, tgt, &empty, par) else {
        return Vec::new();
    };
    let mut live: FxSet<u32> = primary.iter().copied().collect();
    let interior: Vec<u32> = primary
        .iter()
        .copied()
        .filter(|&w| w != src && w != tgt)
        .collect();

    let mut blocked: FxSet<u32> = FxSet::default();
    for &pivot in &interior {
        blocked.clear();
        blocked.insert(pivot);
        if let Some(route) = bfs.route_avoiding(common, src, tgt, &blocked, par) {
            live.extend(route.iter().copied());
        }
    }

    let limit = par + mode.alt_slack as u32;

    // A second way out of **each end**, whatever it costs in divergence.
    //
    // `OpeningForced` promised the first move is a choice, and a promise about the graph is not
    // a promise about the drawing: if every route drawn so far leaves by the same word, the
    // board shows one way out and the guarantee is invisible.
    //
    // Both ends, because the player stands on both. A move is an insertion or a removal and the
    // two are inverses, so a round can be worked backwards from the goal (see `isFront` in
    // game.ts) — and a board that branches at the source and runs into the goal as a single line
    // hands the player a forced move whenever they work that way. Which was invisible while only
    // the source could be played from, and is the first thing you notice once it can't be.
    //
    // Routed *from* the other neighbour rather than found by blocking the answer's own first
    // move, and the difference is the whole of why this needs its own step. `overstated →
    // zincking` leaves by `over` or by `stated`, and `stated`'s way onward runs through `over` —
    // so blocking `over` to force a detour finds nothing at all, while walking forward from
    // `stated` finds a perfectly good second opening that merges onto the answer one move later.
    // A branch that merges immediately is still a branch, which is exactly what the rule counted
    // when it let the puzzle through.
    //
    // Searched at the *rule's* reach, not the alternative-route limit. `OpeningForced` counts a
    // branch that comes back within `BRANCH_REACH * par`, so that is how far the board has to be
    // willing to follow one: `restart → railroading` is a par-8 puzzle whose second way out
    // needs fourteen moves to return, which the rule allows and a search bounded at
    // `par + alt_slack` cannot reach. Promising a choice and then drawing one way out is worse
    // than either.
    let opening_reach = par.saturating_mul(BRANCH_REACH);
    // Each end, with the answer's own step away from it — the one move that is not a second
    // way — and where a branch off it has to get back to.
    let ends: [(u32, Option<u32>, u32, &dyn Fn(u32) -> u32); 2] = [
        (src, interior.first().copied(), tgt, from_tgt),
        (tgt, interior.last().copied(), src, from_src),
    ];
    for (end, own_step, other, toward_other) in ends {
        let Some(first) = own_step else { continue };
        let mut others: Vec<u32> = common
            .neighbors(end)
            .iter()
            .copied()
            .filter(|&w| w != first && w != other)
            .collect();
        // Nearest the far end first, so the branch drawn is the one a player would most likely
        // try; the id breaks ties so a rebuild draws the same board.
        others.sort_unstable_by_key(|&w| (toward_other(w), w));
        for word in others {
            blocked.clear();
            blocked.insert(end);
            if let Some(route) = bfs.route_avoiding(common, word, other, &blocked, opening_reach) {
                live.insert(end);
                live.extend(route.iter().copied());
                break;
            }
        }
    }

    let mut ways = 0;
    for &pivot in &interior {
        if ways >= mode.max_alt_ways {
            break;
        }
        blocked.clear();
        blocked.insert(pivot);
        let Some(route) = bfs.route_avoiding(common, src, tgt, &blocked, limit) else {
            continue;
        };
        if diverges(&route, &live) < mode.min_divergence {
            continue;
        }
        live.extend(route.iter().copied());
        ways += 1;
    }

    // Then what runs *between* the ways through.
    //
    // Without this most boards come out as the answer and one alternative beside it — two
    // chains, parallel, joined only at the ends, which reads as two separate puzzles rather
    // than a neighbourhood with choices in it. The interesting structure is the rungs: the
    // short hops from a word on one chain to a word on another.
    //
    // So: walk outward from everything declared, through *undeclared* words only, up to
    // `link_reach` steps, remembering which declared word each was reached from. Any word
    // reachable from two different ones is on a chain between them, and the chain is recovered
    // by following the parents back. `link_reach` of 1 is the special case of a single word
    // with two declared neighbours; further reaches find the longer rungs, which is where the
    // graph's real texture is.
    let reach = mode.link_reach as u32;
    let mut root: FxMap<u32, u32> = FxMap::default();
    let mut parent: FxMap<u32, u32> = FxMap::default();
    // How many steps off the board each word is, so a rung's cost is known before it is taken.
    let mut depth: FxMap<u32, u32> = FxMap::default();
    let mut frontier: Vec<u32> = live.iter().copied().collect();
    for &word in &frontier {
        root.insert(word, word);
        depth.insert(word, 0);
    }
    // Words joining two chains, with the pair they join, best (shortest) first.
    let mut rungs: Vec<(u32, u32)> = Vec::new();
    for _ in 0..reach {
        let mut next: Vec<u32> = Vec::new();
        for &word in &frontier {
            let from = root[&word];
            for &near in common.neighbors(word) {
                if live.contains(&near) {
                    continue;
                }
                match root.get(&near) {
                    None => {
                        root.insert(near, from);
                        parent.insert(near, word);
                        depth.insert(near, depth[&word] + 1);
                        next.push(near);
                    }
                    // Reached from a second chain: this word is a rung between them.
                    Some(&other) if other != from => rungs.push((near, word)),
                    Some(_) => {}
                }
            }
        }
        frontier = next;
        if frontier.is_empty() {
            break;
        }
    }

    // Take the rungs, cheapest first, until the board has had its share. Each brings its own
    // way back to both chains, because half a rung is a spur.
    // Cheapest first, and that ordering is the difference between the step working and not.
    //
    // A rung costs its whole chain back to the board at both ends, so a reach-1 rung — one word
    // touching two ways through — costs one word, while a reach-3 one costs up to seven. Sorted
    // by word id instead, as this first was, a couple of deep chains that happened to sort early
    // ate the entire budget and the cheap rungs were never reached: 293 boards in 300 still had
    // an untaken single-word rung, which is exactly the cross-link that makes two chains read as
    // one neighbourhood. The id only breaks ties, so a rebuild draws the same board.
    rungs.sort_unstable_by_key(|&(word, touched)| (depth[&word] + depth[&touched], word));
    let room = (live.len() * mode.around_percent) / 100;
    let mut added = 0usize;
    for (word, touched) in rungs {
        if added >= room {
            break;
        }
        // The rung, the word that found it, and the way back from each to the chain it grew
        // from. Both ends matter: leaving out the discoverer leaves the rung attached to a word
        // that is not on the board, which is a dead end wearing a rung's clothes.
        let mut chain: Vec<u32> = vec![word, touched];
        for &start in &[word, touched] {
            let mut at = start;
            while let Some(&up) = parent.get(&at) {
                chain.push(up);
                at = up;
            }
        }
        for step in chain {
            if live.insert(step) {
                added += 1;
            }
        }
    }

    let mut out: Vec<u32> = live.into_iter().collect();
    out.sort_unstable();
    out
}

/// Is a word on *some* shortest route between two ends?
///
/// Exactly when its distances to the two of them add up to par: any more and it is off the
/// answer, and less is impossible. No search — both distances are already tabulated — which is
/// what makes the two frequency rules the cheapest in the file.
pub fn on_some_answer(par: u32, from_src: u32, from_tgt: u32) -> bool {
    from_src != UNREACHED && from_tgt != UNREACHED && from_src + from_tgt == par
}

/// Do all of these words lie on **one** shortest route between the ends, in any order?
///
/// Not the same question as each of them lying on some route of its own: a puzzle can have `a` on
/// one shortest answer and `b` on another with no single answer holding both, and refusing that as
/// "an answer through both" would be a claim about a route nobody can walk.
///
/// The test is every *pair*, and needs no sorting. Write `s(w)` for the distance from the source.
/// A shortest route moves one further from the source at every step, so if one route holds both
/// `a` and `b` then walking between them along it takes exactly `|s(a) - s(b)|` moves, and that is
/// the fewest any route could: `d(a, b) >= |s(a) - s(b)|` always holds. So `d(a, b)` equal to that
/// difference, for every pair, is both necessary and enough — necessary because a route holding
/// them gives it, and enough because the differences then chain: order the words by `s`, and
/// consecutive ones are adjacent-by-distance, so the shortest routes between them join end to end
/// into one route of length par.
///
/// Given as three lookups rather than as data, because the two callers hold the distances in
/// different shapes — the rules in a small precomputed matrix, `show_routes` in whole rows — and
/// two implementations of a rule are two implementations that can disagree.
pub fn all_on_one_route(
    count: usize,
    par: u32,
    from_src: &dyn Fn(usize) -> u32,
    from_tgt: &dyn Fn(usize) -> u32,
    between: &dyn Fn(usize, usize) -> u32,
) -> bool {
    // Nothing is not a cluster: an empty list must refuse nothing rather than everything.
    if count == 0 {
        return false;
    }
    // Every one of them on the answer at all, first: it is one lookup each and it is what fails
    // for almost every candidate.
    if !(0..count).all(|i| on_some_answer(par, from_src(i), from_tgt(i))) {
        return false;
    }
    (0..count).all(|i| {
        ((i + 1)..count).all(|j| between(i, j) == from_src(i).abs_diff(from_src(j)))
    })
}

/// The overexposed words and clusters, resolved against a graph.
///
/// Built once per run and shared: what the two frequency rules need is a handful of word ids and,
/// for the cluster, the distances *between* its members — which the endpoint tables cannot give,
/// and which are properties of the graph rather than of a candidate. Resolving the names per
/// candidate instead meant a hash lookup per listed word per candidate, fifty-five million times
/// over, to answer a question whose answer never changed.
pub struct Overexposed {
    /// The mode's `tooFrequent`, as ids. A name the graph does not have stops the build — see
    /// `nodes_named`.
    words: Vec<u32>,
    /// The mode's `tooFrequentClusters`, one entry each.
    clusters: Vec<Cluster>,
}

/// One set from `tooFrequentClusters`, with what the rule needs to judge it.
struct Cluster {
    ids: Vec<u32>,
    /// `between[i * ids.len() + j]` is the distance from member `i` to member `j`. A property of
    /// the graph rather than of a candidate, and the one thing the endpoint tables cannot give.
    between: Vec<u32>,
}

/// The nodes a ban list's names stand for, one group per name.
///
/// **A ban list is written in ordinary spelling, always.** `reed`, not `/ɹid/` and not `bRI`.
/// The transcription is what the diagnostics *print* and it cannot be typed; the token is exact
/// and unreadable. Neither is a thing to ask a person to write in a config file, and accepting
/// all three would mean a list with three dialects in it.
///
/// A spelling becomes graph nodes here, which is the only place that translation belongs — and
/// in the phonemes alphabet one spelling can be several nodes, since a word said two ways is
/// two sounds. Banning the word bans **every way of saying it**: that is what naming the word
/// means, and the alternative is a syntax for picking a reading, which is the complexity this
/// spec exists to avoid.
///
/// A name that stands for nothing stops the build. It used to be dropped in silence — the
/// phonemes lists were looked up in the *token* index, where a spelling matches nothing, so every
/// entry was ignored and the rule read as working.
fn nodes_named(
    common: &Graph,
    mode: &Mode,
    lex: &Lexicon,
    names: &[String],
) -> Result<Vec<Vec<u32>>, String> {
    names
        .iter()
        .map(|name| {
            let asked = name.trim();
            let heard: Vec<u32> = match mode.alphabet {
                // A word is its own node, so there is nothing to translate.
                Alphabet::Letters => common.id(asked).into_iter().collect(),
                Alphabet::Phonemes => (0..common.words.len() as u32)
                    .filter(|&id| lex.labels(common.word(id)).iter().any(|l| l == asked))
                    .collect(),
            };
            if heard.is_empty() {
                return Err(format!(
                    "mode {}: {name:?} is on a ban list but is not an ordinary word carrying a \
                     move here, so the ban would do nothing",
                    mode.name,
                ));
            }
            if heard.len() > 1 {
                eprintln!(
                    "    {name:?} is said {} ways and all of them are banned: {}",
                    heard.len(),
                    heard
                        .iter()
                        .map(|&id| format!("/{}/", crate::phonetic::to_ipa(common.word(id))))
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            }
            Ok(heard)
        })
        .collect()
}

/// Every choice of one node per name, which is what a cluster of ambiguous words comes to.
///
/// A cluster asks for all of its members on one answer, and a member said two ways is satisfied
/// by either — so the `and` is across the names and the `or` is within one. Each combination
/// becomes its own `Cluster` and an answer walking any of them is refused, which is the same
/// reading `routes` gives the question.
fn one_of_each(groups: &[Vec<u32>]) -> Vec<Vec<u32>> {
    let mut out: Vec<Vec<u32>> = vec![Vec::new()];
    for group in groups {
        out = out
            .into_iter()
            .flat_map(|so_far| {
                group.iter().map(move |&id| {
                    let mut next = so_far.clone();
                    next.push(id);
                    next
                })
            })
            .collect();
    }
    out
}

impl Overexposed {
    pub fn new(common: &Graph, mode: &Mode, lex: &Lexicon) -> Result<Overexposed, String> {
        // One search per member of every cluster, and only the other members read out of it. A
        // dozen sweeps of the common graph, once per run.
        let mut bfs = Bfs::new(common.words.len());
        let mut clusters = Vec::new();
        for names in &mode.too_frequent_clusters {
            for ids in one_of_each(&nodes_named(common, mode, lex, names)?) {
                let mut between = vec![UNREACHED; ids.len() * ids.len()];
                for (i, &from) in ids.iter().enumerate() {
                    bfs.run(common, from, u32::MAX);
                    for (j, &to) in ids.iter().enumerate() {
                        between[i * ids.len() + j] = bfs.get(to);
                    }
                }
                clusters.push(Cluster { ids, between });
            }
        }

        // Every way of saying every banned word. The word rule asks "is any of these on the
        // answer", so a flat list is already the `or` it wants.
        let words = nodes_named(common, mode, lex, &mode.too_frequent)?
            .into_iter()
            .flatten()
            .collect();
        Ok(Overexposed { words, clusters })
    }

    /// Does any answer of exactly par run through a word banned on its own?
    ///
    /// Judged on the **common** graph at par, like every other question about the answer. A puzzle
    /// whose legal shortcut happens to run through one of these words is not refused: the shortcut
    /// is a secret to be found rather than the route the puzzle advertises, and a player who finds
    /// `sing` for themselves has done something the bank did not hand them.
    fn has_word(&self, par: u32, from_src: &dyn Fn(u32) -> u32, from_tgt: &dyn Fn(u32) -> u32) -> bool {
        self.words
            .iter()
            .any(|&id| on_some_answer(par, from_src(id), from_tgt(id)))
    }

    /// Does one answer of exactly par walk the whole of any one cluster?
    ///
    /// Any, because each set is its own hub: an answer that walks the `wing` three-step is as
    /// repetitive as one that walks the `cons` three-step, whether or not it does both. See
    /// `all_on_one_route` for what "the whole of one" means, which is stricter than it sounds.
    fn has_cluster(
        &self,
        par: u32,
        from_src: &dyn Fn(u32) -> u32,
        from_tgt: &dyn Fn(u32) -> u32,
    ) -> bool {
        self.clusters.iter().any(|cluster| {
            let len = cluster.ids.len();
            all_on_one_route(
                len,
                par,
                &|i| from_src(cluster.ids[i]),
                &|i| from_tgt(cluster.ids[i]),
                &|i, j| cluster.between[i * len + j],
            )
        })
    }
}

/// How many of `end`'s moves lead to `other` without coming back through `end`.
///
/// What `OpeningForced` counts, and the whole of what it means by the first move being a
/// choice. Reachability in the common graph with `end` deleted, so a move onto a spur does not
/// count — `passing → bypassing` is a move, but the only way on from `bypassing` is back
/// through `passing`, which is not a choice. Deleting `end` also rules out a route that returns
/// to it, so what survives is a simple path onward.
///
/// The route a branch takes may be any length; the depth limit only stops the search wandering
/// the whole component looking for a way round that no answer would use.
///
/// Named rather than inlined because the question is asked of an *end*, not of the source. The
/// rule asks it of the source only — `OpeningForced` wants a choice at one end, and a pair whose
/// goal has a single way out is still a puzzle — but `board_words` draws a branch at each end,
/// and a count over both ends put 35% of the bank in the branches-at-both camp, which is what a
/// stricter rule would cost.
fn opening_moves(common: &Graph, end: u32, other: u32, par: u32, bfs: &mut Bfs) -> usize {
    bfs.run_without(common, other, par.saturating_mul(BRANCH_REACH), end);
    common
        .neighbors(end)
        .iter()
        .filter(|&&n| n != end && bfs.get(n) != UNREACHED)
        .count()
}

/// The longest run of consecutive words in `route` that are not already on the board.
///
/// A route sharing all but one word with the answer scores 1 — a bulge. One that leaves for
/// three moves and comes back scores 3, and only the second is a way a player would call
/// different.
fn diverges(route: &[u32], live: &FxSet<u32>) -> usize {
    let mut best = 0;
    let mut run = 0;
    for &word in route {
        if live.contains(&word) {
            run = 0;
        } else {
            run += 1;
            best = best.max(run);
        }
    }
    best
}

/// How many distinct shortest paths connect the endpoints.
fn count_shortest_paths(graph: &Graph, src: u32, tgt: u32, par: u32, bfs: &mut Bfs) -> u64 {
    bfs.run(graph, src, par);
    let mut order: Vec<u32> = bfs.touched.clone();
    order.sort_unstable_by_key(|&w| bfs.get(w));
    let mut counts: FxMap<u32, u64> = FxMap::default();
    counts.insert(src, 1);
    for &word in &order {
        if word == src {
            continue;
        }
        let depth = bfs.get(word);
        let total: u64 = graph
            .neighbors(word)
            .iter()
            .filter(|&&p| bfs.get(p) + 1 == depth)
            .filter_map(|p| counts.get(p))
            .sum();
        counts.insert(word, total);
    }
    counts.get(&tgt).copied().unwrap_or(0)
}

pub struct Selection {
    pub puzzles: Vec<Puzzle>,
    pub rejections: Rejections,
    pub candidates: usize,
    /// Candidates that broke no rule, which is the size of the bank.
    pub passed: usize,
}

pub fn select(
    common: &Graph,
    common_subs: &FxSet<&str>,
    legal: &Graph,
    mode: &Mode,
    lex: &Lexicon,
    rank: &FxMap<String, usize>,
    audit: Audit,
    threads: usize,
) -> Result<Selection, String> {
    // One tally per rule: how many candidates it refused, and how many it was the
    // sole objection to.
    let mut alone: Tally = empty_tally();
    let mut only: Tally = empty_tally();

    // Every ordinary word that has a move is a possible endpoint.
    let endpoints: Vec<u32> = (0..common.words.len() as u32)
        .filter(|&id| !common.neighbors(id).is_empty())
        .collect();

    // Distances from every endpoint, computed once.
    //
    // Both ends of a candidate are endpoints, and each endpoint appears in
    // hundreds of candidates, so searching per candidate did the same work over
    // and over — it was 150 of the 153 seconds this used to take. Depths are
    // capped at max_par + slack, comfortably inside a u8, so the whole table is
    // one byte per endpoint per word.
    let far = (mode.max_par + mode.slack) as u32;
    let unreachable_u8 = u8::MAX;
    let mut slot_of: FxMap<u32, usize> = FxMap::default();
    for (slot, &id) in endpoints.iter().enumerate() {
        slot_of.insert(id, slot);
    }

    let mut tables: Vec<Vec<u8>> = Vec::with_capacity(endpoints.len());
    // The words each endpoint can actually reach, which is what a corridor is
    // drawn from. Scanning every connected word per candidate instead was the
    // dominant cost of the whole build: 190k candidates times 12.6k words is 2.4
    // billion tests to find neighbourhoods that average a few hundred words. A
    // corridor node has to be within `far` of *both* ends, so scanning the smaller
    // of the two reachable sets is not an approximation — it is the same answer.
    let mut balls: Vec<Vec<u32>> = Vec::with_capacity(endpoints.len());

    // One search per endpoint, independent of every other, so they run in parallel
    // with a `Bfs` scratch buffer per thread. Chunks are spawned and joined in order,
    // which is what keeps a table's index equal to its endpoint's `slot_of`.
    let table_chunk = endpoints.len().div_ceil(threads.max(1)).max(1);
    let table_progress = Progress::new("distances", endpoints.len());
    std::thread::scope(|scope| {
        scope.spawn(|| table_progress.watch());
        let mut handles = Vec::new();
        for part in endpoints.chunks(table_chunk) {
            let table_progress = &table_progress;
            handles.push(scope.spawn(move || {
                let mut bfs = Bfs::new(common.words.len());
                let mut rows: Vec<Vec<u8>> = Vec::with_capacity(part.len());
                let mut local_balls: Vec<Vec<u32>> = Vec::with_capacity(part.len());
                let mut counted = 0usize;
                for &id in part {
                    let mut row = vec![unreachable_u8; common.words.len()];
                    bfs.run(common, id, far);
                    for &word in &bfs.touched {
                        row[word as usize] = bfs.get(word).min(u8::MAX as u32 - 1) as u8;
                    }
                    rows.push(row);
                    let mut ball = bfs.touched.clone();
                    ball.sort_unstable();
                    local_balls.push(ball);
                    counted += 1;
                    if counted == BATCH {
                        table_progress.advance(counted);
                        counted = 0;
                    }
                }
                table_progress.advance(counted);
                (rows, local_balls)
            }));
        }
        for handle in handles {
            let (rows, local_balls) = handle.join().expect("table worker panicked");
            tables.extend(rows);
            balls.extend(local_balls);
        }
        table_progress.finish();
    });
    let ball_total: usize = balls.iter().map(Vec::len).sum();
    eprintln!(
        "  endpoint distance tables: {} x {} words, reaching {} words each on average",
        tables.len(),
        common.words.len(),
        ball_total / balls.len().max(1)
    );

    // Every pair of endpoints within par range, in one direction.
    //
    // A candidate's target only has to be somewhere in the source's reachable set, so
    // this walks each `ball` rather than every endpoint against every other: the balls
    // average a few thousand words against tens of thousands of endpoints. Sources are
    // independent, so the enumeration runs per thread and the runs are concatenated in
    // order — which is what leaves candidates grouped by source.
    //
    // Each word's rank is looked up once, not once per pair.
    let ranks: Vec<usize> = endpoints
        .iter()
        .map(|&id| rank.get(common.word(id)).copied().unwrap_or(usize::MAX))
        .collect();
    let mut candidates: Vec<(u32, u32, u32)> = Vec::new();
    let pair_chunk = endpoints.len().div_ceil(threads.max(1)).max(1);
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for (chunk, part) in endpoints.chunks(pair_chunk).enumerate() {
            let base = chunk * pair_chunk;
            let (tables, balls, slot_of, ranks) = (&tables, &balls, &slot_of, &ranks);
            handles.push(scope.spawn(move || {
                let mut found: Vec<(u32, u32, u32)> = Vec::new();
                for (offset, &src) in part.iter().enumerate() {
                    let slot = base + offset;
                    let row = &tables[slot];
                    for &tgt in &balls[slot] {
                        let Some(&tgt_slot) = slot_of.get(&tgt) else {
                            continue;
                        };
                        let d = row[tgt as usize];
                        if d == unreachable_u8
                            || (d as usize) < mode.min_par
                            || (d as usize) > mode.max_par
                        {
                            continue;
                        }
                        // One entry per *pair*, ordered by familiarity so which of the two
                        // words is written first is stable across rebuilds.
                        //
                        // Both directions are still judged — see `judge_candidates`, which
                        // takes this ordering as the one to try first. What this drops is the
                        // duplicate row, not the duplicate puzzle: `a → b` and `b → a` are the
                        // same board read from either end, so enumerating both would double a
                        // 27-million-pair list to say the same thing twice.
                        if (ranks[slot], common.word(src)) >= (ranks[tgt_slot], common.word(tgt)) {
                            continue;
                        }
                        found.push((src, tgt, d as u32));
                    }
                }
                found
            }));
        }
        for handle in handles {
            candidates.extend(handle.join().expect("pairing worker panicked"));
        }
    });
    // Two ordered candidates per pair, because a pair is offered to the rules both ways round
    // and each way is separately refused or kept. What the tallies count, and what "refused"
    // in the rule table is a fraction of, is the ordered candidate.
    let pair_count = candidates.len();
    let candidate_count = pair_count * 2;
    eprintln!(
        "  candidates: {pair_count} pairs at par {}-{}, {candidate_count} with both directions",
        mode.min_par, mode.max_par
    );

    // Judging every rule against every candidate, or stopping each candidate at its
    // first failure. See Audit in config.rs. Nothing is sampled either way: the
    // tallies a build reports are counts, not estimates.
    let full = audit == Audit::On;

    // The frequency lists, resolved against this graph once rather than per candidate.
    // Before the search, not during it: a name that bans nothing is a typo in the config, and
    // finding out after ten minutes of judging is finding out too late.
    let overexposed = Overexposed::new(common, mode, lex)?;

    // Candidates are judged in parallel. Nothing a candidate reads is mutable — the
    // graphs, the distance tables and the reachable sets are all shared immutably —
    // so a worker needs only its own scratch buffers and its own tallies.
    //
    // Chunks are contiguous, which matters for more than cache: candidates are
    // enumerated source by source, so a contiguous run shares a source and the
    // legal-graph search that `secret` needs is done once for the run rather than
    // once per candidate.
    // Judged in stripes rather than contiguous blocks, so the threads finish together.
    //
    // Candidates are enumerated source by source and a hub source carries thousands
    // where a leaf source carries one, so contiguous blocks hand one thread a run of
    // hubs and another a run of leaves: the same total work, finishing minutes apart.
    // Striping interleaves them, which costs the locality of judging one source's
    // candidates together and is worth it — the searches that cared about that
    // locality now only run for a puzzle being kept.
    let mut puzzles: Vec<Puzzle> = Vec::new();
    let judging = Progress::new("judging  ", candidate_count);
    std::thread::scope(|scope| {
        scope.spawn(|| judging.watch());
        let mut handles = Vec::new();
        for offset in 0..threads.max(1) {
            // Sorted by source within the stripe, so the legal-graph search a kept
            // puzzle needs is still done once per source rather than once per puzzle.
            let mut stripe: Vec<(u32, u32, u32)> = candidates
                .iter()
                .skip(offset)
                .step_by(threads.max(1))
                .copied()
                .collect();
            stripe.sort_unstable();
            let (tables, slot_of, judging) = (&tables, &slot_of, &judging);
            let overexposed = &overexposed;
            handles.push(scope.spawn(move || {
                judge_candidates(
                    &stripe, common, common_subs, legal, mode, lex, rank, tables, slot_of,
                    unreachable_u8, full, overexposed, judging,
                )
            }));
        }
        for handle in handles {
            let (found, chunk_alone, chunk_only) = handle.join().expect("judge worker panicked");
            puzzles.extend(found);
            for slot in 0..Rule::ALL.len() {
                for par in 0..PAR_SLOTS {
                    alone[slot][par] += chunk_alone[slot][par];
                    only[slot][par] += chunk_only[slot][par];
                }
            }
        }
        judging.finish();
    });

    // The calendar is applied separately, by `schedule`, because its knobs are not
    // part of what the search depends on — see bank.rs.
    Ok(Selection {
        passed: puzzles.len(),
        puzzles,
        rejections: Rejections::from_tallies(&alone, &only),
        candidates: candidate_count,
    })
}

/// Scratch buffers one worker reuses over every candidate it judges.
///
/// Four searches' worth of arrays over the graph, allocated once per worker rather than once
/// per candidate — which is what makes the judging parallel at all: nothing else a candidate
/// reads is mutable.
pub struct Scratch {
    counter: Bfs,
    branch: Bfs,
    board: Bfs,
    legal_from: Bfs,
    /// Which legal-graph word `legal_from` currently holds distances from, so a run of
    /// candidates out of the same word pays for one search. See `secret`.
    searched_from: Option<u32>,
}

impl Scratch {
    pub fn new(common: &Graph, legal: &Graph) -> Scratch {
        Scratch {
            counter: Bfs::new(common.words.len()),
            branch: Bfs::new(common.words.len()),
            board: Bfs::new(common.words.len()),
            legal_from: Bfs::new(legal.words.len()),
            searched_from: None,
        }
    }
}

/// What a build decides about one **ordered** candidate: every rule it breaks, and the puzzle
/// it becomes if it breaks none.
pub struct Verdict {
    pub broken: Vec<Rule>,
    pub puzzle: Option<Puzzle>,
}

/// Judge a run of candidate **pairs**: the whole of what a build decides about a puzzle.
///
/// A pair, not an ordered candidate, because the game is symmetric — `carts → heartens` and
/// `heartens → carts` are one puzzle read from either end — while three of the rules are not.
/// `OpeningForced` asks whether the *source* has a second way out, `NoLateBranch` asks about
/// the second half of the route, and `CompoundSwap` tests whether the first of three words is
/// its two successors glued together. So each pair is offered to the rules **both ways round**,
/// in the order `select` canonicalised it into — the more familiar word as the source first.
///
/// Two consequences, and they are the point:
///
/// * A pair is only refused for wanting a choice at the opening when *neither* end has one. If
///   both do it is kept as it came; if only one does, that is the direction that survives, so
///   the end with the choice becomes the source. Nothing chooses that — it falls out of asking
///   twice.
/// * The mirror of a puzzle already kept is refused by `ReverseAlreadyAdded`, and refused
///   *first*, before any rule that costs a search. That is the only sound place for the test:
///   deduplicating pairs up front — which is what the rank ordering in `select` used to do
///   alone — throws away every pair whose only branching end is the one that sorted second.
///
/// Both directions are judged in the same worker, one after the other, so "already kept" is a
/// local boolean rather than something threads have to agree about.
///
/// Public because inspecting one pair has to go through exactly this — every rule, every knob,
/// the same board. A separate path for looking at a single puzzle is a path that can disagree
/// with the build about what the puzzle is.
#[allow(clippy::too_many_arguments)]
pub fn judge_candidates(
    part: &[(u32, u32, u32)],
    common: &Graph,
    common_subs: &FxSet<&str>,
    legal: &Graph,
    mode: &Mode,
    lex: &Lexicon,
    rank: &FxMap<String, usize>,
    tables: &[Vec<u8>],
    slot_of: &FxMap<u32, usize>,
    unreachable_u8: u8,
    full: bool,
    overexposed: &Overexposed,
    progress: &Progress,
) -> (Vec<Puzzle>, Tally, Tally) {
    let mut alone: Tally = empty_tally();
    let mut only: Tally = empty_tally();
    let mut puzzles: Vec<Puzzle> = Vec::new();
    let mut counted = 0usize;

    let mut scratch = Scratch::new(common, legal);

    for &(a, b, par) in part {
        // Two ordered candidates per pair, counted before either can be refused.
        counted += 2;
        if counted >= BATCH {
            progress.advance(counted);
            counted = 0;
        }

        let mut kept: Option<Puzzle> = None;
        for (src, tgt) in [(a, b), (b, a)] {
            let verdict = judge_direction(
                src,
                tgt,
                par,
                common,
                common_subs,
                legal,
                mode,
                lex,
                rank,
                &tables[slot_of[&src]],
                &tables[slot_of[&tgt]],
                unreachable_u8,
                full,
                kept.is_some(),
                overexposed,
                &mut scratch,
            );
            for rule in &verdict.broken {
                alone[rule.slot()][par_slot(par)] += 1;
                if verdict.broken.len() == 1 {
                    only[rule.slot()][par_slot(par)] += 1;
                }
            }
            // `mirrored` guarantees this cannot overwrite: a direction judged with the pair
            // already kept always breaks `ReverseAlreadyAdded`.
            if let Some(puzzle) = verdict.puzzle {
                kept = Some(puzzle);
            }
        }
        if let Some(puzzle) = kept {
            puzzles.push(puzzle);
        }
    }

    progress.advance(counted);
    (puzzles, alone, only)
}

/// One ordered candidate against every rule.
///
/// `mirrored` says the same pair has already been kept the other way round. In a plain build
/// that is the end of it — the rule costs nothing and there is nothing else to learn about a
/// duplicate — while an audit judges the rest anyway, because its counts are meant to say what
/// each rule *would* refuse rather than what the cascade reached.
///
/// Public because a pair is worth looking at one direction at a time: the two are meant to come
/// out the same puzzle, and `mirror_report` is the check that they do.
#[allow(clippy::too_many_arguments)]
pub fn judge_direction(
    src: u32,
    tgt: u32,
    par: u32,
    common: &Graph,
    common_subs: &FxSet<&str>,
    legal: &Graph,
    mode: &Mode,
    lex: &Lexicon,
    rank: &FxMap<String, usize>,
    from_src_row: &[u8],
    from_tgt_row: &[u8],
    unreachable_u8: u8,
    full: bool,
    mirrored: bool,
    overexposed: &Overexposed,
    scratch: &mut Scratch,
) -> Verdict {
    let at = |row: &[u8], word: u32| -> u32 {
        let d = row[word as usize];
        if d == unreachable_u8 {
            UNREACHED
        } else {
            d as u32
        }
    };

    // Every rule this candidate breaks, not just the first. A plain build stops
    // at the first failure; auditing keeps going so each rule's cost is attributed
    // to it rather than to whichever rule happens to run earliest.
    let mut broken: Vec<Rule> = Vec::new();
    let mut drawn: Vec<u32> = Vec::new();
    let mut alt = 0usize;

    'judge: {
        // The same pair the other way round, already kept. Asked before anything else
        // because it is a boolean and everything below is a scan or a search.
        if mirrored {
            broken.push(Rule::ReverseAlreadyAdded);
            if !full {
                break 'judge;
            }
        }

        // Overexposure, which costs a couple of array lookups per listed word and so goes even
        // before the chain rules. See `Overexposed`.
        let from_src = |word| at(from_src_row, word);
        let from_tgt = |word| at(from_tgt_row, word);
        if overexposed.has_word(par, &from_src, &from_tgt) {
            broken.push(Rule::ContainsTooFrequentWord);
            if !full {
                break 'judge;
            }
        }
        if overexposed.has_cluster(par, &from_src, &from_tgt) {
            broken.push(Rule::ContainsTooFrequentCluster);
            if !full {
                break 'judge;
            }
        }

        // Chain rules first, and this order is the difference between a build of
        // minutes and a build of half an hour. They read only the words on the
        // answers, over distances already tabulated, so they cost no search and
        // no scan — and between them they refuse the overwhelming majority of
        // candidates. Everything after this point is a neighbourhood scan or a
        // graph search, and none of it is worth paying for a candidate that a
        // string test over seven words will reject.
        judge_solutions(
            common,
            common_subs,
            src,
            tgt,
            &|word| at(from_tgt_row, word),
            mode,
            lex,
            !full,
            &mut broken,
        );
        if !full && !broken.is_empty() {
            break 'judge;
        }

        // The board this puzzle draws, which is also what the two rules below judge.
        // There is no wider neighbourhood measured first: a puzzle's recorded size has to
        // describe the set a player is actually shown.
        drawn = board_words(
            common,
            src,
            tgt,
            par,
            &|word| at(from_src_row, word),
            &|word| at(from_tgt_row, word),
            mode,
            &mut scratch.board,
        );
        if drawn.len() < MIN_BOARD {
            broken.push(Rule::BoardTooSmall);
            if !full {
                break 'judge;
            }
        }

        // Is this word on a shortest way through? Only if the distances through it add
        // up to par exactly. Guarded, because a rung can be drawn from further out than
        // the distance tables reach and UNREACHED is `u32::MAX`.
        let on_route = |word: u32| {
            let (from_src, from_tgt) = (at(from_src_row, word), at(from_tgt_row, word));
            from_src != UNREACHED && from_tgt != UNREACHED && from_src + from_tgt == par
        };

        alt = drawn.iter().filter(|&&w| !on_route(w)).count();
        if alt < mode.min_alt_nodes {
            broken.push(Rule::NoAlternatives);
            if !full {
                break 'judge;
            }
        }

        // Enough off the answer to be worth weighing, *for the length of the answer*.
        //
        // `NoAlternatives` asks for a flat four, which is a thin board at par 3 and a bare
        // one at par 10: a long answer with four words beside it is a corridor. Two words
        // per move is the same board at every par.
        //
        // It also *subsumes* the flat four, since `2 * par` is at least six over the whole
        // range the bank offers. A cascade will not show that — it runs `NoAlternatives`
        // first, so the counts get attributed there — but an audit should now put that
        // rule's "only reason" at zero, which is the evidence rules have been deleted on
        // before. Kept for now because it is the one of the two with a knob.
        if alt <= OFF_ROUTE_PER_MOVE * par as usize {
            broken.push(Rule::OffRouteTooFew);
            if !full {
                break 'judge;
            }
        }

        // Something has to join the answer in its *second half*.
        //
        // A board can satisfy everything above with a crowd of alternatives that all hang
        // off the opening and rejoin early, leaving the run to the target a single line
        // with no choice on it: the puzzle looks open and plays as a corridor from halfway.
        // So at least one word off the answer has to touch a word on it more than par / 2
        // moves in — which at par 4 means the last two of the five words on the answer, and
        // at par 5 the last three of six. The target counts: arriving at it from off the
        // answer is a genuine second way in.
        let joins_late = drawn.iter().any(|&word| {
            !on_route(word)
                && common.neighbors(word).iter().any(|&near| {
                    on_route(near)
                        && at(from_src_row, near) * 2 > par
                        && drawn.binary_search(&near).is_ok()
                })
        });
        if !joins_late {
            broken.push(Rule::NoLateBranch);
            if !full {
                break 'judge;
            }
        }

        // The first move has to be a choice. See `opening_moves`.
        if opening_moves(common, src, tgt, par, &mut scratch.branch) < mode.min_source_moves {
            broken.push(Rule::OpeningForced);
            if !full {
                break 'judge;
            }
        }

        // An id lookup, not a search. What the legal graph can *do* is a
        // statistic and waits until this candidate is being kept.
        if legal.id(common.word(src)).is_none() || legal.id(common.word(tgt)).is_none() {
            broken.push(Rule::NotInLegalGraph);
            break 'judge;
        }
    }

    if !broken.is_empty() {
        return Verdict { broken, puzzle: None };
    }

    // Statistics, for a puzzle that is being kept. There are hundreds of
    // candidates refused for every one accepted, so a search down here is a
    // search that happens thousands of times rather than millions.
    let routes = count_shortest_paths(common, src, tgt, par, &mut scratch.counter);

    // The best the legal graph can do. Never worse than par — every common word
    // and every common move is also legal — and when it is better, some rarer
    // word cuts a corner. That is the secret, recorded and not judged.
    let legal_src = legal.id(common.word(src)).expect("checked by NotInLegalGraph");
    let legal_tgt = legal.id(common.word(tgt)).expect("checked by NotInLegalGraph");
    if scratch.searched_from != Some(legal_src) {
        scratch.legal_from.run(legal, legal_src, mode.max_par as u32);
        scratch.searched_from = Some(legal_src);
    }
    let best = scratch.legal_from.get(legal_tgt).min(par);

    Verdict {
        broken,
        puzzle: Some(Puzzle {
            id: puzzle_id(&mode.name, common.word(src), common.word(tgt), mode.id_chars),
            // Set by `calendar::deal`, which is what decides the calendar.
            day: 0,
            // Set here rather than in `schedule`, because par divides a mode's bands and
            // `schedule` runs once over every mode's puzzles at once — by which point
            // which cuts to apply is no longer knowable. Global, so it indexes the
            // manifest's flattened band list.
            band: mode.global_band(mode.band_of(par)),
            source: common.word(src).to_string(),
            target: common.word(tgt).to_string(),
            par,
            corridor_size: drawn.len(),
            alt_nodes: alt,
            shortest_paths: routes,
            max_rank: drawn
                .iter()
                .map(|&w| rank.get(common.word(w)).copied().unwrap_or(usize::MAX))
                .filter(|&r| r != usize::MAX)
                .max()
                .unwrap_or(0),
            secret: if best < par { best } else { 0 },
            board: drawn.iter().map(|&w| common.word(w)).collect::<Vec<_>>().join(" "),
        }),
    }
}

