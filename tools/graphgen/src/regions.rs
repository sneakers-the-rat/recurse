//! Carving a mode's common graph into regions: the map's territories.
//!
//! The explore mode draws the whole common graph rather than one puzzle's neighbourhood, and a
//! few thousand words with no spine to hang them on is a hairball. So the graph is partitioned
//! once, here, into communities — clumps of words that are more joined to each other than to
//! everything else — and the client lays words out *inside* a region and regions out against
//! each other. A region is therefore both a layout unit and a landmark: it has a name, it keeps
//! its shape, and a player learns where things are by remembering which territory they are in.
//!
//! **It has to be decided here rather than in the browser.** A landmark that moved every time
//! you revealed a word would be no landmark at all, and every atlas of a mode has to agree
//! about where the territories are or two players could not talk about the same map. So this is
//! a property of the mode's graph, worked out once per build, like everything else the client
//! draws.
//!
//! Two steps, and the first is a filter rather than a partition:
//!
//! * **Components smaller than `min_component` are not part of the atlas.** A word with no moves
//!   at all, or a pair that only join each other, is not somewhere to explore — you could never
//!   arrive there and there would be nothing to do on arrival. Those words are still perfectly
//!   legal guesses and still in the shipped dictionary; this decides the *map*, not the word
//!   list, and moves no vocabulary digest.
//! * **Louvain over what is left.** Modularity maximisation, which is the standard answer to
//!   "what are the clumps" and needs no target count — the graph says how many there are. It is
//!   run deterministically (see `shuffle`) so a rebuild gives the same territories.

use crate::graph::Graph;

/// One territory: the words in it, and the word it is named after.
pub struct Region {
    /// The best-known member, by frequency. Its *spelling* is what the map prints, which is the
    /// caller's business — a region of a phonemes mode is named after a sound, and the player
    /// reads a word.
    pub name: u32,
    /// Member ids, in the graph this was built over. Ascending.
    pub words: Vec<u32>,
}

/// A mode's common graph, partitioned.
///
/// The partition is written down one way round only — a region and its members. Which region a
/// given word is in is the *client's* question and it builds that map when it reads the file;
/// keeping a second copy here would be a second thing to keep true.
pub struct Regions {
    pub regions: Vec<Region>,
    /// Words left out for sitting in a component below `min_component` — including every word
    /// with no moves at all, which is most of the list.
    pub dropped: usize,
    /// Components of the graph that survived the filter. Always at least as many as there are
    /// regions is *false*: Louvain splits a large component into several, so there are usually
    /// more regions than components.
    pub components: usize,
}

/// How the territories came out, for the build's report.
///
/// **A median would lie here, which is why this is a shape rather than a number.** The
/// distribution is two things at once: the handful of dozens of real territories that the giant
/// component gets cut into, and a long tail of three- and four-word components that are each a
/// region because there is nothing to join them to. The median lands in the tail and says 3,
/// about a map whose territories are mostly a couple of hundred words.
pub struct Sizes {
    pub count: usize,
    pub largest: usize,
    /// Regions of ten words or more, and the share of the map's words they hold. This is the
    /// number to read: it says how much of the map is territory rather than island.
    pub real: usize,
    pub in_real: usize,
    pub words: usize,
}

impl Regions {
    pub fn sizes(&self) -> Sizes {
        let sizes: Vec<usize> = self.regions.iter().map(|r| r.words.len()).collect();
        let real: Vec<usize> = sizes.iter().copied().filter(|&n| n >= REAL).collect();
        Sizes {
            count: sizes.len(),
            largest: sizes.iter().copied().max().unwrap_or(0),
            real: real.len(),
            in_real: real.iter().sum(),
            words: sizes.iter().sum(),
        }
    }
}

/// Words below which a region is an island rather than a territory. A reporting threshold and
/// nothing else — no rule reads it.
const REAL: usize = 10;

