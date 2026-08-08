# Phase 6 — Config & Settings GUI

**Status: built, unverified on screen. One item deliberately not built — "set as default terminal", see *Status / Learned*.** The file, both directions of the sync, the loop guard, the startup directory and the elevation toggle are all in `src-tauri/src/config.rs` and the settings panel. The *Verify* list at the bottom has not been run.

## Original plan

- Config at Tauri's `path::app_config_dir()`:
  - Windows — `%APPDATA%\vados\config.toml`
  - Linux — `~/.config/vados/config.toml`
  - Never hardcode these; Tauri resolves per-platform.
- Schema:
  ```toml
  [appearance]
  accent = "#7e55dd"
  font   = "mono"      # system | mono | claude-sans

  [shell]
  cwd = "~/projects"

  [system]
  default_terminal = false
  start_as_admin   = false
  ```
- Write defaults on first run if the file is absent.
- **GUI → file:** settings overlay (gear, top-right) with toggles and swatches; changes write TOML immediately and apply live.
- **File → GUI:** watch with `notify`, debounced ~200 ms (editors flush in several writes), re-read and push state to the frontend.
- Guard against the write-loop: ignore watcher events the app itself caused.
- `[shell].cwd` is the PTY spawn directory — consumed at the Phase 1 spawn call, which currently passes `null`.

## Settings surface

Fixed and curated — this is not an extension point.

| Setting | Control |
|---|---|
| Startup directory | Text input + native folder picker |
| Accent color | Swatches: indigo (default), blue, yellow, orange |
| Font | Three-way toggle: System / Mono / Claude Sans Modern |
| Set as default terminal | Toggle. Windows: `DelegationConsole`/`DelegationTerminal` registry keys. Linux: `x-terminal-emulator` alternative (Debian/Ubuntu) or per-DE equivalent. Off by default — this is a system-wide change, toggling off must cleanly restore the prior default. |
| Shell | Dropdown of **detected** shells, plus a custom binary field. Owned by [phase-12-shell-hosting.md](phase-12-shell-hosting.md); the schema slot belongs here. Never list a shell that is not installed. |
| Theme | Built-in themes plus anything in the themes directory. Owned by [phase-11-theme-engine.md](phase-11-theme-engine.md). The accent swatches stay the primary control; themes sit behind them, not in front. |
| Start as administrator / root | Toggle. Windows: requires an embedded manifest (`requestedExecutionLevel`) or a relaunch-elevated shim — a running process cannot self-elevate via UAC without one. Linux: no true equivalent; toggle instead controls whether the spawned shell is wrapped in `sudo -E`/`pkexec`. Needs a restart to take effect either way — surface that in the toggle's copy, don't silently no-op. |

Panel opens in place over the terminal with a blurred backdrop — not a separate window. Animated per `ANIMATION.md`.

## Status / Learned

