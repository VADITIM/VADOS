# VAD/OS

Cross-platform terminal (Windows + Arch) that renders command output as structured markdown blocks. Tauri v2 + SvelteKit (SPA) + portable-pty + xterm.js (raw fallback only) + GSAP.

## Read first

**Start every session at [.claude/README.md](.claude/README.md).** It indexes the working docs: architecture, settled decisions, the per-phase plans, and the live backlog. Read the relevant phase doc **before** working on that phase and update it **after** — those files are the memory between sessions.

- [.claude/tasks.md](.claude/tasks.md) — bugs, blockers, open questions, future ideas. Check before starting anything.
- [.claude/decisions.md](.claude/decisions.md) — settled calls and why. Check before re-litigating.

**Before writing or changing any animation code, read [.claude/docs/ANIMATION.md](.claude/docs/ANIMATION.md).** It is binding, not advisory — it covers the typewriter reveal, stagger timing, flood control, and cleanup requirements.

**Before touching the output path (PTY read → IPC → parse → DOM), read [.claude/docs/PERFORMANCE.md](.claude/docs/PERFORMANCE.md).** Also binding — latency/memory/throughput budgets, IPC coalescing, scrollback virtualization, and the measurement protocol. The bar: never noticeably heavier than a standard terminal.

## Use the installed plugins

The plugins installed for this repo are not optional decoration. Use them by default rather than improvising the same thing by hand, and if one is unavailable say so explicitly instead of silently substituting.

- **ponytail** — active on every coding task. Climb the ladder before writing anything: does it need to exist, is it already in this codebase, does the stdlib or the platform cover it, does an already-installed dependency cover it. Shortest working diff wins, but only after reading the real flow end to end. Mark deliberate corners with a `ponytail:` comment naming the ceiling. `/ponytail-review` before calling a change done; `/ponytail-audit` when the repo starts feeling heavy.
- **caveman** — active on every response. Terse output, full technical substance. Prose written to disk — docs, comments, commit messages — stays normal prose.
- **gsap-skills** — load before touching animation code: `gsap-core`, `gsap-timeline`, `gsap-frameworks` (Svelte lifecycle and cleanup), `gsap-plugins` (SplitText, ScrollToPlugin), `gsap-performance`. Animation here is GSAP-only and `ANIMATION.md` assumes the plugin's idioms.
- **karpathy-guidelines** — surgical changes, surfaced assumptions, verifiable success criteria. Read before any refactor.
- **code-simplifier**, **claude-md-management** — cleanup passes, and keeping this file honest.
- **ui-ux-pro-max** — vendored under [.claude/skills/](.claude/skills/) from [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill). Load before any visual or interaction change. Its `scripts/search.py` **cannot run on this machine** — there is no Python here, only the Windows Store alias stub — so query `data/*.csv` and `references/` directly with grep instead of the documented CLI. Only the `ui-ux-pro-max` skill was installed; the kit's logo, banner, brand, slide, and canvas-font skills are for marketing asset generation and have no bearing on a terminal.
- **svelte-skills** — vendored under [.claude/skills/](.claude/skills/) from [svelte-skills-kit](https://github.com/spences10/svelte-skills-kit). Load `svelte-runes` before touching reactive state, `svelte-styling` before scoped CSS or `:global`, `svelte-template-directives` for `{@attach}` / `{@render}`. The runes skill is the one that matters most here: the worst bug in this codebase so far was a plain `let` read in the template, which Svelte 5 compiles to a constant read. Five of the kit's ten skills were dropped on install — LayerChart, remote functions, load functions, routing/SSR, and the upstream author's own ecosystem guide. This is an SPA with one route, `ssr = false`, and no server, so those are not merely unused; following them would be wrong. Re-add from upstream if that ever changes.

[CHANGELOG.md](CHANGELOG.md) is one line per change — what changed, plus the cause or constraint if it is not obvious. No rationale essays, no feature tours, no selling the change back to the reader. The reasoning belongs in the phase docs and `decisions.md`.

## Layout

- `src-tauri/src/pty.rs` — PTY session, streams raw bytes to the frontend over a Tauri channel.
- `src-tauri/src/screenshot.rs` — F2 debug capture. Writes `demo/` and rewrites the README gallery. Dev-only: the path comes from `CARGO_MANIFEST_DIR`.
- `src/lib/parse.js` — output → AST. Self-check: `node src/lib/parse.check.mjs`.
- `src/lib/reveal.js` — typewriter clip geometry. Self-check: `node src/lib/reveal.check.mjs`.
- `src/lib/reveal-plan.js` — which reveal a run of parsed text gets, and in what order. Self-check: `node src/lib/reveal-plan.check.mjs`.
- `src/lib/input.js` — the docked input bar's non-DOM half: suggestion-strip items (drop and Tab), shell quoting, path joining, and the selected runs of the mirrored line. Self-check: `node src/lib/input.check.mjs`.
- `src-tauri/src/dir.rs` — directory listing for the Tab suggestions. Dumb like `pty.rs`: names and is-it-a-directory, nothing more.
- `src/routes/+page.svelte` — terminal view.

## Architecture

Two renderers over one PTY stream:

- **Block renderer** (default) — plain DOM, one `<section>` per command. This is what gets styled and animated.
- **xterm.js** (fallback) — mounted only on alt-screen enter (`\x1b[?1049h`) for `vim`, `htop`, `claude`. Raw passthrough, never intercepted, never animated.

Command boundaries come from OSC 133 shell integration, parsed by xterm's own OSC handlers in the frontend — never in Rust. A marker delivered out-of-band from the bytes around it arrives out of order, and the output gets filed under the wrong command. Rust is a dumb pipe.

## Rules that outlive any phase

Break either of these and the design is wrong, however good it looks:

1. **The parser emits nodes, never a markup string.** Nodes render through Svelte, which escapes text, so command output can never be read as markup. One AST feeds the screen, the clipboard, and export.
2. **Every block keeps the raw bytes it rendered from** and can be toggled back to them. This is what makes rendering safe to be wrong about.

The order that decides every rendering feature: **compatibility first, beauty second.** Plain and ANSI output renders exactly as it is. Markdown is entered on evidence — a program declaring it, or a detector clearing a high bar — never assumed.

And VAD/OS is the **terminal**, not the shell. PowerShell is the Windows default because it ships with Windows; nothing above the PTY may depend on it.
