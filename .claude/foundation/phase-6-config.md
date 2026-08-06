# Phase 6 — Config & Settings GUI

**Status: not started.**

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

## Verify

- Change the accent in the GUI → the TOML file updates.
- Edit the TOML in an external editor → the UI updates without a restart.
- Delete the config → defaults regenerate.
- No feedback loop: a GUI-originated write must not bounce back through the watcher and re-apply.

## Gotchas to watch

- `~` in `cwd` needs expanding before it reaches `CommandBuilder::cwd()`. It is not shell-expanded there.
- Changing `cwd` in settings does not affect the already-running shell. Decide: apply on next launch only, or offer a restart-session action.
- The watcher fires on the app's own writes. Debounce alone is not enough — track a write generation or compare content.
- Accent changes must also update the xterm.js theme object, which does not read CSS vars. See [phase-4-styling.md](phase-4-styling.md).
- **"Set as default terminal" and "Start as administrator" both need elevation to write** (registry under `HKLM`, or an admin-manifest relaunch) — the toggle flip itself must trigger a UAC/`pkexec` prompt, it cannot silently write and fail. Treat a rejected prompt as toggle-off, not an error state.
- **The schema grows in two directions later.** [phase-11-theme-engine.md](phase-11-theme-engine.md) adds a themes directory beside `config.toml`, and [phase-12-shell-hosting.md](phase-12-shell-hosting.md) adds a `[[shell.profiles]]` array. Neither needs building now, but the watcher should watch the config *directory*, not the single file, or the theme reload later needs a second watcher for no reason.
- **"Start as administrator" changes the manifest/launch path, not runtime state** — flipping it does nothing to the current session. The toggle must say so and apply on next launch only, same open question as `cwd` above.
