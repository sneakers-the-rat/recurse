//! Which board every band shows on every day.
//!
//! Three things are asked of the calendar, in this order:
//!
//! 1. **No two boards on one day share a chain.** Hard
//! 2. **As few repeated words as possible between one day's boards.** Soft, and ranked above
//!    everything below it — a word on two of today's boards is the next thing down from a chain.
//! 3. **A chain's appearances as far apart as the calendar allows.** Soft, and measured against
//!    what is *possible*
//!
//! Only boards of the same mode can collide at all — a chain is three nodes of one graph, and
//! the two games have different graphs in different alphabets — so the letters bands and the
//! phonemes bands are scheduled against each other and not against one another's.
//!
//! Since bands are all of different lengths, we repeat the shorter ones, shuffling them as well, such that all bands are equal length.

use crate::config::Shared;
use crate::graph::{FxMap, Graph};
use crate::select::{Puzzle, Selection};

/// How many candidates a day looks at before settling for the best it has seen.
///
/// The first card off a deck clears the chain test about seven times in eight, so this is not
/// about *finding* a legal board — it is about having enough to choose between for the two soft
/// tests. **It is the whole of what chain spacing costs**, and the trade is a shallow curve
/// against a steep one — how far a chain gets from itself, as a share of the best it could do,
/// against how long a deal takes over 171,000 boards:
///
///     window      16     64    128    256    512
///     crowded  32.9%  21.8%  17.5%  15.1%  13.9%
///     deal        6s    16s    26s    56s   156s
///
/// 128 is where the seconds start buying tenths. Turn it down if a taste loop needs the
/// calendar back faster; nothing else in the file depends on the number.
const WINDOW: usize = 128;

/// How deep to dig when the window is all conflicts, before giving up on a clean day.
///
/// Only the last cards of a deck ever need this: by then the pass is nearly over, what is left
/// is what nothing else wanted, and the day's other boards are already down.
const DIG: usize = 4096;

/// What a word shared between two of a day's boards costs, against the chain-spacing score.
///
/// One, and the spacing score is a mean of ratios and so never reaches one: that is the whole
/// of what ranks the second promise above the third. A repeated word settles the choice
/// outright, and spacing decides between boards that repeat the same number of words.
const WORD_COST: f64 = 1.0;

/// Extra, on top of `WORD_COST`, for a word that is one board's *endpoint*.
///
/// An endpoint is named in the header and in the share text, so the same word heading two of a
/// day's boards reads as a mistake where the same word in the middle of both reads as the
/// language being what it is.
const ENDPOINT_COST: f64 = 4.0;

/// What reusing an endpoint inside `minGap` days costs.
///
/// The one promise this file inherited: a word that headed a board last week should not head
/// another one today. Priced above a shared word because it is the older complaint and the one
/// `minGap` exists to answer.
const RECENT_COST: f64 = 8.0;

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

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = (self.next() % (i as u64 + 1)) as usize;
            items.swap(i, j);
        }
    }
}

/// What every band shows on every day, and what it draws when it does.
///
/// Indices into the bank rather than ids, because the calendar is read beside the puzzles it
/// names — by the writer, which wants the id, and by the report, which wants the board. The
/// boards travel with it because reading 171,000 of them into chains is the expensive part of
/// this file and the report asks the same questions of them the deal did.
pub struct Calendar {
    pub days: usize,
    /// Per band, the puzzle shown on each of `days` days.
    pub bands: Vec<Vec<u32>>,
    drawn: Vec<Drawn>,
    /// How far apart each chain could be at best. See `fair_gaps`.
    fair: Vec<f64>,
}

impl Calendar {
    pub fn on(&self, band: usize, day: usize) -> u32 {
        self.bands[band][day]
    }
}

/// What a board draws, in the two shapes the day's tests ask about.
///
/// Words and chains are both interned per **mode**, so a letters board and a phonemes board
/// can never be found to share anything: they are three nodes of different graphs, and the
/// numbers would otherwise happen to line up.
struct Drawn {
    /// The board's words, as ids in its own mode's word space.
    words: Vec<u32>,
    /// Every three words of the board joined by two moves, interned per mode.
    chains: Vec<u32>,
    /// The two endpoints, as word ids. First in `words` too — this is which of them they are.
    ends: [u32; 2],
    mode: usize,
}

