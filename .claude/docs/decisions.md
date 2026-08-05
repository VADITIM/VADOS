# Decisions

Settled. Check here before re-opening any of these.

## Product

**No real Docker.** "Container" throughout the original discussion means the UI-level fenced code block that isolates raw/live output so it cannot break the markdown layout. Commands execute on the host. Real containerisation was considered and rejected: it needs Docker Desktop on Windows, breaks the "run my local git/npm" expectation, and adds latency for no benefit here.

**No multi-tab.** Explicitly rejected — Windows Terminal has it and it goes unused; people open a second window instead.

**No plugin system.** Rejected. Settings are a fixed, curated GUI, not an extension surface.

**Settings are a GUI overlay, not a window.** Gear icon top-right, opens in place over the terminal with a blurred backdrop.

## Technical

**Tauri over Electron.** Small binary, native window, and the webview preserves full CSS freedom — no native widget lock-in. Electron would work but is heavier and worse on the performance axis that this project is built around.

**SvelteKit kept, not swapped for bare Svelte + Vite.** The scaffold ships SvelteKit in SPA mode (`adapter-static`, `ssr = false`). Its router is unused, but in SPA mode it costs nothing at runtime and re-scaffolding would be pure churn.

**xterm.js is the fallback, not the main view.** See [architecture.md](architecture.md). Consequence: xterm's own theming and font settings only matter inside alt-screen apps.

**Raw bytes over `tauri::ipc::Channel`, not `emit`.** Channels are the intended path for high-frequency binary streams; `emit` adds per-event JSON overhead. Rust never decodes to `String` — that would corrupt multi-byte characters split across reads.

**PowerShell on Windows, not `cmd.exe`.** `CommandBuilder::new_default_prog()` resolves to `cmd.exe` via `ComSpec`, so the shell is named explicitly instead.

**TOML over JSON for config.** Humans will hand-edit it. Comments, and no trailing-comma footguns.

**Config lives in the OS-standard dir** via Tauri's `path::app_config_dir()` — `%APPDATA%\vados\` on Windows, `~/.config/vados/` on Linux. Never hardcoded.

**OSC 133 over prompt heuristics.** Matching the prompt string breaks on custom prompts, multiline prompts, oh-my-zsh, and starship. The cost of OSC 133 is shell init injection; worth it.

## Animation

**GSAP, no alternatives.** See [../../ANIMATION.md](../../ANIMATION.md) for the binding rules.

**Stagger by rendered row, 0.12s.** Per-character staggering is forbidden — an 80-column line would take four seconds and produce thousands of tweens.

**Typewriter = one tween per row with `ease: steps(n)`.** A `clipPath` wipe with a stepped ease reads as character-by-character typing at ~1% of the tween count of real per-character animation.

**Fixed colors are exempt from theming.** Success green, error red, and muted grey never read from `--accent`. Only the app accent (indigo `#7e55dd` default, plus blue / yellow / orange) is swappable.
