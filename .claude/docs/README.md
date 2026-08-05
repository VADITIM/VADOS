# VAD/OS — Working Docs

Planning and progress tracking. Read the relevant phase doc **before** starting work on that phase, and update it **after** — these files are the memory between sessions.

## Index

| Doc | Purpose |
|---|---|
| [architecture.md](architecture.md) | Stack, the dual-renderer design, how the pieces fit |
| [decisions.md](decisions.md) | Settled decisions and why — check before re-litigating anything |
| [tasks.md](tasks.md) | Live backlog: bugs, current issues, future feature ideas |
| [phase-0-1-foundation.md](phase-0-1-foundation.md) | Toolchain, scaffold, working PTY terminal |
| [phase-2-command-boundaries.md](phase-2-command-boundaries.md) | OSC 133 shell integration, output parsing |
| [phase-3-block-renderer.md](phase-3-block-renderer.md) | Markdown blocks, live container, alt-screen fallback |
| [phase-4-styling.md](phase-4-styling.md) | SCSS token layer, accent system, fonts |
| [phase-5-animation.md](phase-5-animation.md) | GSAP layer — implements `../../ANIMATION.md` |
| [phase-6-config.md](phase-6-config.md) | TOML config, two-way sync, settings GUI |
| [phase-7-navigation.md](phase-7-navigation.md) | `open <file>`, cwd panel, keyboard nav |

## Conventions

- **`ANIMATION.md` lives at the repo root, not here.** It is a binding ruleset for writing code, not a planning doc. These files plan; that file constrains.
- Each phase doc carries **Original plan** (what was agreed, do not rewrite it) and **Status / Learned** (what actually happened). Keeping them separate is the point — drift between the two is the useful signal.
- When a phase finishes, move anything unresolved into [tasks.md](tasks.md) rather than leaving it buried in a phase doc.
