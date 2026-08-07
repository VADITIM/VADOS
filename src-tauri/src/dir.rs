//! Directory listing for the input bar's completion menu.
//!
//! Deliberately dumb, like `pty.rs`: name and is-it-a-directory, nothing more.
//! Filtering, sorting, quoting and path joining all live in `src/lib/input.js`,
//! where they can be checked without a build.

use std::fs;

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
