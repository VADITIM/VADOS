# VAD/OS — Working Docs

Planning and progress tracking. Read the relevant phase doc **before** starting work on that phase, and update it **after** — these files are the memory between sessions.

## Index

| Doc | Purpose |
|---|---|
| [architecture.md](architecture.md) | Stack, the dual-renderer design, the render decision, how the pieces fit |
| [decisions.md](decisions.md) | Settled decisions and why — check before re-litigating anything |
| [tasks.md](tasks.md) | Live backlog: bugs, current issues, future feature ideas |
| [tests.md](tests.md) | What still has to be checked on screen — a queue, marked off by the user |
| [shells.md](shells.md) | Which shells are supported, tiered by OSC 133 marker fidelity |
| [docs/ANIMATION.md](docs/ANIMATION.md) | **Binding** animation ruleset |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | **Binding** latency, memory, and throughput budgets |
| [docs/QUIRKS.md](docs/QUIRKS.md) | Bugs whose *cause* generalises — read when a symptom is confusing |

### Foundation — a terminal that works

| Phase | Scope |
|---|---|
| [phase-0-1-foundation.md](foundation/phase-0-1-foundation.md) | Toolchain, scaffold, working PTY terminal |
| [phase-2-command-boundaries.md](foundation/phase-2-command-boundaries.md) | OSC 133 shell integration, output parsing |
| [phase-3-block-renderer.md](foundation/phase-3-block-renderer.md) | Markdown blocks, live container, alt-screen fallback |
| [phase-4-styling.md](foundation/phase-4-styling.md) | SCSS token layer, accent system, fonts |
| [phase-5-animation.md](foundation/phase-5-animation.md) | GSAP layer — implements `docs/ANIMATION.md` |
| [phase-6-config.md](foundation/phase-6-config.md) | TOML config, two-way sync, settings GUI |
| [phase-7-navigation.md](foundation/phase-7-navigation.md) | `open <file>`, cwd panel, keyboard nav |

### Expansion — the terminal as a document

Everything above produces a terminal that renders blocks. Everything below is what makes it worth switching to. All five depend on Phase 8; nothing in this group starts before it.

| Phase | Scope |
|---|---|
| [phase-8-markdown-engine.md](foundation/phase-8-markdown-engine.md) | Renderer choice, the declared/detected/raw classifier, streaming, interactive code blocks, folding |
| [phase-9-rich-media.md](foundation/phase-9-rich-media.md) | Mermaid, images, video — all as AST leaf nodes |
| [phase-10-document-view.md](foundation/phase-10-document-view.md) | Raw toggle, split view, export to Markdown / HTML / PDF |
| [phase-11-theme-engine.md](foundation/phase-11-theme-engine.md) | Themes as data over the Phase 4 token contract |
| [phase-12-shell-hosting.md](foundation/phase-12-shell-hosting.md) | Shell picker, WSL, Git Bash, cmd, removing the PowerShell assumptions |

## Conventions

- **`docs/ANIMATION.md` and `docs/PERFORMANCE.md` are binding rulesets, not planning docs.** These files plan; those files constrain. If a phase doc and a binding doc disagree, the binding doc wins.
- Each phase doc carries **Original plan** (what was agreed, do not rewrite it) and **Status / Learned** (what actually happened). Keeping them separate is the point — drift between the two is the useful signal.
- When a phase finishes, move anything unresolved into [tasks.md](tasks.md) rather than leaving it buried in a phase doc.
- **Two rules survive every phase**, and a design that breaks either is wrong regardless of how good it looks: the parser emits nodes and never a markup string, and every block keeps the raw bytes it rendered from.