/// One mode's chains, and how often each of them has to come round.
struct Chains {
    /// `fair[c]` is the most days a chain can hope to be from itself: the calendar divided by
    /// how many times it is going to be drawn. A chain half the bank draws is on the board
    /// every other day no matter what anybody schedules, so measuring it against a fixed
    /// target would just report that the language is the shape it is. See the spacing score
    /// in `cost`.
    fair: Vec<f64>,
    /// The last day each chain was drawn, as `day + 1`, so zero reads as never.
    last: Vec<u32>,
    /// Which day each chain is spoken for, as `day + 1`. The hard test.
    today: Vec<u32>,
}

/// Every three-word run of a board, interned.
///
/// A chain is a *path*, so `a - m - c` and `c - m - a` are one thing and the ends are sorted.
/// Nothing is said about direction: a move is an insertion or a removal and the two are
/// inverses, so a chain read either way is the same stretch of graph.
fn chains_of(
    board: &[u32],
    graph: &Graph,
    seen: &mut FxMap<u64, u32>,
    next: &mut u32,
    out: &mut Vec<u32>,
) {
    let mut inside: Vec<u32> = board.to_vec();
    inside.sort_unstable();
    let mut ends: Vec<u32> = Vec::new();
    for &middle in board {
        ends.clear();
        ends.extend(
            graph.neighbors(middle).iter().copied().filter(|w| inside.binary_search(w).is_ok()),
        );
        ends.sort_unstable();
        for (i, &a) in ends.iter().enumerate() {
            for &c in &ends[i + 1..] {
                // Three 21-bit fields. The largest dictionary is 188,763 words, so the room
                // above that is what the assertion in `read_boards` is checking for.
                let key = ((a as u64) << 42) | ((middle as u64) << 21) | c as u64;
                let id = *seen.entry(key).or_insert_with(|| {
                    let id = *next;
                    *next += 1;
                    id
                });
                out.push(id);
            }
        }
    }
    out.sort_unstable();
    out.dedup();
}

/// Read every puzzle's board into the two shapes a day is judged on, and say how many distinct
/// chains they came to.
fn read_boards(
    puzzles: &[Puzzle],
    graph_of_mode: &[&Graph],
    mode_of_band: &[usize],
) -> (Vec<Drawn>, u32) {
    for graph in graph_of_mode {
        assert!(graph.words.len() < (1 << 21), "a chain key holds 21 bits of word id");
    }
    let mut interned: Vec<FxMap<u64, u32>> =
        (0..graph_of_mode.len()).map(|_| FxMap::default()).collect();
    let mut next = 0u32;
    let mut drawn: Vec<Drawn> = Vec::with_capacity(puzzles.len());
    for puzzle in puzzles {
        let mode = mode_of_band[puzzle.band];
        let graph = graph_of_mode[mode];
        // A board word with no id is a board written against another vocabulary, which the
        // digests make impossible; skipping rather than panicking keeps this a scheduler.
        let mut words: Vec<u32> = puzzle.board.split(' ').filter_map(|w| graph.id(w)).collect();
        let mut chains = Vec::new();
        chains_of(&words, graph, &mut interned[mode], &mut next, &mut chains);
        // Both lists sorted, because every test either file makes of them is a membership one.
        words.sort_unstable();
        let ends = [
            graph.id(&puzzle.source).unwrap_or(u32::MAX),
            graph.id(&puzzle.target).unwrap_or(u32::MAX),
        ];
        drawn.push(Drawn { words, chains, ends, mode });
    }
    (drawn, next)
}