/// Partition `graph`, keeping only components of at least `min_component` words.
///
/// `rank` is the frequency position of each word, lower being better known, and is only used to
/// choose what a region is called. `seed` fixes the node order Louvain visits in; see `shuffle`.
pub fn build(graph: &Graph, min_component: usize, rank: &[usize], seed: u64) -> Regions {
    let n = graph.words.len();
    let (keep, components) = large_components(graph, min_component);

    // Louvain runs over the surviving words only, renumbered densely, because a graph that is
    // 60% isolated words would otherwise spend all its work confirming that each of them is its
    // own community.
    let mut local = vec![u32::MAX; n];
    let mut back: Vec<u32> = Vec::new();
    for (id, &kept) in keep.iter().enumerate() {
        if kept {
            local[id] = back.len() as u32;
            back.push(id as u32);
        }
    }

    let mut level = Weighted::of(graph, &local, back.len());
    let communities = louvain(&mut level, seed);

    // Gather members, then order the regions by their first member so the file is stable and
    // diffable rather than being in whatever order the aggregation happened to produce.
    let mut members: Vec<Vec<u32>> = vec![Vec::new(); communities.iter().copied().max().map_or(0, |m| m as usize + 1)];
    for (dense, &community) in communities.iter().enumerate() {
        members[community as usize].push(back[dense]);
    }
    members.retain(|words| !words.is_empty());
    members.sort_by_key(|words| words[0]);

    let mut regions = Vec::with_capacity(members.len());
    for words in members {
        // Best known member, and the lowest id among equals so an unranked region — every word
        // of it missing from the frequency list — still gets the same name every build.
        let name = *words
            .iter()
            .min_by_key(|&&w| (rank.get(w as usize).copied().unwrap_or(usize::MAX), w))
            .expect("a region is never empty");
        regions.push(Region { name, words });
    }

    Regions { regions, dropped: keep.iter().filter(|&&k| !k).count(), components }
}

/// Which words sit in a connected component of at least `least` words, and how many such
/// components there are.
fn large_components(graph: &Graph, least: usize) -> (Vec<bool>, usize) {
    let n = graph.words.len();
    let mut seen = vec![false; n];
    let mut keep = vec![false; n];
    let mut components = 0;
    let mut stack: Vec<u32> = Vec::new();
    let mut found: Vec<u32> = Vec::new();

    for start in 0..n {
        if seen[start] {
            continue;
        }
        seen[start] = true;
        stack.clear();
        found.clear();
        stack.push(start as u32);
        while let Some(word) = stack.pop() {
            found.push(word);
            for &next in graph.neighbors(word) {
                if !seen[next as usize] {
                    seen[next as usize] = true;
                    stack.push(next);
                }
            }
        }
        if found.len() >= least {
            components += 1;
            for &word in &found {
                keep[word as usize] = true;
            }
        }
    }
    (keep, components)
}

// --- Louvain ----------------------------------------------------------------

/// A weighted undirected graph, which is what one level of Louvain works over.
///
/// The original graph is unweighted; every level after the first is an aggregation where an
/// edge's weight is how many edges ran between the two communities, and a self-loop is how many
/// ran inside one. Modularity needs both.
struct Weighted {
    /// `(neighbour, weight)` per node, excluding self-loops.
    adj: Vec<Vec<(u32, f64)>>,
    /// Weight of edges from a node to itself, counted once.
    loops: Vec<f64>,
    /// Sum of incident weights, self-loops counted twice — the `k_i` of the modularity formula.
    degree: Vec<f64>,
    /// Twice the total edge weight: the `2m` every gain is divided by.
    total: f64,
}

impl Weighted {
    /// The first level: the real graph, restricted to the words `local` gives a dense id to.
    fn of(graph: &Graph, local: &[u32], size: usize) -> Weighted {
        let mut adj = vec![Vec::new(); size];
        for id in 0..graph.words.len() {
            let a = local[id];
            if a == u32::MAX {
                continue;
            }
            for &other in graph.neighbors(id as u32) {
                let b = local[other as usize];
                if b != u32::MAX {
                    adj[a as usize].push((b, 1.0));
                }
            }
        }
        Weighted::from(adj, vec![0.0; size])
    }

