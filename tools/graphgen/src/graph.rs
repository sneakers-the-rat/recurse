//! Building the move graph, and searching it.
//!
//! The hot loop is finding edges: for every word, every contiguous run of at
//! least `min_sub` letters that is itself a word, where deleting it leaves
//! another word. That is ~190k words times ~50 substrings each, and it is why
//! this part is not in Python — the same work took minutes there and takes a
//! couple of seconds here.

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// FxHash. Words are short ASCII strings and there is no adversarial input, so
/// SipHash's collision resistance is pure overhead; this is several times faster
/// on the tens of millions of lookups the edge scan performs.
#[derive(Default)]
pub struct FxHasher {
    hash: u64,
}

const SEED: u64 = 0x51_7c_c1_b7_27_22_0a_95;

impl Hasher for FxHasher {
    #[inline]
    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.hash = (self.hash.rotate_left(5) ^ u64::from(byte)).wrapping_mul(SEED);
        }
    }
    #[inline]
    fn write_u8(&mut self, byte: u8) {
        self.hash = (self.hash.rotate_left(5) ^ u64::from(byte)).wrapping_mul(SEED);
    }
    #[inline]
    fn finish(&self) -> u64 {
        self.hash
    }
}

pub type FxBuild = BuildHasherDefault<FxHasher>;
pub type FxMap<K, V> = HashMap<K, V, FxBuild>;
pub type FxSet<T> = std::collections::HashSet<T, FxBuild>;

/// One legal move, as word indices plus where the subword sat.
#[derive(Clone, Copy, Debug)]
pub struct Edge {
    pub big: u32,
    pub small: u32,
    /// Start of the run inside `big`. Also the insertion index into `small`,
    /// because big == small[..pos] + sub + small[pos..].
    pub pos: u32,
    pub sub_len: u32,
}

/// An undirected graph over a fixed, sorted word list.
pub struct Graph {
    pub words: Vec<String>,
    pub index: FxMap<String, u32>,
    pub edges: Vec<Edge>,
    /// Neighbour lists, indexed by word id.
    pub adjacency: Vec<Vec<u32>>,
}

impl Graph {
    pub fn degree(&self, word: u32) -> usize {
        self.adjacency[word as usize].len()
    }

    pub fn neighbors(&self, word: u32) -> &[u32] {
        &self.adjacency[word as usize]
    }

    pub fn id(&self, word: &str) -> Option<u32> {
        self.index.get(word).copied()
    }

    pub fn word(&self, id: u32) -> &str {
        &self.words[id as usize]
    }
}

/// Find every edge among `nodes`, where a removable run must appear in `subs`.
///
/// `nodes` must be sorted; ids are indices into it.
pub fn build(
    nodes: Vec<String>,
    subs: &FxSet<&str>,
    min_word: usize,
    min_sub: usize,
    internal_only: bool,
    threads: usize,
) -> Graph {
    let index: FxMap<String, u32> = nodes
        .iter()
        .enumerate()
        .map(|(i, w)| (w.clone(), i as u32))
        .collect();

    let chunk = nodes.len().div_ceil(threads.max(1));
    let mut edges: Vec<Edge> = Vec::new();

    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for start in (0..nodes.len()).step_by(chunk.max(1)) {
            let end = (start + chunk).min(nodes.len());
            let nodes = &nodes;
            let index = &index;
            handles.push(scope.spawn(move || {
                let mut found: Vec<Edge> = Vec::new();
                // Reused so the inner loop does not allocate per candidate.
                let mut scratch = String::with_capacity(64);
                for id in start..end {
                    let big = nodes[id].as_str();
                    let bytes = big.as_bytes();
                    let n = bytes.len();
                    for i in 0..n {
                        for j in (i + min_sub)..=n {
                            if internal_only && (i == 0 || j == n) {
                                continue;
                            }
                            // Length of what remains after deleting big[i..j].
                            if n - (j - i) < min_word {
                                continue;
                            }
                            let sub = &big[i..j];
                            if !subs.contains(sub) {
                                continue;
                            }
                            scratch.clear();
                            scratch.push_str(&big[..i]);
                            scratch.push_str(&big[j..]);
                            if let Some(&small) = index.get(scratch.as_str()) {
                                found.push(Edge {
                                    big: id as u32,
                                    small,
                                    pos: i as u32,
                                    sub_len: (j - i) as u32,
                                });
                            }
                        }
                    }
                }
                found
            }));
        }
        for handle in handles {
            edges.extend(handle.join().expect("edge worker panicked"));
        }
    });

    // Deterministic regardless of how the work was split across threads.
    edges.sort_unstable_by_key(|e| (e.big, e.small, e.pos, e.sub_len));

    let mut adjacency = vec![Vec::new(); nodes.len()];
    for edge in &edges {
        adjacency[edge.big as usize].push(edge.small);
        adjacency[edge.small as usize].push(edge.big);
    }
    for list in &mut adjacency {
        list.sort_unstable();
        list.dedup();
    }

    Graph {
        words: nodes,
        index,
        edges,
        adjacency,
    }
}

/// Reusable breadth-first search scratch space.
///
/// Selection runs hundreds of thousands of searches, so the distance array is
/// allocated once and cleared by generation stamp rather than being rebuilt.
pub struct Bfs {
    dist: Vec<u32>,
    stamp: Vec<u32>,
    generation: u32,
    queue: std::collections::VecDeque<u32>,
    pub touched: Vec<u32>,
}

pub const UNREACHED: u32 = u32::MAX;

impl Bfs {
    pub fn new(size: usize) -> Bfs {
        Bfs {
            dist: vec![UNREACHED; size],
            stamp: vec![0; size],
            generation: 0,
            queue: std::collections::VecDeque::new(),
            touched: Vec::new(),
        }
    }

    #[inline]
    pub fn get(&self, word: u32) -> u32 {
        if self.stamp[word as usize] == self.generation {
            self.dist[word as usize]
        } else {
            UNREACHED
        }
    }

    /// Distances from `src`, out to `max_depth`. Visited ids land in `touched`.
    pub fn run(&mut self, graph: &Graph, src: u32, max_depth: u32) {
        self.generation += 1;
        self.queue.clear();
        self.touched.clear();

        self.dist[src as usize] = 0;
        self.stamp[src as usize] = self.generation;
        self.queue.push_back(src);
        self.touched.push(src);

        while let Some(word) = self.queue.pop_front() {
            let d = self.dist[word as usize];
            if d >= max_depth {
                continue;
            }
            for &next in graph.neighbors(word) {
                if self.stamp[next as usize] != self.generation {
                    self.stamp[next as usize] = self.generation;
                    self.dist[next as usize] = d + 1;
                    self.touched.push(next);
                    self.queue.push_back(next);
                }
            }
        }
    }
}

