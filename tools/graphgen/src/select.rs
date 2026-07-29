//! Choosing which puzzles to offer.
//!
//! Legality and quality are kept strictly apart. Every move in the legal graph
//! stays playable no matter what happens here; these filters only decide which
//! *puzzles* get offered, so that the intended solution is fair and interesting.
//!
//! Filters run cheapest first, because the last one — proving par cannot be
//! beaten anywhere in the 190k-word graph — is by far the most expensive.

use std::collections::VecDeque;

use crate::config::{Audit, Config};
use crate::graph::{Bfs, FxMap, FxSet, Graph, UNREACHED};
use crate::id::{puzzle_id, shard_of, SHARDS};
use crate::progress::{Progress, BATCH};
use crate::word::{by_length, is_compound_swap, readings, same_family};

#[derive(Debug, Clone)]
pub struct Puzzle {
    /// The puzzle's public address, a digest of `answer`. See id.rs.
    pub id: String,
    /// Which day of the calendar this puzzle is, assigned by `spread`. Metadata rather
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
    /// A few of the best routes, as text, for the survey. Not shipped to the
    /// client — it can derive them from the graph, and this is for reading.
    pub routes: Vec<String>,
    /// The board this puzzle declares: its ways through and a little of what joins them,
    /// encoded for the shard files. See board.rs — the client draws exactly this.
    pub board: String,
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
///   Endpoint reuse is a matter of *calendar order* — see `spread`, which never
///   rejects anything.
/// * A ceiling on par. Par is a difficulty statistic, recorded on every puzzle;
///   `RECURSE_MAX_PAR` bounds the search and nothing else.
///
/// Every filter that can remove a puzzle from the bank is a variant here. A filter
/// outside this enum is a filter nobody is auditing.
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
}

impl Rule {
    pub const ALL: [Rule; 9] = [
        Rule::BoardTooSmall,
        Rule::NoAlternatives,
        Rule::OffRouteTooFew,
        Rule::NoLateBranch,
        Rule::OpeningForced,
        Rule::NotInLegalGraph,
        Rule::SameFamilyOnRoute,
        Rule::CompoundSwap,
        Rule::NoInternalMove,
    ];

    /// What the rule asks, and the knob that sets it.
    pub fn describe(self) -> (&'static str, &'static str) {
        match self {
            Rule::BoardTooSmall => ("nothing around the answer to weigh", "10, fixed"),
            Rule::NoAlternatives => ("no genuine longer way round", "RECURSE_MIN_ALT_NODES"),
            Rule::OffRouteTooFew => ("too little off the answer for its length", "2 x par, fixed"),
            Rule::NoLateBranch => ("nothing joins the answer past halfway", "par / 2, fixed"),
            Rule::OpeningForced => {
                ("first move is forced — no branch at the root", "RECURSE_MIN_SOURCE_MOVES")
            }
            Rule::NotInLegalGraph => ("an endpoint has no moves in the legal graph", "none"),
            Rule::SameFamilyOnRoute => ("two words on the answer are the same word", "none"),
            Rule::CompoundSwap => ("answer splits or merges a compound", "RECURSE_MAX_SWAPS"),
            Rule::NoInternalMove => {
                ("too few moves find a word inside a word", "max(MIN_INTERNAL, par/2-1)")
            }
        }
    }

    /// What the rule has to look at, which is what decides the order they run in.
    pub fn needs(self) -> Needs {
        match self {
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
            Needs::Chain => "chain",
            Needs::Neighbourhood => "graph",
        }
    }
}

