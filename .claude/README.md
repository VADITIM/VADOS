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
| [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) | **Binding** — what a semantic layer owes a reader who cannot use it the way it was drawn |
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

### Hardening — a terminal that is boring in the right places

Foundation produced a terminal that renders blocks. This group is what makes those blocks safe to build on: the bytes are kept, the colour survives, the compatibility is checked rather than assumed, and the performance budget is measured rather than asserted.

The order is the finding that produced this group. A block currently keeps no bytes and no colour — `snapshot()` reads decoded text out of xterm's screen buffer — so two of the rules at the bottom of this file are false in code today, and every Expansion phase would have been built over them. **Nothing in Expansion starts before H1.**

| Phase | Scope |
|---|---|
| [phase-h1-raw-fidelity.md](foundation/phase-h1-raw-fidelity.md) | Raw byte retention, ANSI colour in blocks, the raw toggle, the block's three representations |
| [phase-h2-compatibility.md](foundation/phase-h2-compatibility.md) | The compat fixture suite and checklist; inline TUIs, alt-screen, ssh, Unicode, resize, paste, hyperlinks |
| [phase-h3-measured-performance.md](foundation/phase-h3-measured-performance.md) | BENCHMARKS.md, baseline numbers, PTY coalescing and backpressure, the scrollback cap |

### Expansion — the terminal as a document

What makes it worth switching to. Everything here depends on H1 and then on Phase 8, in that order.

| Phase | Scope |
|---|---|
| [phase-8-document-engine.md](foundation/phase-8-document-engine.md) | Renderer choice, the five-level classifier, node identity, streaming, interactive code blocks, folding |
| [phase-9-rich-media.md](foundation/phase-9-rich-media.md) | Mermaid, images, video — all as AST leaf nodes |
| [phase-10-document-view.md](foundation/phase-10-document-view.md) | Split view, export to Markdown / HTML / PDF, structured block context for other tools |
| [phase-11-theme-engine.md](foundation/phase-11-theme-engine.md) | Themes as data over the Phase 4 token contract |
| [phase-12-shell-hosting.md](foundation/phase-12-shell-hosting.md) | Shell picker, WSL, Git Bash, cmd, removing the PowerShell assumptions |
| [phase-13-command-as-event.md](foundation/phase-13-command-as-event.md) | Duration, timestamp, exit code in the result, re-run, copy modes |
| [phase-14-finding-things.md](foundation/phase-14-finding-things.md) | One command registry feeding `/help`, the palette and the keymap; session search |

## Conventions

- **`docs/ANIMATION.md` and `docs/PERFORMANCE.md` are binding rulesets, not planning docs.** These files plan; those files constrain. If a phase doc and a binding doc disagree, the binding doc wins.
- Each phase doc carries **Original plan** (what was agreed, do not rewrite it) and **Status / Learned** (what actually happened). Keeping them separate is the point — drift between the two is the useful signal.
- When a phase finishes, move anything unresolved into [tasks.md](tasks.md) rather than leaving it buried in a phase doc.
- **Two rules survive every phase**, and a design that breaks either is wrong regardless of how good it looks: the parser emits nodes and never a markup string, and every block keeps the raw bytes it rendered from. The first holds in code. **The second does not yet** — a block keeps decoded text, and [phase-h1-raw-fidelity.md](foundation/phase-h1-raw-fidelity.md) is what makes it true. A rule stated and not implemented is worth recording as exactly that, because the alternative is a later session reading it as a guarantee.
