//! `config.toml` — the settings file behind the settings panel.
//!
//! Two directions, both live:
//!
//! * **GUI to file** — `config_save` writes the whole document on every change.
//! * **File to GUI** — a `notify` watcher on the config *directory* re-reads it
//!   and emits `config-changed`. The directory rather than the file because a
//!   later theme directory lands beside it, and because most editors replace a
//!   file rather than writing into it, which drops a file-only watch.
//!
//! The loop guard is content comparison, not a debounce: a debounce cannot tell
//! the app's own write from an editor's, it can only make the bounce late.
//! Every write records the exact bytes it produced, and the watcher ignores a
//! file that still reads back as those bytes.

use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// Editors flush a save in several writes; this is how long the watcher waits
/// for the file to stop changing before it reads.
const SETTLE: Duration = Duration::from_millis(200);

/// Values are the frontend's own keys (`indigo`, `mixed`) rather than resolved
/// colours or font stacks. The token layer already derives every tint from one
/// accent, so storing `#7e55dd` would store a value nothing can validate and
/// that a theme would then contradict.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Appearance {
    pub accent: String,
    pub font: String,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            accent: "indigo".into(),
            font: "mixed".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Behavior {
    pub scroll: String,
    pub reveal: String,
}

impl Default for Behavior {
    fn default() -> Self {
        Self {
            scroll: "top".into(),
            reveal: "reveal".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Shell {
    /// PTY spawn directory. Empty means "wherever the app was launched from".
    /// `~` is expanded here — `CommandBuilder::cwd` does not shell-expand.
    pub cwd: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct System {
    /// Wraps the spawned shell in `sudo -E`, on next launch. **Unix only, and
    /// the key is deliberately inert on Windows** — see `decisions.md`. Windows
    /// elevation has to be the whole process, and relaunching the process
    /// through UAC from inside `setup` is too late to be safe: Tauri has
    /// already created the webview by then, so the parent had to be killed
    /// mid-initialisation, which detached the app from the dev CLI and raced
    /// the elevated child for the shared WebView2 data folder. On Windows the
    /// way to get an elevated session is to start the app elevated.
    pub start_as_admin: bool,
}

/// `#[serde(default)]` on every level is what makes a hand-edited file safe:
/// a missing section, a missing key, or a key the app has not shipped yet all
/// degrade to the default instead of failing the whole load.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Config {
    pub appearance: Appearance,
    pub behavior: Behavior,
    pub shell: Shell,
    pub system: System,
}

#[derive(Default)]
pub struct ConfigState {
    /// The exact document this process last wrote. See the loop guard above.
    written: Mutex<String>,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("config.toml"))
}

/// Read the config, writing defaults first if there is nothing to read.
///
/// A file that exists but does not parse is left alone and the defaults are
/// used for this session: overwriting it would delete whatever the user was
/// halfway through typing, and the watcher picks the file up the moment it
/// becomes valid.
pub fn load(app: &AppHandle) -> Config {
    let Ok(file) = path(app) else {
        return Config::default();
    };
    match std::fs::read_to_string(&file) {
        Ok(text) => toml::from_str(&text).unwrap_or_default(),
        Err(_) => {
            let config = Config::default();
            let _ = write(app, &config);
            config
        }
    }
}

fn write(app: &AppHandle, config: &Config) -> Result<String, String> {
    let file = path(app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = toml::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(&file, &text).map_err(|e| e.to_string())?;
    Ok(text)
}

#[tauri::command]
pub fn config_load(app: AppHandle) -> Config {
    load(&app)
}

#[tauri::command]
pub fn config_save(app: AppHandle, state: State<ConfigState>, config: Config) -> Result<(), String> {
    let text = write(&app, &config)?;
    *state.written.lock().unwrap() = text;
    Ok(())
}

/// Expand a leading `~`. Nothing below this expands it — `CommandBuilder::cwd`
/// is a raw path, not a shell word — and a literal `~` directory is what a
/// missing expansion silently creates a spawn failure against.
pub fn expand(dir: &str) -> Option<String> {
    let dir = dir.trim();
    if dir.is_empty() {
        return None;
    }
    let Some(rest) = dir.strip_prefix('~') else {
        return Some(dir.to_string());
    };
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()?;
    let rest = rest.trim_start_matches(['/', '\\']);
    Some(if rest.is_empty() {
        home
    } else {
        format!("{}{}{}", home, std::path::MAIN_SEPARATOR, rest)
    })
}

/// Watch the config directory and push external edits to the frontend.
///
/// The watcher is deliberately leaked into its own thread for the process
/// lifetime: there is exactly one config directory and one window, so a handle
/// to stop it would be a handle nothing ever calls.
pub fn watch(app: AppHandle) {
    let Ok(file) = path(&app) else { return };
    let Some(dir) = file.parent().map(|d| d.to_path_buf()) else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let Ok(mut watcher) = notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        }) else {
            return;
        };
        if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        loop {
            // Block for the first event, then drain until the file has been
            // quiet for SETTLE — an editor's save arrives as several events and
            // the intermediate ones are routinely truncated files.
            if rx.recv().is_err() {
                return;
            }
            while rx.recv_timeout(SETTLE).is_ok() {}

            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let state = app.state::<ConfigState>();
            if *state.written.lock().unwrap() == text {
                continue;
            }
            let Ok(config) = toml::from_str::<Config>(&text) else {
                // Mid-edit and not valid TOML yet. The next save re-fires.
                continue;
            };
            let _ = app.emit("config-changed", config);
        }
    });
}


#[cfg(test)]
mod tests {
    use super::*;

    /// The two things here that can be silently wrong: a partial file must not
    /// take the rest of the document down with it, and `~` must not survive
    /// into a spawn argument.
    #[test]
    fn partial_file_keeps_its_values_and_defaults_the_rest() {
        let config: Config = toml::from_str("[appearance]\naccent = \"blue\"\n").unwrap();
        assert_eq!(config.appearance.accent, "blue");
        assert_eq!(config.appearance.font, "mixed");
        assert_eq!(config.behavior.scroll, "top");
        assert!(!config.system.start_as_admin);
    }

    #[test]
    fn unknown_keys_do_not_fail_the_load() {
        let config: Config =
            toml::from_str("[appearance]\naccent = \"blue\"\ntheme = \"from-the-future\"\n")
                .unwrap();
        assert_eq!(config.appearance.accent, "blue");
    }

    #[test]
    fn a_written_config_reads_back_as_itself() {
        let mut config = Config::default();
        config.shell.cwd = "~/projects".into();
        let round_trip: Config = toml::from_str(&toml::to_string_pretty(&config).unwrap()).unwrap();
        assert_eq!(round_trip.shell.cwd, "~/projects");
    }

    #[test]
    fn expand_handles_the_three_shapes() {
        assert_eq!(expand(""), None);
        assert_eq!(expand("   "), None);
        assert_eq!(expand("/tmp/x"), Some("/tmp/x".into()));

        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap();
        assert_eq!(expand("~"), Some(home.clone()));
        // No `~` may survive, and no doubled separator either.
        let expanded = expand("~/projects").unwrap();
        assert!(expanded.starts_with(&home) && !expanded.contains('~'));
        assert!(expanded.ends_with("projects"));
        assert!(!expanded.contains("//") && !expanded.contains("\\\\"));
    }
}