/// Put the whole bank on the calendar.
///
/// Runs once over every mode's puzzles at once, which is the point of it: a day holds a board
/// of every band, so avoiding a repeat within one game means knowing what the other bands of
/// that game have already put down.
///
/// Separate from `select` so that redealing the calendar does not mean repeating the search:
/// `seed` and `minGap` reach only this function, and `bandCuts` only the banding that precedes
/// it.
pub fn deal(
    selection: &mut Selection,
    shared: &Shared,
    bands: usize,
    graph_of_mode: &[&Graph],
    mode_of_band: &[usize],
) -> Calendar {
    let (drawn, chain_count) = read_boards(&selection.puzzles, graph_of_mode, mode_of_band);

    // Each band's whole list, in a canonical order before anything is shuffled: selection
    // order depends on hash iteration and thread scheduling, and without this a rebuild would
    // silently reassign every calendar date.
    let mut in_band: Vec<Vec<u32>> = vec![Vec::new(); bands];
    for (at, puzzle) in selection.puzzles.iter().enumerate() {
        in_band[puzzle.band.min(bands.saturating_sub(1))].push(at as u32);
    }
    for list in in_band.iter_mut() {
        list.sort_by(|&a, &b| {
            let (x, y) = (&selection.puzzles[a as usize], &selection.puzzles[b as usize]);
            (&x.source, &x.target).cmp(&(&y.source, &y.target))
        });
    }

    let days = in_band.iter().map(Vec::len).max().unwrap_or(0);
    let fair = fair_gaps(&drawn, &in_band, chain_count, days);
    if days == 0 {
        return Calendar { days: 0, bands: vec![Vec::new(); bands], drawn, fair };
    }

    let mut chains = Chains {
        fair,
        last: vec![0; chain_count as usize],
        today: vec![0; chain_count as usize],
    };

    // One stamp array per mode, over its own word space: which day each word is on a board
    // already down, and which day it was last an endpoint. Stamps rather than sets, so a day
    // costs nothing to start.
    let mut word_today: Vec<Vec<u32>> =
        graph_of_mode.iter().map(|g| vec![0u32; g.words.len()]).collect();
    let mut end_today: Vec<Vec<u32>> =
        graph_of_mode.iter().map(|g| vec![0u32; g.words.len()]).collect();
    let mut end_day: Vec<Vec<u32>> =
        graph_of_mode.iter().map(|g| vec![0u32; g.words.len()]).collect();

    let mut rng: Vec<Rng> =
        (0..bands).map(|b| Rng(shared.seed ^ (b as u64).wrapping_mul(0x9E37_79B9))).collect();
    let mut deck: Vec<Vec<u32>> = vec![Vec::new(); bands];
    let mut out: Vec<Vec<u32>> = (0..bands).map(|_| Vec::with_capacity(days)).collect();

    // Bands are taken in order of how little choice they have left, so the deck that is nearly
    // out chooses while the day is still empty. Their lengths differ, so which band that is
    // moves through the year.
    let mut order: Vec<usize> = (0..bands).collect();
    // Where a pass ran out of anything clean, and where that pass began — the two things a
    // repair needs, since a card may only be swapped with another card of its own pass.
    let mut stuck: Vec<(usize, usize, usize)> = Vec::new();
    let mut began: Vec<usize> = vec![0; bands];

    for day in 0..days {
        let stamp = day as u32 + 1;
        order.sort_by_key(|&b| if deck[b].is_empty() { in_band[b].len() } else { deck[b].len() });
        for &band in &order {
            if in_band[band].is_empty() {
                continue;
            }
            if deck[band].is_empty() {
                deck[band] = in_band[band].clone();
                rng[band].shuffle(&mut deck[band]);
                began[band] = day;
            }
            let (at, clean) = choose(
                &deck[band],
                &drawn,
                &chains,
                &word_today,
                &end_today,
                &end_day,
                day,
                shared.min_gap,
            );
            if !clean {
                stuck.push((band, day, began[band]));
            }
            let picked = deck[band].swap_remove(at);
            let board = &drawn[picked as usize];
            for &c in &board.chains {
                chains.today[c as usize] = stamp;
                chains.last[c as usize] = stamp;
            }
            for &w in &board.words {
                word_today[board.mode][w as usize] = stamp;
            }
            for &e in &board.ends {
                if (e as usize) < end_today[board.mode].len() {
                    end_today[board.mode][e as usize] = stamp;
                    end_day[board.mode][e as usize] = stamp;
                }
            }
            out[band].push(picked);
        }
    }

    let mut calendar = Calendar { days, bands: out, drawn, fair: chains.fair };
    let left = repair(&mut calendar, &stuck, mode_of_band, shared.seed);
    if left > 0 {
        eprintln!(
            "  calendar: {left} of {} boards still share a chain with their own day",
            days * bands
        );
    }

    // A puzzle's *first* day, which is what the header calls a board opened by its id rather
    // than by a date. Read off the finished calendar, because a repair moves boards about.
    let mut dated: Vec<bool> = vec![false; selection.puzzles.len()];
    for band in 0..bands {
        for day in 0..calendar.bands[band].len() {
            let at = calendar.bands[band][day] as usize;
            if !dated[at] {
                selection.puzzles[at].day = day;
                dated[at] = true;
            }
        }
    }
    calendar
}