/// Longest par a tally has a column for. `RECURSE_MAX_PAR` is bounded well inside this, and
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
/// Reports every rule any answer breaks, and the answers that survive. All of
/// them, not the first: the audit needs to know that a puzzle would have been
/// refused for two independent reasons, because a rule that only ever fires
/// alongside another one is not earning its place.
#[allow(clippy::too_many_arguments)]
fn judge_solutions(
    common: &Graph,
    subs: &FxSet<&str>,
    src: u32,
    tgt: u32,
    depth_from_tgt: &dyn Fn(u32) -> u32,
    config: &Config,
    stop_early: bool,
    broken: &mut Vec<Rule>,
) -> Vec<String> {
    let mut shown: Vec<String> = Vec::new();
    // One buffer for the whole walk, pushed and popped as it descends. The answer
    // reads source-first, which is the order the swap rule is defined in.
    let mut path: Vec<u32> = Vec::with_capacity(config.max_par + 1);
    path.push(src);
    descend(
        common, subs, tgt, depth_from_tgt, config, stop_early, broken, &mut shown, &mut path,
    );

    // Stable regardless of the order the DAG walk happened to find them.
    shown.sort();
    shown
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
    config: &Config,
    stop_early: bool,
    broken: &mut Vec<Rule>,
    shown: &mut Vec<String>,
    path: &mut Vec<u32>,
) {
    /// How many answers the survey shows per puzzle. Every one is still judged.
    const SHOWN: usize = 3;

    let last = *path.last().expect("never empty");
    if last == tgt {
        judge_one_answer(common, subs, path, config, broken);
        if broken.is_empty() && shown.len() < SHOWN {
            shown.push(
                path.iter().map(|&id| common.word(id)).collect::<Vec<_>>().join(" → "),
            );
        }
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
            descend(
                common, subs, tgt, depth_from_tgt, config, stop_early, broken, shown, path,
            );
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
    config: &Config,
    broken: &mut Vec<Rule>,
) {
    // No two words anywhere on the route may be forms of the same word.
    let family_clash = (0..path.len()).any(|i| {
        ((i + 1)..path.len())
            .any(|j| same_family(common.word(path[i]), common.word(path[j])))
    });
    if family_clash {
        note(broken, Rule::SameFamilyOnRoute);
    }

    let swaps = path
        .windows(3)
        .filter(|w| is_compound_swap(common.word(w[0]), common.word(w[1]), common.word(w[2])))
        .count();
    if swaps > config.max_swaps {
        note(broken, Rule::CompoundSwap);
    }

    let is_word = |w: &str| subs.contains(w);
    let internal = path
        .windows(2)
        .filter(|w| {
            has_internal_reading(common.word(w[0]), common.word(w[1]), &is_word, config.min_sub)
        })
        .count();
    if internal < internal_wanted(config, (path.len() - 1) as u32) {
        note(broken, Rule::NoInternalMove);
    }
}

/// The one answer that stands for the puzzle: the alphabetically first route of
/// exactly par on the common graph.
///
/// A puzzle can have several equally short answers and they all passed the rules,
/// so any of them would describe it — but the *id* is a digest of this one, and an
/// address has to come out the same on every build of the same bank.
/// `judge_solutions` cannot supply it: it keeps the first three routes its walk of
/// the route DAG happens to find and sorts only those, so which route sorts first
/// there depends on the order neighbours are stored in.
///
/// Greedy is exact here. Every candidate step is on some route of exactly par, so
/// taking the alphabetically smallest available word at each step can never paint
/// the route into a corner, and the sequence it builds is the smallest there is.
fn canonical_answer(
    common: &Graph,
    src: u32,
    tgt: u32,
    par: u32,
    from_src: &dyn Fn(u32) -> u32,
    from_tgt: &dyn Fn(u32) -> u32,
) -> Vec<String> {
    let mut answer = vec![common.word(src).to_string()];
    let mut at = src;
    for step in 1..=par {
        let next = common
            .neighbors(at)
            .iter()
            .copied()
            .filter(|&n| from_src(n) == step && from_tgt(n) == par - step)
            .min_by_key(|&n| common.word(n))
            .expect("par is the distance between the endpoints, so a next step exists");
        answer.push(common.word(next).to_string());
        at = next;
    }
    debug_assert_eq!(answer.last().map(String::as_str), Some(common.word(tgt)));
    answer
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
fn internal_wanted(config: &Config, par: u32) -> usize {
    config.min_internal.max((par as usize / 2).saturating_sub(1))
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
/// 2. **Longer ways round** — green. Same trick, allowing `alt_slack` extra moves, and kept
///    only if the route spends `min_divergence` consecutive words away from everything already
///    on the board. That last test is the whole difference between a board that shows a choice
///    and one that shows the answer with warts: in a graph averaging 2.1 moves per word almost
///    any neighbour of the answer can step off it and back a move later, and those detours are
///    worthless. Requiring the route to *stay* away is what a player means by another way.
/// 3. **What joins them** — words with at least two neighbours already on the board, best
///    connected first, capped at `around_percent` of it. Two and not one, because one drawn
///    neighbour is a spur that says only "there is more graph out here", while two shows the
///    ways through are one neighbourhood rather than parallel lines.
pub fn board_words(
    common: &Graph,
    src: u32,
    tgt: u32,
    par: u32,
    from_tgt: &dyn Fn(u32) -> u32,
    config: &Config,
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

    let limit = par + config.alt_slack as u32;

    // A second way out of the source, whatever it costs in divergence.
    //
    // `OpeningForced` promised the first move is a choice, and a promise about the graph is not
    // a promise about the drawing: if every route drawn so far leaves by the same word, the
    // board shows one way out and the guarantee is invisible.
    //
    // Routed *from* the other neighbour rather than found by blocking the answer's first move,
    // and the difference is the whole of why this needs its own step. `overstated → zincking`
    // leaves by `over` or by `stated`, and `stated`'s way onward runs through `over` — so
    // blocking `over` to force a detour finds nothing at all, while walking forward from
    // `stated` finds a perfectly good second opening that merges onto the answer one move
    // later. A branch that merges immediately is still a branch, which is exactly what the
    // rule counted when it let the puzzle through.
    if let Some(&first) = interior.first() {
        let mut others: Vec<u32> = common
            .neighbors(src)
            .iter()
            .copied()
            .filter(|&w| w != first && w != tgt)
            .collect();
        // Nearest the target first, so the branch drawn is the one a player would most likely
        // try; the id breaks ties so a rebuild draws the same board.
        others.sort_unstable_by_key(|&w| (from_tgt(w), w));
        // Searched at the *rule's* reach, not the alternative-route limit.
        //
        // `OpeningForced` counts a branch that reaches the target without the source within
        // `BRANCH_REACH * par`, so that is how far the board has to be willing to follow one:
        // `restart → railroading` is a par-8 puzzle whose second way out needs fourteen moves
        // to come back, which the rule allows and a search bounded at `par + alt_slack` cannot
        // reach. Promising a choice and then drawing one way out is worse than either.
        let opening_reach = par.saturating_mul(BRANCH_REACH);
        for word in others {
            blocked.clear();
            blocked.insert(src);
            if let Some(route) = bfs.route_avoiding(common, word, tgt, &blocked, opening_reach) {
                live.insert(src);
                live.extend(route.iter().copied());
                break;
            }
        }
    }

    let mut ways = 0;
    for &pivot in &interior {
        if ways >= config.max_alt_ways {
            break;
        }
        blocked.clear();
        blocked.insert(pivot);
        let Some(route) = bfs.route_avoiding(common, src, tgt, &blocked, limit) else {
            continue;
        };
        if diverges(&route, &live) < config.min_divergence {
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
    let reach = config.link_reach as u32;
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
    let room = (live.len() * config.around_percent) / 100;
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
    /// Days whose number names their own shard, so the client can reach them with one
    /// fetch and no index. See `spread`.
    pub aligned_days: usize,
}

pub fn select(
    common: &Graph,
    common_subs: &FxSet<&str>,
    legal: &Graph,
    config: &Config,
    rank: &FxMap<String, usize>,
    threads: usize,
) -> Selection {
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
    let far = (config.max_par + config.slack) as u32;
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
                            || (d as usize) < config.min_par
                            || (d as usize) > config.max_par
                        {
                            continue;
                        }
                        // One direction only, ordered by familiarity so the pair is
                        // stable across rebuilds.
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
    let candidate_count = candidates.len();
    eprintln!("  candidates: {candidate_count} pairs at par {}-{}", config.min_par, config.max_par);

    // Judging every rule against every candidate, or stopping each candidate at its
    // first failure. See Audit in config.rs. Nothing is sampled either way: the
    // tallies a build reports are counts, not estimates.
    let full = config.audit == Audit::On;

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
            handles.push(scope.spawn(move || {
                judge_candidates(
                    &stripe, common, common_subs, legal, config, rank, tables, slot_of,
                    unreachable_u8, full, judging,
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
    Selection {
        passed: puzzles.len(),
        puzzles,
        rejections: Rejections::from_tallies(&alone, &only),
        candidates: candidate_count,
        aligned_days: 0,
    }
}

/// Put a bank in calendar order and hand back how much of it is date-addressable.
///
/// Separate from `select` so that reordering the calendar does not mean repeating the
/// search: `RECURSE_SEED` and `RECURSE_MIN_GAP` reach only this function.
pub fn schedule(mut selection: Selection, config: &Config) -> Selection {
    let before = selection.puzzles.len();
    let (ordered, aligned) = spread(selection.puzzles, config);
    debug_assert_eq!(ordered.len(), before, "spread must not lose a puzzle");
    selection.puzzles = ordered;
    selection.passed = before;
    selection.aligned_days = aligned;
    selection
}

/// Judge one contiguous run of candidates, returning the puzzles that survived and
/// this run's share of each rule's tally.
///
/// Every argument but `part` is shared read-only across workers. The scratch buffers
/// and the tallies are local, which is the whole of what makes this parallel.
#[allow(clippy::too_many_arguments)]
/// Judge a run of candidates: the whole of what a build decides about a puzzle.
///
/// Public because inspecting one pair has to go through exactly this — every rule, every knob,
/// the same board. A separate path for looking at a single puzzle is a path that can disagree
/// with the build about what the puzzle is.
pub fn judge_candidates(
    part: &[(u32, u32, u32)],
    common: &Graph,
    common_subs: &FxSet<&str>,
    legal: &Graph,
    config: &Config,
    rank: &FxMap<String, usize>,
    tables: &[Vec<u8>],
    slot_of: &FxMap<u32, usize>,
    unreachable_u8: u8,
    full: bool,
    progress: &Progress,
) -> (Vec<Puzzle>, Tally, Tally) {
    let mut alone: Tally = empty_tally();
    let mut only: Tally = empty_tally();
    let mut puzzles: Vec<Puzzle> = Vec::new();
    let mut counted = 0usize;

    let mut counter = Bfs::new(common.words.len());
    let mut branch_bfs = Bfs::new(common.words.len());
    let mut board_bfs = Bfs::new(common.words.len());
    let mut legal_src_bfs = Bfs::new(legal.words.len());
    // Distances from the source, reused across every candidate that starts on the
    // same word. Candidates are grouped by source, so one search to max_par covers
    // every par a candidate from that source can have.
    let mut searched_from: Option<u32> = None;

    for &(src, tgt, par) in part {
        // Counted before anything can `continue` out of the candidate.
        counted += 1;
        if counted == BATCH {
            progress.advance(counted);
            counted = 0;
        }
        let from_src_row = &tables[slot_of[&src]];
        let from_tgt_row = &tables[slot_of[&tgt]];
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
        let routes_shown: Vec<String>;
        let mut drawn: Vec<u32> = Vec::new();
        let mut alt = 0usize;

        'judge: {
            // Chain rules first, and this order is the difference between a build of
            // minutes and a build of half an hour. They read only the words on the
            // answers, over distances already tabulated, so they cost no search and
            // no scan — and between them they refuse the overwhelming majority of
            // candidates. Everything after this point is a neighbourhood scan or a
            // graph search, and none of it is worth paying for a candidate that a
            // string test over seven words will reject.
            routes_shown = judge_solutions(
                common,
                common_subs,
                src,
                tgt,
                &|word| at(from_tgt_row, word),
                config,
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
                &|word| at(from_tgt_row, word),
                config,
                &mut board_bfs,
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
            if alt < config.min_alt_nodes {
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

            // The first move has to be a choice: `RECURSE_MIN_SOURCE_MOVES` of the
            // source's moves have to lead to the target without coming back through
            // the source.
            //
            // That is reachability in the common graph with the source deleted, so
            // a move onto a spur does not count — `passing → bypassing` is a move,
            // but the only way on from `bypassing` is back through `passing`, which
            // is not a choice. Deleting the source also rules out a route that
            // returns to it, so what survives is a simple path onward.
            //
            // The route a branch takes may be any length; the depth limit only stops
            // the search wandering the whole component looking for a way round that
            // no answer would use.
            let reach_limit = par.saturating_mul(BRANCH_REACH);
            branch_bfs.run_without(common, tgt, reach_limit, src);
            let branches = common
                .neighbors(src)
                .iter()
                .filter(|&&n| n != src && branch_bfs.get(n) != UNREACHED)
                .count();
            if branches < config.min_source_moves {
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

        for rule in &broken {
            alone[rule.slot()][par_slot(par)] += 1;
            if broken.len() == 1 {
                only[rule.slot()][par_slot(par)] += 1;
            }
        }
        if !broken.is_empty() {
            continue;
        }

        // Statistics, for a puzzle that is being kept. There are hundreds of
        // candidates refused for every one accepted, so a search down here is a
        // search that happens thousands of times rather than millions.
        let routes = count_shortest_paths(common, src, tgt, par, &mut counter);

        // The best the legal graph can do. Never worse than par — every common word
        // and every common move is also legal — and when it is better, some rarer
        // word cuts a corner. That is the secret, recorded and not judged.
        let legal_src = legal.id(common.word(src)).expect("checked by NotInLegalGraph");
        let legal_tgt = legal.id(common.word(tgt)).expect("checked by NotInLegalGraph");
        if searched_from != Some(legal_src) {
            legal_src_bfs.run(legal, legal_src, config.max_par as u32);
            searched_from = Some(legal_src);
        }
        let best = legal_src_bfs.get(legal_tgt).min(par);

        let answer = canonical_answer(
            common,
            src,
            tgt,
            par,
            &|word| at(from_src_row, word),
            &|word| at(from_tgt_row, word),
        );

        puzzles.push(Puzzle {
            id: puzzle_id(&answer, config.id_chars),
            // Set by `spread`, which is what decides the calendar.
            day: 0,
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
            routes: routes_shown,
            board: drawn.iter().map(|&w| common.word(w)).collect::<Vec<_>>().join(" "),
        });
    }

    progress.advance(counted);
    (puzzles, alone, only)
}

/// A tiny deterministic PRNG, so a rebuild always produces the same calendar.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// Order the bank so a word does not reappear as an endpoint too soon.
///
/// Purely an ordering. Every puzzle handed in comes back out: repeating a word is a
/// reason to hold a puzzle for later, never a reason to refuse it. `min_gap` is how
/// many puzzles a word waits before it may be an endpoint again, honoured whenever
/// some puzzle can be placed without breaking it.
///
/// A word is only freed when another puzzle is placed, so the window can reach a
/// state where every puzzle left wants a word still inside it. That deadlock is
/// broken by placing the next pending puzzle regardless — the gap is a preference,
/// and the alternative is losing puzzles to it.
fn spread(mut puzzles: Vec<Puzzle>, config: &Config) -> (Vec<Puzzle>, usize) {
    // Canonical order before shuffling: selection order depends on hash iteration
    // and thread scheduling, and without this a rebuild would silently reassign
    // every calendar date.
    puzzles.sort_by(|a, b| (&a.source, &a.target).cmp(&(&b.source, &b.target)));

    let mut rng = Rng(config.seed);
    for i in (1..puzzles.len()).rev() {
        let j = (rng.next() % (i as u64 + 1)) as usize;
        puzzles.swap(i, j);
    }

    // One queue per shard, so a day can be served from the shard its number names.
    //
    // The client finds today's board by fetching shard `day % SHARDS` and looking for
    // the day inside it, which is what saves it an index over the whole bank. That
    // holds while every shard still has a puzzle left; shard sizes differ by a few
    // percent, so the round robin eventually asks an empty one. From there the days
    // keep being handed out from whatever shards remain — those puzzles ship and play
    // like any other, and are reached by their id rather than by a date. `aligned`
    // reports where that changeover falls, and it is the calendar the client may look
    // up by day.
    let mut queues: Vec<std::collections::VecDeque<Puzzle>> =
        (0..SHARDS).map(|_| Default::default()).collect();
    for puzzle in puzzles {
        queues[shard_of(&puzzle.id)].push_back(puzzle);
    }

    let mut ordered: Vec<Puzzle> = Vec::with_capacity(queues.iter().map(VecDeque::len).sum());
    let mut blocked: FxMap<String, usize> = FxMap::default();
    let mut recent: std::collections::VecDeque<(String, String)> = Default::default();
    let mut aligned: Option<usize> = None;

    let mut day = 0usize;
    while queues.iter().any(|q| !q.is_empty()) {
        // The shard this day belongs to, while the alignment holds. Once it has
        // broken, take from the fullest shard so the tail stays balanced.
        let wanted = day % SHARDS;
        let from = if !queues[wanted].is_empty() {
            wanted
        } else {
            if aligned.is_none() {
                aligned = Some(day);
            }
            queues
                .iter()
                .enumerate()
                .max_by_key(|(_, q)| q.len())
                .map(|(i, _)| i)
                .expect("some queue is not empty")
        };

        // The first puzzle in that shard whose endpoints are both free, or — when the
        // window has deadlocked — the one at the front.
        let next = queues[from]
            .iter()
            .position(|puzzle| {
                blocked.get(&puzzle.source).copied().unwrap_or(0) == 0
                    && blocked.get(&puzzle.target).copied().unwrap_or(0) == 0
            })
            .unwrap_or(0);
        let mut puzzle = queues[from].remove(next).expect("index came from this deque");

        *blocked.entry(puzzle.source.clone()).or_insert(0) += 1;
        *blocked.entry(puzzle.target.clone()).or_insert(0) += 1;
        recent.push_back((puzzle.source.clone(), puzzle.target.clone()));
        while recent.len() > config.min_gap {
            if let Some((source, target)) = recent.pop_front() {
                for word in [source, target] {
                    if let Some(count) = blocked.get_mut(&word) {
                        *count -= 1;
                    }
                }
            }
        }
        puzzle.day = day;
        ordered.push(puzzle);
        day += 1;
    }
    (ordered, aligned.unwrap_or(day))
}