    fn from(adj: Vec<Vec<(u32, f64)>>, loops: Vec<f64>) -> Weighted {
        let degree: Vec<f64> = adj
            .iter()
            .zip(&loops)
            .map(|(row, &self_loop)| row.iter().map(|&(_, w)| w).sum::<f64>() + 2.0 * self_loop)
            .collect();
        let total = degree.iter().sum::<f64>().max(1.0);
        Weighted { adj, loops, degree, total }
    }
}

/// One pass of Louvain to convergence, then aggregate and repeat.
///
/// Returns the community of every node of the first level, numbered arbitrarily but densely.
fn louvain(level: &mut Weighted, seed: u64) -> Vec<u32> {
    let mut mapping: Vec<u32> = (0..level.adj.len() as u32).collect();
    loop {
        let assignment = one_level(level, seed);
        let count = assignment.iter().copied().max().map_or(0, |m| m as usize + 1);
        // Nothing merged, so no further level can merge anything either.
        if count == level.adj.len() {
            return mapping;
        }
        for community in &mut mapping {
            *community = assignment[*community as usize];
        }
        *level = aggregate(level, &assignment, count);
    }
}

/// Move nodes between communities until no single move improves modularity.
///
/// The gain from putting node `i` into community `c`, once `i` has been taken out of its own, is
/// `w(i,c) - k_i * Σtot(c) / 2m` up to a constant factor that is the same for every candidate —
/// so the comparison below is the whole of the algorithm's decision.
fn one_level(level: &Weighted, seed: u64) -> Vec<u32> {
    let size = level.adj.len();
    let mut community: Vec<u32> = (0..size as u32).collect();
    let mut inside: Vec<f64> = level.degree.clone();

    // Visiting in id order biases the result: the word list is alphabetical and this graph is
    // about substrings, so neighbouring ids are unusually likely to be neighbours in the graph
    // and the first communities formed would follow the alphabet. A fixed shuffle costs nothing
    // and is just as reproducible.
    let order = shuffle(size, seed);

    // `links` is reused across nodes; `seen` stamps which communities it currently holds so it
    // can be cleared in the time it takes to list them rather than the size of the graph.
    let mut links: Vec<f64> = vec![0.0; size];
    let mut touched: Vec<u32> = Vec::new();

    for _ in 0..MAX_PASSES {
        let mut moved = false;
        for &node in &order {
            let was = community[node as usize];
            inside[was as usize] -= level.degree[node as usize];

            for &id in &touched {
                links[id as usize] = 0.0;
            }
            touched.clear();
            for &(other, weight) in &level.adj[node as usize] {
                let c = community[other as usize];
                if links[c as usize] == 0.0 {
                    touched.push(c);
                }
                links[c as usize] += weight;
            }

            // Staying put is a candidate like any other, and it is the one to beat — so it goes
            // first and every tie leaves the node where it is.
            let mut best = was;
            let mut gain = links[was as usize] - inside[was as usize] * level.degree[node as usize] / level.total;
            // Sorted, so which of two equally good communities wins does not depend on the
            // order the neighbour list happened to be built in.
            touched.sort_unstable();
            for &c in &touched {
                let candidate = links[c as usize] - inside[c as usize] * level.degree[node as usize] / level.total;
                if candidate > gain + f64::EPSILON {
                    best = c;
                    gain = candidate;
                }
            }

            inside[best as usize] += level.degree[node as usize];
            community[node as usize] = best;
            if best != was {
                moved = true;
            }
        }
        if !moved {
            break;
        }
    }

    // Renumber densely, in first-appearance order.
    let mut dense = vec![u32::MAX; size];
    let mut next = 0u32;
    for node in 0..size {
        let c = community[node] as usize;
        if dense[c] == u32::MAX {
            dense[c] = next;
            next += 1;
        }
        community[node] = dense[c];
    }
    community
}

/// How many times the whole node set may be swept before a level gives up. Convergence is
/// usually five or six sweeps; the cap is only there so a pathological graph cannot spin.
const MAX_PASSES: usize = 32;

