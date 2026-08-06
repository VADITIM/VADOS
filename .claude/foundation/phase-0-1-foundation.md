# Phase 0 + 1 — Toolchain & Working PTY

**Status: code complete, Phase 1 awaiting manual verification.**

## Original plan

**Phase 0 — Toolchain & scaffold**
- Install Rust via rustup; on Windows this also requires MSVC C++ build tools.
- On Arch: `webkit2gtk-4.1`, `gtk3`, `libayatana-appindicator`, `librsvg`.
- Scaffold with `create-tauri-app` → Svelte + TypeScript.
- Verify: blank Tauri window launches.

**Phase 1 — A terminal that actually works**
- Spawn a PTY with `portable-pty`; PowerShell on Windows, `$SHELL` on Linux.
- Stream output to the frontend via `tauri::ipc::Channel`.
- Raw xterm.js, full window. Bytes in, keystrokes back.
- Wire PTY resize to window resize.
- Verify: `git status`, `npm --version`, `vim` + `:q`, Ctrl+C interrupt, window resize reflows.

## Done

- Rust 1.97.1 + cargo installed. MSVC linker confirmed working — full Tauri build links clean.
- Scaffolded SvelteKit + TS. Generated into a scratchpad dir and moved in, because the repo root already held `README.md` and `vados-concept.png`; the original README was preserved.
- `src-tauri/src/pty.rs` — `pty_spawn` / `pty_write` / `pty_resize`, reader thread streaming 8 KB chunks as `InvokeResponseBody::Raw`.
- `src-tauri/src/lib.rs` — commands registered, `PtyState` managed.
- `src/routes/+page.svelte` — full-window xterm.js + `FitAddon`, `ResizeObserver` → `pty_resize`.
- Builds clean, app launches, no runtime errors.

## Learned / gotchas

- **The Bash tool's PATH does not pick up `~/.cargo/bin`** until the terminal restarts. PowerShell resolves it from the machine/user environment. Export it manually in Bash: `export PATH="$PATH:/c/Users/vadim/.cargo/bin"`.
- **npm 11 gates install scripts.** esbuild's postinstall is blocked until `npm approve-scripts esbuild` runs. Vite will not work without it. Expect the same on a fresh clone.
- **`drop(pair.slave)` after spawning is required** — without it the reader thread never sees EOF when the shell exits.
- Windows linker emits a harmless German-language `linker stdout` warning about `.dll.lib` / `.dll.exp` creation on every build. Not an error, ignore it.
- VS Code is **not** a substitute for MSVC build tools — Rust needs an actual linker.

## Remaining

Manual verification of the Phase 1 list above. Nothing can be confirmed from logs alone; it needs a human at the keyboard.

## Not yet done (deferred by design)

- `cwd` is passed as `null` — the config-driven spawn directory lands in Phase 6.
- No shell integration yet; there are no command boundaries until Phase 2.
- Styling is placeholder. Phase 4 owns it.
