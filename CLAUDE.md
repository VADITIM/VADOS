# VAD/OS

Cross-platform terminal (Windows + Arch) that renders command output as structured markdown blocks. Tauri v2 + SvelteKit (SPA) + portable-pty + xterm.js (raw fallback only) + GSAP.

## Read first

**Start every session at [.claude/docs/README.md](.claude/docs/README.md).** It indexes the working docs: architecture, settled decisions, the per-phase plans, and the live backlog. Read the relevant phase doc **before** working on that phase and update it **after** — those files are the memory between sessions.

- [.claude/docs/tasks.md](.claude/docs/tasks.md) — bugs, blockers, open questions, future ideas. Check before starting anything.
- [.claude/docs/decisions.md](.claude/docs/decisions.md) — settled calls and why. Check before re-litigating.

**Before writing or changing any animation code, read [ANIMATION.md](ANIMATION.md).** It is binding, not advisory — it covers the typewriter reveal, stagger timing, flood control, and cleanup requirements.

## Layout

- `src-tauri/src/pty.rs` — PTY session, streams raw bytes to the frontend over a Tauri channel.
- `src/routes/+page.svelte` — terminal view.

## Architecture

Two renderers over one PTY stream:

- **Block renderer** (default) — plain DOM, one `<section>` per command. This is what gets styled and animated.
- **xterm.js** (fallback) — mounted only on alt-screen enter (`\x1b[?1049h`) for `vim`, `htop`, `claude`. Raw passthrough, never intercepted, never animated.

Command boundaries come from OSC 133 shell integration, parsed by xterm's own OSC handlers in the frontend — never in Rust. A marker delivered out-of-band from the bytes around it arrives out of order, and the output gets filed under the wrong command. Rust is a dumb pipe.