- **The schema stores keys, not resolved values.** The plan's `accent = "#7e55dd"` became `accent = "indigo"`, and `font` takes the `FONT_MODES` key. A hex in the file is a value nothing can validate, and it is the value a theme ([phase-11-theme-engine.md](phase-11-theme-engine.md)) would then contradict — the token layer already derives every tint from one accent, so the name is the whole setting. Two sections were added for what the panel had already grown past the original schema: `[behavior]` for scroll and reveal mode, which were `localStorage` keys with no schema slot at all.
- **`#[serde(default)]` on every struct, not just the root.** It is what makes a hand-edited file safe: a missing section, a missing key, or a key from a future version each degrade to the default rather than failing the load and throwing away the rest of the user's file.
- **The loop guard is content comparison, and the gotcha list was right that a debounce is not enough.** Every write records the exact document it produced; the watcher reads the file and ignores it if it still reads back as those bytes. A debounce can only make a bounce late, it cannot tell whose write it was. The 200ms settle is still there, but for the other problem — an editor's save arrives as several events and the intermediate ones are routinely truncated files.
- **The watcher watches the directory, per the gotcha, and it also has to.** Most editors replace a file rather than writing into it, which drops a file-only watch on the first external save — the watch would survive exactly one edit.
- **A file that exists but does not parse is not overwritten.** It is somebody mid-edit. The session runs on defaults and the next save re-fires the watcher. Only an *absent* file gets defaults written to it.
- **The first frame is always the defaults.** `config_load` is a round trip, so a restored non-default accent lands a frame or two after mount. Holding the terminal back on a file read would cost every launch to save one flicker. If it reads badly on screen, the fix is to resolve the accent in Rust and hand it to the webview as a window property, not to make the boot synchronous.
- **`applyConfig` deliberately does not go through the setters.** The setters exist to record a *gesture* — they save, and they play the glitch on the label the user just clicked. Neither is true of a change the file made, and saving from there would move the write-loop to the frontend side of the guard.
- **Elevation is Unix-only, after the Windows half was built, tested, and reverted.** Linux wraps the spawned shell in `sudo -E` and leaves the webview unprivileged; `-E` is load-bearing, it carries `ZDOTDIR` and therefore the integration snippet into the elevated session. **Windows has no honest equivalent and the switch is absent there.** The relaunch-through-UAC route was written and it worked — a launch log showed one relaunch, one exit, one window per cycle — and the app was still broken, because the config cannot be read until `setup`, which Tauri runs *after* creating the windows declared in `tauri.conf.json`. Killing a parent that has already built a webview ends the `tauri dev` session and races the child for the shared `EBWebView` folder. Three real bugs were found and fixed on the way there (an env var ShellExecute does not carry across UAC, a graceful exit with no event loop to run on, a debug build's console window the elevated child cannot inherit) in a design that was wrong regardless. Full reasoning in [../decisions.md](../decisions.md). Reopening it means a `requestedExecutionLevel` manifest — always elevated, therefore not a toggle — or a launcher shim that decides before any window exists.
- **`~` expansion lives in `config.rs`, not at the spawn call.** `CommandBuilder::cwd` takes a path, not a shell word, and an unexpanded `~` fails as a directory that is not there.
- **"Set as default terminal" was not built, and should not be faked.** On Windows the `DelegationConsole` / `DelegationTerminal` keys under `HKCU\Console\%%Startup` take the GUID of a *registered console delegation handler* — a COM server implementing the console handoff interfaces, which VAD/OS does not have and cannot get from a registry write. Writing our own identifier there does not make us the default terminal, it points the OS at a handler that does not exist, i.e. it breaks the user's console. On Linux the `x-terminal-emulator` alternative needs root and only covers Debian-family systems. A toggle that silently fails is worse than an absent one, so the row is absent. Tracked in [../tasks.md](../tasks.md).

## Verify

Nothing below has been run.

- Change the accent in the GUI → the TOML file updates.
- Edit the TOML in an external editor → the UI updates without a restart.
- Delete the config → defaults regenerate.
- No feedback loop: a GUI-originated write must not bounce back through the watcher and re-apply.
- Set a startup directory, restart: the shell opens there. Set `~/something`, restart: it expands.
- Corrupt the file (an unterminated string), save: the app keeps running and does not rewrite the file. Fix the file: the UI catches up without a restart.
- Linux only: toggle start-as-root on and restart — the shell prompts for a password and the session is root, while the app itself is not. The switch must not appear on Windows at all.

## Gotchas to watch

- `~` in `cwd` needs expanding before it reaches `CommandBuilder::cwd()`. It is not shell-expanded there.
- Changing `cwd` in settings does not affect the already-running shell. Decide: apply on next launch only, or offer a restart-session action.
- The watcher fires on the app's own writes. Debounce alone is not enough — track a write generation or compare content.
- Accent changes must also update the xterm.js theme object, which does not read CSS vars. See [phase-4-styling.md](phase-4-styling.md).
- **"Set as default terminal" and "Start as administrator" both need elevation to write** (registry under `HKLM`, or an admin-manifest relaunch) — the toggle flip itself must trigger a UAC/`pkexec` prompt, it cannot silently write and fail. Treat a rejected prompt as toggle-off, not an error state.
- **The schema grows in two directions later.** [phase-11-theme-engine.md](phase-11-theme-engine.md) adds a themes directory beside `config.toml`, and [phase-12-shell-hosting.md](phase-12-shell-hosting.md) adds a `[[shell.profiles]]` array. Neither needs building now, but the watcher should watch the config *directory*, not the single file, or the theme reload later needs a second watcher for no reason.
- **"Start as administrator" changes the manifest/launch path, not runtime state** — flipping it does nothing to the current session. The toggle must say so and apply on next launch only, same open question as `cwd` above.