/// Collapse each community to a node, summing the edges between them and inside them.
fn aggregate(level: &Weighted, assignment: &[u32], count: usize) -> Weighted {
    let mut adj: Vec<Vec<(u32, f64)>> = vec![Vec::new(); count];
    let mut loops = vec![0.0; count];
    // One accumulator row, reused, so this is linear in the edges rather than quadratic in the
    // communities.
    let mut weights: Vec<f64> = vec![0.0; count];
    let mut touched: Vec<u32> = Vec::new();

    // Members per community, gathered once. Walking every node per community instead would be
    // quadratic, and at this scale that is the difference between milliseconds and minutes.
    let mut members: Vec<Vec<u32>> = vec![Vec::new(); count];
    for (node, &owner) in assignment.iter().enumerate() {
        members[owner as usize].push(node as u32);
    }

    for (community, own) in members.iter().enumerate() {
        touched.clear();
        for &node in own {
            loops[community] += level.loops[node as usize];
            for &(other, weight) in &level.adj[node as usize] {
                let c = assignment[other as usize];
                if c as usize == community {
                    // Each internal edge is seen from both ends, so a half each.
                    loops[community] += weight / 2.0;
                } else {
                    if weights[c as usize] == 0.0 {
                        touched.push(c);
                    }
                    weights[c as usize] += weight;
                }
            }
        }
        touched.sort_unstable();
        for &c in &touched {
            adj[community].push((c, weights[c as usize]));
            weights[c as usize] = 0.0;
        }
    }
    Weighted::from(adj, loops)
}