/// How far a repair will look through a pass for a card to trade with.
///
/// Eight in nine boards are clean against any given day, so a trade is nearly always the first
/// thing tried; this is the ceiling for the case where the day is genuinely awkward.
const TRADE: usize = 4096;

/// Trade the boards a pass could not place cleanly for ones from elsewhere in the same pass.
///
/// A deck runs dry from the bottom: by the last few cards of a pass, what is left is what the
/// rest of the year did not want, and one of them can be a board whose every chain is already
/// on its day. It is never *stuck*, though — the same pass has thousands of days holding a card
/// that would go there happily, and swapping the two leaves every other promise intact, since
/// both boards stay in the pass they were dealt from and so still appear exactly once in it.
///
/// Returns how many it could not fix, which is the number the day-pair count in `report` must
/// agree with.
fn repair(
    calendar: &mut Calendar,
    stuck: &[(usize, usize, usize)],
    mode_of_band: &[usize],
    seed: u64,
) -> usize {
    let mut rng = Rng(seed ^ 0x5DEE_CE66);
    let mut left = 0usize;
    for &(band, day, began) in stuck {
        // The pass this card belongs to: from the day the deck was shuffled to the day before
        // it next was, which is this day at the latest.
        let span = day - began;
        if span == 0 {
            left += 1;
            continue;
        }
        let mut traded = false;
        for _ in 0..TRADE.min(span * 2) {
            let other = began + (rng.next() % span as u64) as usize;
            let here = calendar.bands[band][day];
            let there = calendar.bands[band][other];
            if clashes(calendar, mode_of_band, band, other, here)
                || clashes(calendar, mode_of_band, band, day, there)
            {
                continue;
            }
            calendar.bands[band].swap(day, other);
            traded = true;
            break;
        }
        if !traded {
            left += 1;
        }
    }
    left
}

/// Would this board share a chain with the rest of that day?
///
/// The rest being the other bands of its own game: a chain is three nodes of one graph, so a
/// board of the other game cannot collide with it however the numbers fall.
fn clashes(
    calendar: &Calendar,
    mode_of_band: &[usize],
    band: usize,
    day: usize,
    board: u32,
) -> bool {
    let board = &calendar.drawn[board as usize];
    (0..calendar.bands.len()).any(|other| {
        other != band
            && mode_of_band[other] == mode_of_band[band]
            && calendar.drawn[calendar.on(other, day) as usize]
                .chains
                .iter()
                .any(|c| board.chains.binary_search(c).is_ok())
    })
}

/// How far apart each chain could be at best: the calendar divided by how often it is drawn.
///
/// A band shorter than the calendar comes round `days / len` times, so each of its puzzles —
/// and so each chain on it — is drawn that many times. A chain nothing can space out is one
/// this must not pretend to have spaced out, which is why the spacing score is a ratio against
/// this rather than a count of days.
fn fair_gaps(drawn: &[Drawn], in_band: &[Vec<u32>], chains: u32, days: usize) -> Vec<f64> {
    let mut shows = vec![0f64; chains as usize];
    for list in in_band {
        if list.is_empty() {
            continue;
        }
        let rounds = days as f64 / list.len() as f64;
        for &at in list {
            for &c in &drawn[at as usize].chains {
                shows[c as usize] += rounds;
            }
        }
    }
    shows
        .into_iter()
        .map(|n| if n <= 1.0 { days as f64 } else { (days as f64 / n).max(1.0) })
        .collect()
}

