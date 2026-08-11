# VAD/OS

Cross-platform terminal (Windows + Arch) that treats a session as a structured interaction rather than a stream of text: commands become blocks, output keeps the structure it already had, and anything the terminal does not understand is passed through untouched. Tauri v2 + SvelteKit (SPA) + portable-pty + xterm.js (raw fallback only) + GSAP.

Markdown is one of the representations that output can take. It is not what the product is, and building as though it were produces a terminal that can only render output someone wrote in markdown — which is almost none of it.

## Read first

**Start every session at [.claude/README.md](.claude/README.md).** It indexes the working docs: architecture, settled decisions, the per-phase plans, and the live backlog. Read the relevant phase doc **before** working on that phase and update it **after** — those files are the memory between sessions.

- [.claude/tasks.md](.claude/tasks.md) — bugs, blockers, open questions, future ideas. Check before starting anything.
- [.claude/decisions.md](.claude/decisions.md) — settled calls and why. Check before re-litigating.
- [.claude/tests.md](.claude/tests.md) — what still has to be checked **on screen**. Any turn that changes behaviour appends a dated section: one unchecked box per check, each naming the command to run and what should happen. Cover only what that turn changed. The user marks them `[x]` or `[!]`; a section is deleted once it is all `[x]`. A Stop hook enforces this — a turn that touches `src/` or `src-tauri/` without updating this file is blocked from ending. Anything still unchecked is unverified, and calling it done is a lie.
- [.claude/docs/QUIRKS.md](.claude/docs/QUIRKS.md) — bugs whose cause generalises, each with the rule that came out of it. **Check it when a symptom is confusing** — output in the wrong place, an animation misfiring, something slow for no visible reason. Most of these came back wearing a different hat at least once.

**Before writing or changing any animation code, read [.claude/docs/ANIMATION.md](.claude/docs/ANIMATION.md).** It is binding, not advisory — it covers the reveal (label bars and the character wave), stagger timing, what live output may not do, flood control, and cleanup requirements.

**Before touching the output path (PTY read → IPC → parse → DOM), read [.claude/docs/PERFORMANCE.md](.claude/docs/PERFORMANCE.md).** Also binding — latency/memory/throughput budgets, IPC coalescing, scrollback virtualization, and the measurement protocol. The bar: never noticeably heavier than a standard terminal. Its budgets are targets; [BENCHMARKS.md](BENCHMARKS.md) holds what has actually been measured, and no optimisation lands without a before and after number in it.

**Before changing anything that communicates state, read [.claude/docs/ACCESSIBILITY.md](.claude/docs/ACCESSIBILITY.md).** Binding, and short. The rule it is made of: a semantic layer may add a channel, never replace one — so never colour alone, and nothing exists only as a difference in when it animated.

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

**Only changes someone using the terminal would notice go in it.** A file moved, a component extracted, a type made reactive, a doc corrected — none of those are changes to the product, and a changelog they are in stops being readable as one. Refactors are in the git log already. Released sections are history and are not rewritten.

## Layout

- `src-tauri/src/pty.rs` — PTY session, streams raw bytes to the frontend over a Tauri channel.
- `src-tauri/src/config.rs` — `config.toml`: load, save, `~` expansion, and the directory watcher that pushes external edits to the frontend.
- `src-tauri/src/screenshot.rs` — F2 debug capture. Writes `demo/` and rewrites the README gallery. Dev-only: the path comes from `CARGO_MANIFEST_DIR`.
- `src/lib/parse.js` — output → AST. Self-check: `node src/lib/parse.check.mjs`.
- `src/lib/settings.ts` — every setting as data: the keys `config.toml` stores, the labels the panel renders, what each mode resolves to. Data only — applying a setting is DOM and stays in the page.
- `src/lib/ansi.js` — the program's own colour, mapped onto the parser's text by offset: the palette, a run's CSS, and the split. Self-check: `node src/lib/ansi.check.mjs`.
- `src/lib/anim.ts` — the animation values more than one surface uses. A shared value is a statement that two surfaces are the same gesture; anything used once stays where it is used.
- `src/lib/components/Settings.svelte` — the Esc overlay. Owns its markup, its CSS and both halves of its animation; the page owns the values and does the applying.
- `src/lib/reveal-plan.js` — which reveal a run of parsed text gets, and in what order. Self-check: `node src/lib/reveal-plan.check.mjs`.
- `src/lib/input.js` — the docked input bar's non-DOM half: suggestion-strip items (drop and Tab), the ghost completion's sources, the plain word for a command whose name is an abbreviation (`COMMAND_WORDS`), the shortened cwd, shell quoting, path joining, and the selected runs of the mirrored line. Self-check: `node src/lib/input.check.mjs`.
- `src-tauri/src/dir.rs` — directory listing for the Tab suggestions, and `open <path>`. Dumb like `pty.rs`: names and is-it-a-directory, nothing more.
- `src/routes/+page.svelte` — terminal view.

## Architecture

Two renderers over one PTY stream:

- **Block renderer** (default) — plain DOM, one `<section>` per command. This is what gets styled and animated.
- **xterm.js** (fallback) — mounted only on alt-screen enter (`\x1b[?1049h`) for `vim`, `htop`, `claude`. Raw passthrough, never intercepted, never animated.

Command boundaries come from OSC 133 shell integration, parsed by xterm's own OSC handlers in the frontend — never in Rust. A marker delivered out-of-band from the bytes around it arrives out of order, and the output gets filed under the wrong command. Rust is a dumb pipe.

## `/help` is part of the feature, not documentation of it

Every command VAD/OS answers itself and every key it takes from the shell goes into `HELP_NODES` in `src/routes/+page.svelte`, **in the same turn that adds it**. There is no other place a user can find out what this terminal does — no man page, no menu bar, no docs site — so a key that is not in `/help` does not exist as far as anyone but the author is concerned. Adding the binding and adding the line are one task; a change that ships without the line is unfinished, the same way a behaviour change without a `tests.md` entry is.

## Rules that outlive any phase

Break either of these and the design is wrong, however good it looks:

1. **The parser emits nodes, never a markup string.** Nodes render through Svelte, which escapes text, so command output can never be read as markup. One AST feeds the screen, the clipboard, and export.
2. **Every block keeps the raw bytes it rendered from** and can be toggled back to them. This is what makes rendering safe to be wrong about. **Currently false in code** — `snapshot()` keeps decoded text with no bytes and no cell attributes, which is why the raw toggle does not exist and why block mode drops ANSI colour. [.claude/foundation/phase-h1-raw-fidelity.md](.claude/foundation/phase-h1-raw-fidelity.md) makes it true, and nothing in the Expansion group starts before it. Do not read this rule as a guarantee about the code until then.

The order that decides every rendering feature: **compatibility first, beauty second.** Plain and ANSI output renders exactly as it is. Structure is entered on evidence — a program declaring it, an adapter that knows the command, or a detector clearing a high bar — never assumed. A missed structure shows plain text; a false positive changes what the program printed, and only the second is a bug.

And where VAD/OS does not understand something, it behaves like a conventional terminal rather than trying to interpret it. The fallback direction is fixed so that a new heuristic has to argue against it, instead of only being measured on how often it is right.

And VAD/OS is the **terminal**, not the shell. PowerShell is the Windows default because it ships with Windows; nothing above the PTY may depend on it.
