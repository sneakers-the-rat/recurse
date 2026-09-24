//! Partitions a mode's legal graph into regions, the open map's territories.
//!
//! The client lays words out inside a region and regions against each other, and names each
//! region on the map. It is computed here so every map of a mode has the same regions and they
//! do not move as words are revealed. Over the legal graph, so every word a guess can reach from
//! the map has a region.
//!
//! Components smaller than `min_component` are left off the map (the words stay legal guesses);
//! Louvain partitions the rest, deterministically for a given seed. A word with one move is then
//! put in its neighbour's region.

use crate::graph::Graph;

/// One territory: the words in it, and the word it is named after.
pub struct Region {
    /// The most frequent member.
    pub name: u32,
    /// Member ids, in the graph this was built over. Ascending.
    pub words: Vec<u32>,
}

pub struct Regions {
    pub regions: Vec<Region>,
    /// Words in components below `min_component`, including every word with no moves.
    pub dropped: usize,
    /// Components that survived the filter. Louvain may split one into several regions.
    pub components: usize,
    /// Words with one move that Louvain had put outside their neighbour's region.
    pub leaves_moved: usize,
}

/// How the regions came out, for the build's report. Not a median: the many three- and
/// four-word components would put it at 3.
pub struct Sizes {
    pub count: usize,
    pub largest: usize,
    /// Regions of at least `REAL` words, and how many words they hold.
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

/// Size from which `Sizes` counts a region. Reporting only.
const REAL: usize = 10;

/// Partition `graph`, keeping only components of at least `min_component` words.
///
/// `rank` is each word's frequency position (lower is more frequent), used only to name regions.
/// `seed` fixes Louvain's visiting order; see `shuffle`.
pub fn build(graph: &Graph, min_component: usize, rank: &[usize], seed: u64) -> Regions {
    let n = graph.words.len();
    let (keep, components) = large_components(graph, min_component);

    // Louvain runs over the surviving words only, renumbered densely.
    let mut local = vec![u32::MAX; n];
    let mut back: Vec<u32> = Vec::new();
    for (id, &kept) in keep.iter().enumerate() {
        if kept {
            local[id] = back.len() as u32;
            back.push(id as u32);
        }
    }

    let mut level = Weighted::of(graph, &local, back.len());
    let mut communities = louvain(&mut level, seed);

    // A word with one move belongs with the word it is joined to. Its neighbour has at least two
    // moves, since a kept component has at least `min_component` words.
    let mut leaves_moved = 0;
    for (dense, &id) in back.iter().enumerate() {
        let near: Vec<u32> = graph
            .neighbors(id)
            .iter()
            .map(|&other| local[other as usize])
            .filter(|&other| other != u32::MAX)
            .collect();
        if let [only] = near[..] {
            let theirs = communities[only as usize];
            if communities[dense] != theirs {
                communities[dense] = theirs;
                leaves_moved += 1;
            }
        }
    }

    // Ordered by first member so the output is stable.
    let mut members: Vec<Vec<u32>> = vec![Vec::new(); communities.iter().copied().max().map_or(0, |m| m as usize + 1)];
    for (dense, &community) in communities.iter().enumerate() {
        members[community as usize].push(back[dense]);
    }
    members.retain(|words| !words.is_empty());
    members.sort_by_key(|words| words[0]);

    let mut regions = Vec::with_capacity(members.len());
    for words in members {
        // Ties, including a wholly unranked region, go to the lowest id.
        let name = *words
            .iter()
            .min_by_key(|&&w| (rank.get(w as usize).copied().unwrap_or(usize::MAX), w))
            .expect("a region is never empty");
        regions.push(Region { name, words });
    }

    Regions { regions, dropped: keep.iter().filter(|&&k| !k).count(), components, leaves_moved }
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

/// One level of Louvain. After the first, a node is a community of the level below, an edge's
/// weight is the edges between two communities, and a self-loop the edges inside one.
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
    /// The first level: `graph` restricted to the words `local` gives a dense id to.
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

/// Louvain: move nodes to convergence, aggregate, repeat until nothing merges. Returns each
/// first-level node's community, numbered densely.
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
/// The gain from moving node `i` into community `c` is `w(i,c) - k_i * Σtot(c) / 2m`, up to a
/// factor common to every candidate.
fn one_level(level: &Weighted, seed: u64) -> Vec<u32> {
    let size = level.adj.len();
    let mut community: Vec<u32> = (0..size as u32).collect();
    let mut inside: Vec<f64> = level.degree.clone();

    // Ids are alphabetical, and alphabetical neighbours are often graph neighbours, so visiting
    // in id order would bias communities toward the alphabet.
    let order = shuffle(size, seed);

    // `links` is reused across nodes; `touched` lists which entries are set so clearing it is
    // proportional to the node's degree.
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

            // Staying put goes first, so a tie leaves the node where it is.
            let mut best = was;
            let mut gain = links[was as usize] - inside[was as usize] * level.degree[node as usize] / level.total;
            // Sorted, so ties do not depend on neighbour order.
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

/// Cap on sweeps per level.
const MAX_PASSES: usize = 32;

/// Collapse each community to a node, summing the edges between them and inside them.
fn aggregate(level: &Weighted, assignment: &[u32], count: usize) -> Weighted {
    let mut adj: Vec<Vec<(u32, f64)>> = vec![Vec::new(); count];
    let mut loops = vec![0.0; count];
    // One accumulator row, reused, so this is linear in the edges.
    let mut weights: Vec<f64> = vec![0.0; count];
    let mut touched: Vec<u32> = Vec::new();

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

/// A fixed permutation of `0..size` from `seed`: Fisher–Yates over xorshift64*.
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

    /// Which region each word is in.
    fn placement(found: &Regions, size: usize) -> Vec<Option<u32>> {
        let mut of = vec![None; size];
        for (index, region) in found.regions.iter().enumerate() {
            for &word in &region.words {
                of[word as usize] = Some(index as u32);
            }
        }
        of
    }

    /// A graph from pairs of word names, plus unconnected `extra` words.
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
        // Two cliques of four, joined by one edge.
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

    #[test]
    fn puts_a_word_with_one_move_in_its_neighbours_region() {
        // Two clumps joined by a bridge, with leaves hanging off both clumps and the bridge.
        let graph = graph_of(
            &[
                ("aa", "ab"), ("aa", "ac"), ("aa", "ad"), ("ab", "ac"), ("ab", "ad"), ("ac", "ad"),
                ("ba", "bb"), ("ba", "bc"), ("ba", "bd"), ("bb", "bc"), ("bb", "bd"), ("bc", "bd"),
                ("ad", "ba"),
                ("aa", "la"), ("ba", "lb"), ("ad", "lc"), ("ba", "ld"),
            ],
            &[],
        );
        let rank = vec![0; graph.words.len()];
        let found = build(&graph, 3, &rank, 7);
        let of = placement(&found, graph.words.len());
        let region = |w: &str| of[graph.id(w).unwrap() as usize];
        for (leaf, parent) in [("la", "aa"), ("lb", "ba"), ("lc", "ad"), ("ld", "ba")] {
            assert_eq!(region(leaf), region(parent), "{leaf} is with {parent}");
        }
    }
}
