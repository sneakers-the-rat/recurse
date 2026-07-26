//! Choosing which puzzles to offer.
//!
//! Legality and quality are kept strictly apart. Every move in the legal graph
//! stays playable no matter what happens here; these filters only decide which
//! *puzzles* get offered, so that the intended solution is fair and interesting.
//!
//! Filters run cheapest first, because the last one — proving par cannot be
//! beaten anywhere in the 190k-word graph — is by far the most expensive.

use crate::config::Config;
use crate::graph::{Bfs, FxMap, FxSet, Graph, UNREACHED};
use crate::word::{by_length, is_compound_swap, readings, same_family};

#[derive(Debug, Clone)]
pub struct Puzzle {
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
}

/// Fewest words a board may have and still be worth drawing.
const MIN_BOARD: usize = 10;

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
/// * A ceiling on how many equally short answers a puzzle may have. Several ways
///   through is a strength. It also, measurably, never rejected anything on its
///   own.
/// * A rarer word beating par. Now a *secret*, not a rejection — see `secret` on
///   Puzzle. Finding one is the best thing that can happen to a player.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Rule {
    BoardTooSmall,
    NoAlternatives,
    OpeningForced,
    NotInLegalGraph,
    ManyLegalRoutes,
    SameFamilyOnRoute,
    CompoundSwap,
    NoInternalMove,
}

impl Rule {
    pub const ALL: [Rule; 8] = [
        Rule::BoardTooSmall,
        Rule::NoAlternatives,
        Rule::OpeningForced,
        Rule::NotInLegalGraph,
        Rule::ManyLegalRoutes,
        Rule::SameFamilyOnRoute,
        Rule::CompoundSwap,
        Rule::NoInternalMove,
    ];

    /// What the rule asks, and the knob that sets it.
    pub fn describe(self) -> (&'static str, &'static str) {
        match self {
            Rule::BoardTooSmall => ("nothing around the answer to weigh", "10, fixed"),
            Rule::NoAlternatives => ("no genuine longer way round", "RECURSE_MIN_ALT_NODES"),
            Rule::OpeningForced => {
                ("first move is forced — no branch at the root", "RECURSE_MIN_SOURCE_MOVES")
            }
            Rule::NotInLegalGraph => ("an endpoint has no moves in the legal graph", "none"),
            Rule::ManyLegalRoutes => ("too many best routes to check them all", "400, fixed"),
            Rule::SameFamilyOnRoute => ("two words on the answer are the same word", "none"),
            Rule::CompoundSwap => ("answer splits or merges a compound", "RECURSE_MAX_SWAPS"),
            Rule::NoInternalMove => ("answer never finds a word inside a word", "RECURSE_MIN_INTERNAL"),
        }
    }
}

/// How each rule fared over every candidate, independent of the others.
#[derive(Default, Debug)]
pub struct Rejections {
    /// Candidates this rule refused, whether or not any other rule also did.
    pub alone: Vec<(Rule, usize)>,
    /// Candidates this rule was the *only* objection to — what relaxing it buys.
    pub only: Vec<(Rule, usize)>,
}

