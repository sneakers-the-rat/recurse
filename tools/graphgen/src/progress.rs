//! A progress line for the phases that take minutes.
//!
//! Selection judges tens of millions of candidates across every thread, so the only
//! thing a shared counter has to be is cheap to bump: workers keep a local count and
//! flush it every `BATCH`, and one reporter thread does all the drawing. Relaxed
//! ordering is right because nothing reads the counter for anything but display.
//!
//! Drawing is only a carriage return when stderr is a terminal. Redirected to a file
//! it prints an ordinary line every few seconds instead, so a build log stays
//! readable.
//!
//! The same line is also written to `.claude-progress` in the repo root, which is
//! where a Claude Code status line reads it from: a build started in the background
//! has no terminal to draw on, and the status line is the one surface that updates on
//! its own while it runs. The file's mtime is what says the line is still live, so a
//! reader can ignore a stale one rather than showing a finished build forever.

use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// Where the live progress line is published, once someone says where the repo is.
static PUBLISH_TO: OnceLock<PathBuf> = OnceLock::new();

/// Publish progress into `root/.claude-progress` as well as onto stderr.
pub fn publish_in(root: &Path) {
    let _ = PUBLISH_TO.set(root.join(".claude-progress"));
}

/// Remove the published line, so a status line stops showing a build that is over.
pub fn published_done() {
    if let Some(path) = PUBLISH_TO.get() {
        let _ = std::fs::remove_file(path);
    }
}

/// How many items a worker counts locally before touching the shared total.
pub const BATCH: usize = 512;

const WIDTH: usize = 30;

/// Narrower for the status line, which shares one line with everything else on it.
const PUBLISHED_WIDTH: usize = 12;

pub struct Progress {
    label: &'static str,
    total: usize,
    done: AtomicUsize,
    finished: AtomicBool,
    started: Instant,
}

impl Progress {
    pub fn new(label: &'static str, total: usize) -> Progress {
        Progress {
            label,
            total,
            done: AtomicUsize::new(0),
            finished: AtomicBool::new(false),
            started: Instant::now(),
        }
    }

    /// Count `n` more items done. Called from every worker.
    pub fn advance(&self, n: usize) {
        self.done.fetch_add(n, Ordering::Relaxed);
    }

    /// Draw until `finish` is called. Runs on its own thread.
    pub fn watch(&self) {
        let tty = std::io::stderr().is_terminal();
        let tick = if tty { Duration::from_millis(120) } else { Duration::from_secs(5) };
        while !self.finished.load(Ordering::Relaxed) {
            self.draw(tty);
            std::thread::sleep(tick);
        }
        self.draw(tty);
        eprintln!();
    }

    /// Stop the reporter. Call once the work is joined.
    pub fn finish(&self) {
        self.finished.store(true, Ordering::Relaxed);
    }

    fn draw(&self, tty: bool) {
        let total = self.total.max(1);
        let done = self.done.load(Ordering::Relaxed).min(total);
        let fraction = done as f64 / total as f64;
        let elapsed = self.started.elapsed().as_secs_f64();
        // Assume the rest goes at the rate the part so far went. Nothing better is
        // available, and an estimate that moves is more use than no estimate.
        let left = if fraction > 0.0005 { elapsed / fraction - elapsed } else { f64::NAN };

        if tty {
            let filled = (fraction * WIDTH as f64).round() as usize;
            eprint!(
                "\r  {} [{}{}] {:>5.1}%  {} / {}  {} left    ",
                self.label,
                "=".repeat(filled),
                " ".repeat(WIDTH - filled),
                fraction * 100.0,
                count(done),
                count(total),
                clock(left),
            );
        } else {
            eprintln!(
                "  {} {:>5.1}%  {} / {}  {} left",
                self.label,
                fraction * 100.0,
                count(done),
                count(total),
                clock(left),
            );
        }
        let _ = std::io::stderr().flush();

        // A short bar for a status line, which has one line to share with everything
        // else on it. Failure to write is ignored: progress reporting must never be
        // the reason a build stops.
        if let Some(path) = PUBLISH_TO.get() {
            let filled = (fraction * PUBLISHED_WIDTH as f64).round() as usize;
            let _ = std::fs::write(
                path,
                format!(
                    "graphgen {} [{}{}] {:.0}% {} left",
                    self.label.trim(),
                    "=".repeat(filled),
                    " ".repeat(PUBLISHED_WIDTH - filled),
                    fraction * 100.0,
                    clock(left),
                ),
            );
        }
    }
}

/// Round counts, because the exact number of candidates judged so far is not a thing
/// anyone reads off a moving line.
fn count(n: usize) -> String {
    match n {
        n if n >= 10_000_000 => format!("{:.0}M", n as f64 / 1e6),
        n if n >= 1_000_000 => format!("{:.1}M", n as f64 / 1e6),
        n if n >= 10_000 => format!("{:.0}k", n as f64 / 1e3),
        n => n.to_string(),
    }
}

fn clock(seconds: f64) -> String {
    if !seconds.is_finite() {
        return "--:--".to_string();
    }
    let seconds = seconds.round() as u64;
    if seconds >= 3600 {
        format!("{}h{:02}m", seconds / 3600, (seconds % 3600) / 60)
    } else {
        format!("{:02}:{:02}", seconds / 60, seconds % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::{clock, count};

    #[test]
    fn shortens_counts_and_times() {
        assert_eq!(count(742), "742");
        assert_eq!(count(19_800), "20k");
        assert_eq!(count(1_250_000), "1.2M");
        assert_eq!(count(19_800_000), "20M");
        assert_eq!(clock(f64::NAN), "--:--");
        assert_eq!(clock(9.0), "00:09");
        assert_eq!(clock(605.0), "10:05");
        assert_eq!(clock(7_265.0), "2h01m");
    }
}