/// A fixed permutation of `0..size`, from `seed`.
///
/// Fisher–Yates over xorshift64*, which is a dozen lines and reproducible anywhere — the point
/// is only that the order is unrelated to the alphabet, not that it is random.
fn shuffle(size: usize, seed: u64) -> Vec<u32> {
    let mut order: Vec<u32> = (0..size as u32).collect();
    let mut state = seed | 1;
    for i in (1..order.len()).rev() {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let j = (state.wrapping_mul(0x2545_F491_4F6C_DD1D) % (i as u64 + 1)) as usize;
        order.swap(i, j);
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{FxMap, Graph};

    /// The partition read the other way round: which region each word landed in. What the
    /// client builds when it reads the file, and what a test wants to assert against.
    fn placement(found: &Regions, size: usize) -> Vec<Option<u32>> {
        let mut of = vec![None; size];
        for (index, region) in found.regions.iter().enumerate() {
            for &word in &region.words {
                of[word as usize] = Some(index as u32);
            }
        }
        of
    }

    /// A graph from `(big, small)` word-name pairs, so a test reads as the shape it means.
    fn graph_of(edges: &[(&str, &str)], extra: &[&str]) -> Graph {
        let mut words: Vec<String> = Vec::new();
        for (a, b) in edges {
            words.push((*a).to_string());
            words.push((*b).to_string());
        }
        words.extend(extra.iter().map(|w| (*w).to_string()));
        words.sort();
        words.dedup();
        let index: FxMap<String, u32> =
            words.iter().enumerate().map(|(i, w)| (w.clone(), i as u32)).collect();
        let mut pairs: Vec<(u32, u32)> = edges
            .iter()
            .map(|(a, b)| {
                let (x, y) = (index[*a], index[*b]);
                if x > y { (x, y) } else { (y, x) }
            })
            .collect();
        pairs.sort_unstable();
        pairs.dedup();
        let mut adjacency = vec![Vec::new(); words.len()];
        for &(a, b) in &pairs {
            adjacency[a as usize].push(b);
            adjacency[b as usize].push(a);
        }
        Graph { words, index, edges: pairs, adjacency }
    }

    #[test]
    fn leaves_out_small_components() {
        // Two triangles joined by nothing, plus a lone pair and a lone word.
        let graph = graph_of(
            &[
                ("aa", "ab"), ("ab", "ac"), ("ac", "aa"),
                ("ba", "bb"), ("bb", "bc"), ("bc", "ba"),
                ("ca", "cb"),
            ],
            &["solo"],
        );
        let rank = vec![0; graph.words.len()];
        let found = build(&graph, 3, &rank, 7);
        let of = placement(&found, graph.words.len());

        assert_eq!(found.components, 2, "two triangles survive, the pair and the loner do not");
        assert_eq!(found.dropped, 3, "both of the pair, and the loner");
        for word in ["ca", "cb", "solo"] {
            assert_eq!(of[graph.id(word).unwrap() as usize], None);
        }
        for word in ["aa", "ab", "ac", "ba", "bb", "bc"] {
            assert!(of[graph.id(word).unwrap() as usize].is_some(), "{word} is on the map");
        }
    }

    #[test]
    fn separates_clumps() {
        // Two dense clumps of four, joined by a single edge. Any partition worth the name puts
        // them in different regions.
        let graph = graph_of(
            &[
                ("aa", "ab"), ("aa", "ac"), ("aa", "ad"), ("ab", "ac"), ("ab", "ad"), ("ac", "ad"),
                ("ba", "bb"), ("ba", "bc"), ("ba", "bd"), ("bb", "bc"), ("bb", "bd"), ("bc", "bd"),
                ("ad", "ba"),
            ],
            &[],
        );
        let rank = vec![0; graph.words.len()];
        let found = build(&graph, 3, &rank, 7);

        assert_eq!(found.components, 1, "one component, because of the bridge");
        assert_eq!(found.regions.len(), 2, "but two regions");
        let of = placement(&found, graph.words.len());
        let region = |w: &str| of[graph.id(w).unwrap() as usize];
        assert_eq!(region("aa"), region("ab"));
        assert_eq!(region("aa"), region("ac"));
        assert_ne!(region("aa"), region("ba"));
    }

    #[test]
    fn every_word_kept_is_in_exactly_one_region() {
        let graph = graph_of(
            &[
                ("aa", "ab"), ("ab", "ac"), ("ac", "ad"), ("ad", "ae"), ("ae", "af"),
                ("af", "ag"), ("ag", "ah"), ("ah", "aa"), ("ac", "ag"),
            ],
            &[],
        );
        let rank = vec![0; graph.words.len()];
        let found = build(&graph, 3, &rank, 20260725);

        let of = placement(&found, graph.words.len());
        let mut counted = 0;
        for (index, region) in found.regions.iter().enumerate() {
            counted += region.words.len();
            for &word in &region.words {
                assert_eq!(of[word as usize], Some(index as u32));
            }
            assert!(region.words.windows(2).all(|w| w[0] < w[1]), "members ascend");
        }
        assert_eq!(counted + found.dropped, graph.words.len());
    }

    #[test]
    fn names_a_region_after_its_best_known_word() {
        let graph = graph_of(&[("aa", "ab"), ("ab", "ac"), ("ac", "aa")], &[]);
        // `ab` is the most frequent of the three.
        let mut rank = vec![usize::MAX; graph.words.len()];
        rank[graph.id("aa").unwrap() as usize] = 900;
        rank[graph.id("ab").unwrap() as usize] = 12;
        rank[graph.id("ac").unwrap() as usize] = 400;
        let found = build(&graph, 3, &rank, 7);

        assert_eq!(found.regions.len(), 1);
        assert_eq!(graph.word(found.regions[0].name), "ab");
    }

    #[test]
    fn is_the_same_every_run() {
        let graph = graph_of(
            &[
                ("aa", "ab"), ("ab", "ac"), ("ac", "aa"), ("ac", "ad"),
                ("ad", "ae"), ("ae", "af"), ("af", "ad"),
            ],
            &[],
        );
        let rank = vec![0; graph.words.len()];
        let once = build(&graph, 3, &rank, 20260725);
        let twice = build(&graph, 3, &rank, 20260725);
        assert_eq!(
            placement(&once, graph.words.len()),
            placement(&twice, graph.words.len())
        );
    }
}