impl Rejections {
    fn from_tallies(alone: &[usize; 8], only: &[usize; 8]) -> Rejections {
        Rejections {
            alone: Rule::ALL.iter().copied().zip(alone.iter().copied()).collect(),
            only: Rule::ALL.iter().copied().zip(only.iter().copied()).collect(),
        }
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
    depth_from_src: &dyn Fn(u32) -> u32,
    config: &Config,
    stop_early: bool,
    broken: &mut Vec<Rule>,
) -> Vec<String> {
    /// How many answers the survey shows per puzzle. Every one is still judged.
    const SHOWN: usize = 3;
    let mut shown: Vec<String> = Vec::new();
    let legal = common;

    // A subword has to be an ordinary word too, or the answer is only "interesting"
    // by way of something nobody would think of.
    let is_word = |w: &str| subs.contains(w);

    // Walk the route DAG backwards, from the target towards the source.
    //
    // Backwards because that needs only the distances *from the source*, which are
    // already computed and shared by every candidate starting at this word. Going
    // forwards needs a second search from the target, per candidate, and that
    // second search was most of the build: a step back from `v` is any neighbour
    // one closer to the source, and every such walk reaches the source in exactly
    // `best` moves, so the two directions enumerate the same routes.
    const MAX_PATHS: usize = 400;
    let mut stack: Vec<Vec<u32>> = vec![vec![tgt]];
    let mut seen_paths = 0;

    while let Some(mut path) = stack.pop() {
        let last = *path.last().expect("never empty");
        if last == src {
            // Reversed, so the answer reads from the source as the player walks it.
            path.reverse();
            seen_paths += 1;
            if seen_paths > MAX_PATHS {
                note(broken, Rule::ManyLegalRoutes);
                return shown;
            }

            // No two words anywhere on the route may be forms of the same word.
            let mut family_clash = false;
            for i in 0..path.len() {
                for j in (i + 1)..path.len() {
                    if same_family(legal.word(path[i]), legal.word(path[j])) {
                        family_clash = true;
                    }
                }
            }
            if family_clash {
                note(broken, Rule::SameFamilyOnRoute);
            }

            let swaps = path
                .windows(3)
                .filter(|w| {
                    is_compound_swap(legal.word(w[0]), legal.word(w[1]), legal.word(w[2]))
                })
                .count();
            if swaps > config.max_swaps {
                note(broken, Rule::CompoundSwap);
            }

            let internal = path
                .windows(2)
                .filter(|w| {
                    has_internal_reading(
                        legal.word(w[0]),
                        legal.word(w[1]),
                        &is_word,
                        config.min_sub,
                    )
                })
                .count();
            if internal < config.min_internal {
                note(broken, Rule::NoInternalMove);
            }

            // A route only reaches the survey if it broke nothing at all.
            if broken.is_empty() && shown.len() < SHOWN {
                shown.push(
                    path.iter()
                        .map(|&id| legal.word(id))
                        .collect::<Vec<_>>()
                        .join(" → "),
                );
            }
            // One refusal is enough for a plain build; the audit keeps going so it
            // can attribute the cost to every rule the answer breaks, not just the
            // first. Either way, nothing more is learned once they have all fired.
            if (stop_early && !broken.is_empty()) || broken.len() >= 3 {
                return shown;
            }
            continue;
        }

        // A step back towards the source: any neighbour one move closer to it.
        let depth = depth_from_src(last);
        for &previous in legal.neighbors(last) {
            let closer = depth_from_src(previous);
            if closer != UNREACHED && closer + 1 == depth {
                let mut extended = path.clone();
                extended.push(previous);
                stack.push(extended);
            }
        }
    }

    // Stable regardless of the order the DAG walk happened to find them.
    shown.sort();
    shown
}

/// Record a broken rule once, however many answers break it.
fn note(broken: &mut Vec<Rule>, rule: Rule) {
    if !broken.contains(&rule) {
        broken.push(rule);
    }
}

/// Nodes on some route between the endpoints, with dead ends pruned away.
///
/// Repeatedly dropping degree-1 nodes cannot remove a node that is genuinely on a
/// route — such a node has an edge toward each end — and it clears spurs of any
/// length. At the radius needed to expose alternatives, spurs outnumber route
/// nodes about four to one, so this is what keeps a board drawable.
fn routes_only(graph: &Graph, candidates: &[u32], keep: &[u32]) -> Vec<u32> {
    let mut live: FxSet<u32> = candidates.iter().copied().collect();
    let protected: FxSet<u32> = keep.iter().copied().collect();
    loop {
        let mut doomed = Vec::new();
        for &word in &live {
            if protected.contains(&word) {
                continue;
            }
            let degree = graph
                .neighbors(word)
                .iter()
                .filter(|n| live.contains(n))
                .count();
            if degree <= 1 {
                doomed.push(word);
            }
        }
        if doomed.is_empty() {
            break;
        }
        for word in doomed {
            live.remove(&word);
        }
    }
    let mut out: Vec<u32> = live.into_iter().collect();
    out.sort_unstable();
    out
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
    pub unplaceable: usize,
}

pub fn select(
    common: &Graph,
    common_subs: &FxSet<&str>,
    legal: &Graph,
    config: &Config,
    rank: &FxMap<String, usize>,
) -> Selection {
    // One tally per rule: how many candidates it refused, and how many it was the
    // sole objection to.
    let mut alone = [0usize; 8];
    let mut only = [0usize; 8];

    // Endpoints come from the most frequent words, so both ends are familiar.
    let mut endpoints: Vec<u32> = (0..common.words.len() as u32)
        .filter(|&id| !common.neighbors(id).is_empty())
        .collect();
    endpoints.sort_by_key(|&id| rank.get(common.word(id)).copied().unwrap_or(usize::MAX));
    endpoints.truncate(config.endpoint_pool);


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

    let mut bfs = Bfs::new(common.words.len());
    let mut counter = Bfs::new(common.words.len());
    let mut tables: Vec<Vec<u8>> = Vec::with_capacity(endpoints.len());
    // The words each endpoint can actually reach, which is what a corridor is
    // drawn from. Scanning every connected word per candidate instead was the
    // dominant cost of the whole build: 190k candidates times 12.6k words is 2.4
    // billion tests to find neighbourhoods that average a few hundred words. A
    // corridor node has to be within `far` of *both* ends, so scanning the smaller
    // of the two reachable sets is not an approximation — it is the same answer.
    let mut balls: Vec<Vec<u32>> = Vec::with_capacity(endpoints.len());
    for &id in &endpoints {
        let mut row = vec![unreachable_u8; common.words.len()];
        bfs.run(common, id, far);
        for &word in &bfs.touched {
            row[word as usize] = bfs.get(word).min(u8::MAX as u32 - 1) as u8;
        }
        tables.push(row);
        let mut ball = bfs.touched.clone();
        ball.sort_unstable();
        balls.push(ball);
    }
    let ball_total: usize = balls.iter().map(Vec::len).sum();
    eprintln!(
        "  endpoint distance tables: {} x {} words, reaching {} words each on average",
        tables.len(),
        common.words.len(),
        ball_total / balls.len().max(1)
    );

    let mut candidates: Vec<(u32, u32, u32)> = Vec::new();
    for (slot, &src) in endpoints.iter().enumerate() {
        let row = &tables[slot];
        for &tgt in &endpoints {
            let d = row[tgt as usize];
            if d == unreachable_u8 || (d as usize) < config.min_par || (d as usize) > config.max_par
            {
                continue;
            }
            // One direction only, ordered by familiarity so the pair is stable.
            let src_rank = rank.get(common.word(src)).copied().unwrap_or(usize::MAX);
            let tgt_rank = rank.get(common.word(tgt)).copied().unwrap_or(usize::MAX);
            if (src_rank, common.word(src)) >= (tgt_rank, common.word(tgt)) {
                continue;
            }
            candidates.push((src, tgt, d as u32));
        }
    }
    let candidate_count = candidates.len();

    let mut puzzles = Vec::new();
    let mut legal_src_bfs = Bfs::new(legal.words.len());
    // Distances from the source, reused across every candidate that starts on the
    // same word — candidates are grouped by source, and there are 4,000 sources to
    // 190,000 candidates. Run to max_par, which covers every par such a candidate
    // can have, so one search serves them all. Doing it per candidate instead was
    // most of the build.
    let mut searched_from: Option<u32> = None;

    // Auditing judges every rule against a candidate instead of stopping at its
    // first failure, and the last rules cost a search of the legal graph each. Over
    // all 190k candidates that is minutes; over an evenly spread sample it is
    // seconds and answers the same question, so `RECURSE_AUDIT=1` samples and
    // scales, and only `RECURSE_AUDIT=full` pays for exact integers.
    const AUDIT_SAMPLE: usize = 12_000;
    let stride = match config.audit {
        0 => 0,
        1 => (candidate_count / AUDIT_SAMPLE).max(1),
        given => given,
    };
    let mut audited = 0usize;

    for (index, (src, tgt, par)) in candidates.into_iter().enumerate() {
        let full = stride > 0 && index % stride == 0;
        if full {
            audited += 1;
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

        let limit = par + config.slack as u32;
        let src_ball = &balls[slot_of[&src]];
        let tgt_ball = &balls[slot_of[&tgt]];
        let scan = if src_ball.len() <= tgt_ball.len() { src_ball } else { tgt_ball };
        let mut corridor: Vec<u32> = Vec::with_capacity(scan.len() / 4);
        for &word in scan {
            let ds = at(from_src_row, word);
            if ds == UNREACHED || ds > limit {
                continue;
            }
            let dt = at(from_tgt_row, word);
            if dt != UNREACHED && ds + dt <= limit {
                corridor.push(word);
            }
        }
        // Every rule this candidate breaks, not just the first. The rules are
        // still ordered cheapest-first and a plain build stops at the first
        // failure; auditing keeps going so each rule's cost can be attributed to
        // it rather than to whichever rule happens to run earliest.
        let mut broken: Vec<Rule> = Vec::new();
        let mut routes_shown: Vec<String> = Vec::new();
        let drawn: Vec<u32>;
        let mut alt = 0usize;
        let mut routes = 0u64;
        let mut best = par;

        'judge: {
            // Pruning is the only costly step here and it now serves a floor and a
            // statistic, never a ceiling. A neighbourhood past this size obviously
            // clears the floor, so the statistic is taken unpruned rather than
            // paying to prune it. A cost guard, not a rule.
            const PRUNE_LIMIT: usize = 8_000;
            drawn = if corridor.len() > PRUNE_LIMIT {
                corridor.clone()
            } else {
                routes_only(common, &corridor, &[src, tgt])
            };
            if drawn.len() < MIN_BOARD {
                broken.push(Rule::BoardTooSmall);
                if !full {
                    break 'judge;
                }
            }

            alt = drawn
                .iter()
                .filter(|&&w| at(from_src_row, w) + at(from_tgt_row, w) > par)
                .count();
            if alt < config.min_alt_nodes {
                broken.push(Rule::NoAlternatives);
                if !full {
                    break 'judge;
                }
            }

            // How many ways through, on the common graph. A statistic now, not a
            // rule: several ways through is a strength, and the count is worth
            // showing in the survey and in dev mode.
            routes = count_shortest_paths(common, src, tgt, par, &mut counter);

            // The first move has to be a choice.
            //
            // A branch is an ordinary move from the source that begins a route to the
            // target no more than two moves off the best — the same width the board
            // is drawn at its tightest. Measuring it against the full slack-6
            // neighbourhood instead promised branches the client then trimmed away;
            // measuring the source's raw degree, as this first did, promised nothing
            // at all, and let `speaking → sing → ...` through with one real option.
            const BRANCH_SLACK: u32 = 2;
            let branches = common
                .neighbors(src)
                .iter()
                .filter(|&&n| {
                    let onward = at(from_tgt_row, n);
                    onward != UNREACHED && 1 + onward <= par + BRANCH_SLACK
                })
                .count();
            if branches < config.min_source_moves {
                broken.push(Rule::OpeningForced);
                if !full {
                    break 'judge;
                }
            }

            let legal_src = legal.id(common.word(src));
            let legal_tgt = legal.id(common.word(tgt));

            let (Some(a), Some(b)) = (legal_src, legal_tgt) else {
                broken.push(Rule::NotInLegalGraph);
                break 'judge;
            };

            // The best the legal graph can do. Never worse than par — every common
            // word and every common move is also legal — and when it is better, some
            // rarer word cuts a corner. That is the secret, recorded and not judged.
            if searched_from != Some(a) {
                legal_src_bfs.run(legal, a, config.max_par as u32);
                searched_from = Some(a);
            }
            best = legal_src_bfs.get(b).min(par);

            // The intended answers, on the common graph, at exactly par. No search
            // needed: the distances from this endpoint are already tabulated.
            routes_shown = judge_solutions(
                common,
                common_subs,
                src,
                tgt,
                &|word| at(from_src_row, word),
                config,
                !full,
                &mut broken,
            );
        }

        // Only a fully judged candidate can be attributed honestly. One that
        // stopped at its first failure knows nothing about the rules after it, so
        // counting it would put the whole cost on whichever rule happens to run
        // first — the very thing the audit exists to avoid.
        if stride == 0 || full {
            for rule in &broken {
                let slot = Rule::ALL.iter().position(|r| r == rule).expect("known rule");
                alone[slot] += 1;
                if broken.len() == 1 {
                    only[slot] += 1;
                }
            }
        }
        if !broken.is_empty() {
            continue;
        }

        puzzles.push(Puzzle {
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
        });
    }

    // Scale the sample back up to the whole candidate set.
    if stride > 1 {
        for slot in 0..alone.len() {
            alone[slot] *= stride;
            only[slot] *= stride;
        }
    }
    if stride > 0 {
        eprintln!(
            "  audited {audited} of {candidate_count} candidates (1 in {stride}){}",
            if stride > 1 { ", counts below are estimates" } else { "" }
        );
    }

    let (puzzles, unplaceable) = spread(puzzles, config);
    Selection {
        puzzles,
        rejections: Rejections::from_tallies(&alone, &only),
        candidates: candidate_count,
        unplaceable,
    }
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
/// Hub words are endpoints of thousands of candidates, so capping reuse outright
/// throws most of the bank away. What actually matters for a daily game is that a
/// repeat does not arrive while players still remember it, so a word is simply
/// barred until `min_gap` puzzles have passed. Nearly everything survives.
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

    let mut ordered: Vec<Puzzle> = Vec::with_capacity(puzzles.len());
    let mut pending = puzzles;
    let mut blocked: FxMap<String, usize> = FxMap::default();
    let mut recent: std::collections::VecDeque<(String, String)> = Default::default();

    loop {
        let mut deferred = Vec::new();
        let mut placed = 0;
        for puzzle in pending {
            let busy = blocked.get(&puzzle.source).copied().unwrap_or(0) > 0
                || blocked.get(&puzzle.target).copied().unwrap_or(0) > 0;
            if busy {
                deferred.push(puzzle);
                continue;
            }
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
            ordered.push(puzzle);
            placed += 1;
        }
        if placed == 0 {
            return (ordered, deferred.len());
        }
        pending = deferred;
        if pending.is_empty() {
            return (ordered, 0);
        }
    }
}