/// Pick a card, and say whether it cost anything.
///
/// Returns the position in the deck and whether the board it chose is free of every chain
/// already on the day — the one thing this is not allowed to trade away quietly.
#[allow(clippy::too_many_arguments)]
fn choose(
    deck: &[u32],
    drawn: &[Drawn],
    chains: &Chains,
    word_today: &[Vec<u32>],
    end_today: &[Vec<u32>],
    end_day: &[Vec<u32>],
    day: usize,
    min_gap: usize,
) -> (usize, bool) {
    let stamp = day as u32 + 1;
    let mut best: Option<(usize, f64)> = None;
    let mut looked = 0usize;
    // The least-bad card, for a deck whose every remaining board repeats something. Only the
    // dregs of a pass ever reach it.
    let mut fallback: Option<(usize, usize)> = None;

    for (at, &puzzle) in deck.iter().enumerate() {
        if looked >= WINDOW || at >= DIG {
            break;
        }
        let board = &drawn[puzzle as usize];
        let clashes =
            board.chains.iter().filter(|&&c| chains.today[c as usize] == stamp).count();
        if clashes > 0 {
            if fallback.is_none_or(|(_, worst)| clashes < worst) {
                fallback = Some((at, clashes));
            }
            continue;
        }
        looked += 1;
        let price = cost(board, chains, word_today, end_today, end_day, day, min_gap);
        if best.is_none_or(|(_, so_far)| price < so_far) {
            best = Some((at, price));
        }
    }

    match best {
        Some((at, _)) => (at, true),
        None => (fallback.map(|(at, _)| at).unwrap_or(0), false),
    }
}

/// What putting this board on this day costs, in the two soft tests.
///
/// Words first and spacing second, and the split is deliberate: the spacing term is a mean of
/// ratios and so is always below one, which makes it a tie-break between boards that repeat
/// the same number of words rather than something that can buy a repeat.
#[allow(clippy::too_many_arguments)]
fn cost(
    board: &Drawn,
    chains: &Chains,
    word_today: &[Vec<u32>],
    end_today: &[Vec<u32>],
    end_day: &[Vec<u32>],
    day: usize,
    min_gap: usize,
) -> f64 {
    let stamp = day as u32 + 1;
    let mode = board.mode;
    let mut price = 0.0;
    for &w in &board.words {
        if word_today[mode][w as usize] == stamp {
            price += WORD_COST;
        }
    }
    for &e in &board.ends {
        let at = e as usize;
        if at >= end_day[mode].len() {
            continue;
        }
        if end_today[mode][at] == stamp {
            price += ENDPOINT_COST;
        }
        let last = end_day[mode][at];
        if last > 0 && (stamp - last) as usize <= min_gap {
            price += RECENT_COST;
        }
    }

    // How early this board's chains are, each as a share of its own fair gap: near 1 for one
    // drawn yesterday, 0 for one that has had its whole turn away and 0 for one never drawn at
    // all. Averaged, not summed, or a board with fewer chains would win for having less to say.
    if !board.chains.is_empty() {
        let mut early = 0.0;
        for &c in &board.chains {
            let last = chains.last[c as usize];
            if last == 0 {
                continue;
            }
            let fair = chains.fair[c as usize];
            let gap = (stamp - last) as f64;
            if gap < fair {
                early += (fair - gap) / fair;
            }
        }
        price += early / board.chains.len() as f64;
    }
    price
}

