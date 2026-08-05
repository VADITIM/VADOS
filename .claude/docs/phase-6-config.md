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
