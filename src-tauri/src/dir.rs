//! Directory listing for the input bar's completion menu, and `open <path>`.
//!
//! Deliberately dumb, like `pty.rs`: name and is-it-a-directory, nothing more.
//! Filtering, sorting, quoting and path joining all live in `src/lib/input.js`,
//! where they can be checked without a build.

use std::fs;
use std::path::Path;

#[derive(serde::Serialize)]
pub struct Entry {
    name: String,
    dir: bool,
}

/// Entries of `path`, unsorted and unfiltered. An unreadable directory is an
/// empty menu, not an error the user has to dismiss — Tab is pressed at
/// half-typed paths all day and most of them do not exist yet.
#[tauri::command]
pub fn list_dir(path: String) -> Vec<Entry> {
    let Ok(read) = fs::read_dir(&path) else {
        return Vec::new();
    };
    read.filter_map(|entry| entry.ok())
        .map(|entry| Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        })
        .collect()
}

/// Open a path with whatever the OS opens it with.
///
/// This calls `tauri_plugin_opener`'s **Rust** API rather than letting the
/// frontend call its JS one, and that is the whole point of the command
/// existing. The plugin's JS command is guarded by a path scope, which is the
/// right design for an app that knows in advance which files it touches and the
/// wrong one for a terminal: the path comes from a line the user typed at their
/// own prompt, so the only scope that would work is "everything", and a scope of
/// everything is a scope that lies about what it does. The check that matters
/// here is not which path — it is that a path reached this at all, which means
/// it came through `open`, which is app code and not command output.
///
/// The existence test is for the message, not for safety: without it a typo
/// comes back as whatever the shell association layer says, which on Windows is
/// an error code.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("no such path: {path}"));
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}
