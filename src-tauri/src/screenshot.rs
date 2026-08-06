//! F2 debug screenshot.
//!
//! Captures the app window and writes it to `demo/` in the repo, then rewrites
//! the demo section of `README.md` so the gallery stays in sync with whatever
//! is on disk. Development tool only — the target directory is resolved from
//! `CARGO_MANIFEST_DIR`, which points at the source tree, not at an install.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use xcap::Window as CaptureWindow;

const START: &str = "<!-- demo:start -->";
const END: &str = "<!-- demo:end -->";

/// Repo root, resolved at compile time from the crate directory.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

/// Capture the window named `title` and save it under `demo/`.
///
/// Returns the file name that was written.
#[tauri::command]
pub fn screenshot(window: tauri::Window) -> Result<String, String> {
    let title = window.title().map_err(|e| e.to_string())?;

    // Match on title rather than pid: on Windows the webview runs in a child
    // process, so the pid of the Tauri process is not the pid that owns the
    // visible window.
    let windows = CaptureWindow::all().map_err(|e| e.to_string())?;
    let target = windows
        .into_iter()
        .filter(|w| w.title().map(|t| t == title).unwrap_or(false))
        // Largest, not first: WebView2 puts helper windows under the same
        // title, and one of them is a ~139x26 strip of the caption buttons.
        // Picking the first match captured that strip instead of the app.
        .max_by_key(|w| {
            let (width, height) = (w.width().unwrap_or(0) as u64, w.height().unwrap_or(0) as u64);
            width * height
        })
        .ok_or_else(|| format!("no window titled {title:?}"))?;

    let image = target.capture_image().map_err(|e| e.to_string())?;

    let root = repo_root();
    let dir = root.join("demo");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // ponytail: unix seconds, not a formatted date — no chrono dependency for
    // a filename nobody reads as a date. Two shots in the same second collide;
    // the second one wins, which is the right outcome anyway.
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let name = format!("vados-{stamp}.png");
    image.save(dir.join(&name)).map_err(|e| e.to_string())?;

    update_readme(&root, &dir)?;
    Ok(name)
}

/// Rewrite the block between the demo markers in `README.md` with every PNG
/// currently in `demo/`, newest first. Missing markers are not an error — the
/// screenshot is still on disk, only the gallery is skipped.
fn update_readme(root: &Path, dir: &Path) -> Result<(), String> {
    let readme_path = root.join("README.md");
    let readme = match fs::read_to_string(&readme_path) {
        Ok(text) => text,
        Err(_) => return Ok(()),
    };
    let (Some(start), Some(end)) = (readme.find(START), readme.find(END)) else {
        return Ok(());
    };
    if end < start {
        return Ok(());
    }

    let mut shots: Vec<String> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| {
            let name = entry.ok()?.file_name().into_string().ok()?;
            name.ends_with(".png").then_some(name)
        })
        .collect();
    // Names are `vados-<unix seconds>.png`, so a lexical sort is a
    // chronological sort (oldest first) for as long as the epoch stays 10 digits.
    shots.sort_unstable();

    let gallery: String = shots
        .iter()
        .map(|name| format!("\n![{name}](demo/{name})\n"))
        .collect();

    let body = format!("{START}\n{gallery}{END}");
    let updated = format!("{}{}{}", &readme[..start], body, &readme[end + END.len()..]);
    fs::write(&readme_path, updated).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The marker slicing is the only part of this file that can silently
    /// corrupt something the user cares about, so it is the part with a test.
    #[test]
    fn rewrites_between_markers_and_leaves_the_rest_alone() {
        let dir = std::env::temp_dir().join("vados-screenshot-test");
        let _ = fs::remove_dir_all(&dir);
        let shots = dir.join("demo");
        fs::create_dir_all(&shots).unwrap();
        // Real stamps, because the lexical sort only equals a
        // chronological sort while every name has the same digit count.
        fs::write(shots.join("vados-1770000000.png"), []).unwrap();
        fs::write(shots.join("vados-1780000000.png"), []).unwrap();
        fs::write(shots.join("notes.txt"), []).unwrap();
        fs::write(
            dir.join("README.md"),
            format!("before\n{START}\nstale\n{END}\nafter\n"),
        )
        .unwrap();

        update_readme(&dir, &shots).unwrap();
        let out = fs::read_to_string(dir.join("README.md")).unwrap();

        assert!(out.starts_with("before\n"), "{out}");
        assert!(out.ends_with("\nafter\n"), "{out}");
        assert!(!out.contains("stale"), "{out}");
        assert!(!out.contains("notes.txt"), "{out}");
        // Oldest first.
        let newer = out.find("vados-1780000000.png").unwrap();
        let older = out.find("vados-1770000000.png").unwrap();
        assert!(older < newer, "expected the older shot first:\n{out}");

        // Idempotent: running twice must not nest or duplicate the block.
        update_readme(&dir, &shots).unwrap();
        let twice = fs::read_to_string(dir.join("README.md")).unwrap();
        assert_eq!(out, twice);

        fs::remove_dir_all(&dir).unwrap();
    }
}
