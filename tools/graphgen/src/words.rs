//! Loading word lists.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

fn scowl_url(size: u32) -> String {
    format!(
        "http://app.aspell.net/create?max_size={size}&spelling=US&max_variant=0\
         &diacritic=strip&download=wordlist&encoding=utf-8&format=inline"
    )
}

/// Fetch into the cache if absent. Shells out to curl rather than taking an HTTP
/// dependency; this runs once per word list and then never again.
fn ensure_cached(cache: &Path, name: &str, url: &str) -> Result<PathBuf, String> {
    let path = cache.join(name);
    if path.exists() {
        return Ok(path);
    }
    fs::create_dir_all(cache).map_err(|e| format!("could not create {}: {e}", cache.display()))?;
    eprintln!("  downloading {name}");
    let output = Command::new("curl")
        .args(["-sSL", "--max-time", "120", "-o"])
        .arg(&path)
        .arg(url)
        .output()
        .map_err(|e| format!("could not run curl: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&path);
        return Err(format!(
            "curl failed for {name}: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(path)
}

/// A SCOWL list, lowercase entries only.
///
/// SCOWL puts a prose header before the words and preserves capitalisation, so
/// keeping lines that are entirely lowercase ASCII letters skips the header and
/// drops proper nouns (Heather, Ford, Lear, Superman) in the same pass.
pub fn load_scowl(cache: &Path, size: u32) -> Result<HashSet<String>, String> {
    let path = ensure_cached(cache, &format!("scowl{size}.txt"), &scowl_url(size))?;
    let text = read_lossy(&path)?;
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase()))
        .map(str::to_string)
        .collect())
}

const FREQ_URL: &str = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/\
                        master/content/2018/en/en_50k.txt";

/// Words ranked most to least frequent. Supplies an *ordering* only — it decides
/// which endpoints feel familiar, never which words are legal.
pub fn load_frequency(cache: &Path) -> Result<Vec<String>, String> {
    let path = ensure_cached(cache, "en_50k.txt", FREQ_URL)?;
    let text = read_lossy(&path)?;
    Ok(text
        .lines()
        .filter_map(|line| line.split(' ').next())
        .map(str::trim)
        .filter(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase()))
        .map(str::to_string)
        .collect())
}

/// A newline list with `#` comments, as used for the blocklist and affix list.
pub fn load_list(path: &Path) -> Result<HashSet<String>, String> {
    if !path.exists() {
        return Ok(HashSet::new());
    }
    let text = read_lossy(path)?;
    Ok(text
        .lines()
        .map(|line| line.split('#').next().unwrap_or("").trim().to_lowercase())
        .filter(|w| !w.is_empty())
        .collect())
}

fn read_lossy(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("could not read {}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn write_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let mut file =
        fs::File::create(path).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    file.write_all(contents.as_bytes())
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}
