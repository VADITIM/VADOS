# Architecture

## Stack

| Layer | Choice |
|---|---|
| Shell / native | Tauri v2 (Rust) |
| Frontend | SvelteKit 2 + Svelte 5, SPA mode via `adapter-static` |
| Build | Vite 6 |
| Terminal process | `portable-pty` 0.9 |
| Raw terminal render | xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) — **fallback only** |
| Animation | GSAP (+ SplitText) |
| Config | TOML (`toml` crate), watched with `notify` |
| Styles | SCSS over a CSS-custom-property token layer |

## The dual renderer

This is the load-bearing decision. Everything else hangs off it.

xterm.js is **not** the primary view. Since ~95% of output is markdown blocks with the input pinned at the bottom, two renderers share one PTY stream:

```
                 ┌──────────────────────────┐
  shell ──PTY──▶ │ Rust: parse OSC 133 / 7  │
                 │      + alt-screen detect │
                 └────────────┬─────────────┘
                              │ Tauri channel (raw bytes + events)
                 ┌────────────┴─────────────┐
                 ▼                          ▼
        Block renderer (default)     xterm.js (fallback)
        DOM sections, markdown,      raw passthrough,
        styled + animated            never intercepted
```

**Block renderer** — plain DOM. One `<section>` per command: divider, `#` command heading, output body, `##` result heading tinted by exit code. This is what gets styled and animated.

**xterm.js** — mounted only when the PTY emits alt-screen enter (`\x1b[?1049h`), torn down on exit (`\x1b[?1049l`). This is the `vim` / `htop` / `claude` CLI path. Raw bytes, no interception, **no animation** except the crossfade in and out.

### The live container

Output arriving *while a command is still running* goes into a `<pre>` container that preserves `white-space: pre` and monospace. This is where progress bars, ASCII banners, and ANSI color survive — the thing that would otherwise be destroyed by markdown prose styling.

ANSI → HTML conversion happens **only** here. Prose-styled markdown never touches raw bytes.

## Data flow

1. Rust reads PTY output in 8 KB chunks on a dedicated thread.
2. Bytes stream to the frontend over `tauri::ipc::Channel` as `InvokeResponseBody::Raw`. Deliberately *not* `emit` — channels avoid per-event JSON overhead on a high-frequency binary stream.
3. **Decoding is the frontend's job.** Rust never converts to `String`, so multi-byte characters split across two reads are not corrupted. xterm and the block renderer both reassemble.
4. From Phase 2, Rust also strips OSC 133 / OSC 7 markers *before* forwarding and emits structured `command_start` / `command_end` events alongside the byte stream.

## Command boundaries

Everything block-structured depends on knowing where one command's output ends. Solved with **OSC 133 shell integration**: a small init script per shell emits `A` (prompt start), `B` (command start), `C` (output start), `D;<exit>` (done). Industry standard — VS Code, WezTerm, and Windows Terminal all use it.

Injected at spawn time via shell init flags rather than editing the user's dotfiles where possible: PowerShell `-NoExit -Command`, bash `--rcfile`, zsh `ZDOTDIR`. Fish needs a documented manual line.

OSC 7 (cwd reporting) comes along for free and drives the file-nav panel and the prompt path.

## Layout

The input field is pinned to the bottom via a flex column — scroll region `flex: 1` above, fixed-height input row below. **Not `position: fixed`**: it must resize cleanly with the window and must not fight the settings overlay's stacking context.

## Files

```
src-tauri/src/
  lib.rs          Tauri builder, command registration
  pty.rs          PTY session: spawn / write / resize
src/routes/
  +layout.ts      ssr = false (SPA mode)
  +page.svelte    terminal view
ANIMATION.md      binding animation ruleset
CLAUDE.md         project entry point for agents
```