/// What the calendar came out like: the report a change to any of this is read against.
///
/// Per mode, because a chain belongs to one graph and the two games have different ones — and
/// because the banks are different sizes, so a figure blended over both is mostly a statement
/// about which game has more boards.
pub fn report(calendar: &Calendar, mode_of_band: &[usize], names: &[&str]) {
    let drawn = &calendar.drawn;
    let fair = &calendar.fair;
    let chain_count = fair.len();

    let mut days_line: Vec<String> = Vec::new();
    let mut gaps_line: Vec<String> = Vec::new();
    for (mode, name) in names.iter().enumerate() {
        let of_mode: Vec<usize> =
            (0..calendar.bands.len()).filter(|&b| mode_of_band[b] == mode).collect();
        if of_mode.len() < 2 {
            continue;
        }

        let mut pairs = 0usize;
        let mut chain_pairs = 0usize;
        let mut word_pairs = 0usize;
        let mut words_shared = 0usize;
        // Every gap between one appearance of a chain and the next, as a share of that chain's
        // own fair gap. One number, whatever the chain: 1.0 is a chain as far from itself as it
        // can get, and anything below is the calendar crowding it.
        let mut ratios: Vec<f32> = Vec::new();
        let mut last = vec![0u32; chain_count];
        let mut today: Vec<u32> = vec![0; chain_count];
        // A chain on the board two mornings running, which is the repeat most likely to be
        // noticed, and the days where one was unavoidable — a chain drawn so often that its
        // own fair gap is under two days has nowhere else to go.
        let mut adjacent_days = 0usize;
        let mut forced_days = 0usize;

        for day in 0..calendar.days {
            let stamp = day as u32 + 1;
            let boards: Vec<&Drawn> =
                of_mode.iter().map(|&b| &drawn[calendar.on(b, day) as usize]).collect();
            for (i, a) in boards.iter().enumerate() {
                for b in &boards[i + 1..] {
                    pairs += 1;
                    if a.chains.iter().any(|c| b.chains.binary_search(c).is_ok()) {
                        chain_pairs += 1;
                    }
                    let words = a.words.iter().filter(|w| b.words.binary_search(w).is_ok()).count();
                    words_shared += words;
                    if words > 0 {
                        word_pairs += 1;
                    }
                }
            }
            let mut adjacent = false;
            let mut forced = false;
            for board in &boards {
                for &c in &board.chains {
                    let at = c as usize;
                    if today[at] == stamp {
                        continue;
                    }
                    today[at] = stamp;
                    if last[at] > 0 {
                        let gap = stamp - last[at];
                        ratios.push(gap as f32 / fair[at] as f32);
                        if gap == 1 {
                            adjacent = true;
                            forced |= fair[at] < 2.0;
                        }
                    }
                    last[at] = stamp;
                }
            }
            adjacent_days += usize::from(adjacent);
            forced_days += usize::from(forced);
        }

        days_line.push(format!(
            "    {:<9} {:>10} {:>10} {:>10} {:>11.3}",
            name,
            pairs,
            chain_pairs,
            word_pairs,
            words_shared as f64 / pairs.max(1) as f64,
        ));
        ratios.sort_by(f32::total_cmp);
        let at = |p: f64| ratios.get((ratios.len() as f64 * p) as usize).copied().unwrap_or(0.0);
        let crowded = ratios.iter().filter(|&&r| r < 0.5).count();
        gaps_line.push(format!(
            "    {:<9} {:>6.2} {:>6.2} {:>6.2} {:>8.1}% {:>8} {:>8}",
            name,
            at(0.1),
            at(0.5),
            at(0.9),
            100.0 * crowded as f64 / ratios.len().max(1) as f64,
            adjacent_days,
            forced_days,
        ));
    }

    eprintln!("\n  calendar ({} days, one board of every band on each):", calendar.days);
    eprintln!(
        "    {:<9} {:>10} {:>10} {:>10} {:>11}",
        "mode", "day-pairs", "a chain", "a word", "words/pair"
    );
    for line in &days_line {
        eprintln!("{line}");
    }
    eprintln!("    two boards of one day sharing a three-word run, and sharing any word at all");
    eprintln!(
        "\n    {:<9} {:>6} {:>6} {:>6} {:>9} {:>8} {:>8}",
        "mode", "p10", "p50", "p90", "crowded", "adjacent", "forced"
    );
    for line in &gaps_line {
        eprintln!("{line}");
    }
    eprintln!(
        "    how far a chain gets from itself, as a share of its own fair gap: 1.00 is the\n    \
         best there is and crowded is under half of it. adjacent: days drawing a chain also\n    \
         drawn the day before; forced: of those, days where some such chain had nowhere else\n    \
         to go, its fair gap being under two days"
    );
}
