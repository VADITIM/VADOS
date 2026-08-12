# Tasks

Live backlog. Phase docs hold the plan; this holds everything that does not fit a phase.

One entry = one line: what is wrong, where, what the fix is. Reasoning goes in [decisions.md](decisions.md), causes that generalise go in [docs/QUIRKS.md](docs/QUIRKS.md), fixed items go in the git log.

---

## Blockers

- [ ] **A block keeps no raw bytes and no colour.** `snapshot()` reads decoded text out of xterm's screen buffer, so *"every block keeps the raw bytes it rendered from"* and *"plain and ANSI output renders exactly as it is"* are both false in block mode today. This is why the raw toggle does not exist and why `git status` renders monochrome. Owned by [foundation/phase-h1-raw-fidelity.md](foundation/phase-h1-raw-fidelity.md), and everything in Expansion is behind it.
- [ ] **Inline TUIs (`claude`) render as a bare prompt.** Raw mode triggers on alt-screen enter, but Ink repaints inline and never sets `?1049h`, so the block renderer reads a buffer being overwritten. Needs a redesigned trigger — DEC private modes (`?2004h`, `?1000h`, sustained `?25l`), a repaint-rate heuristic, or an opt-out list — each with a false-positive cost on ordinary output. Moved to [foundation/phase-h2-compatibility.md](foundation/phase-h2-compatibility.md); it was filed as "in front of Phase 7" and it is in front of everything. `syncMode`, `src/routes/+page.svelte`.
- [ ] **Alt-screen half of the input/raw-view bug.** The `atPrompt`-not-`$state` half is fixed; unknown whether ConPTY forwards `\x1b[?1049h` at all here. F3 overlay logs OSC 133 payloads, buffer changes and any `CSI ?1049h/l`; F2 captures it. Owned by [foundation/phase-h2-compatibility.md](foundation/phase-h2-compatibility.md). `src/routes/+page.svelte`.
- [ ] **`PS_PROMPT` is PowerShell-only.** The input mirror strips a literal prompt template out of the cursor row. General fix is a marker at OSC 133 `B`, not a remembered column (tried, reverted). First task of [foundation/phase-12-shell-hosting.md](foundation/phase-12-shell-hosting.md); until it lands, bash or WSL inherits a broken input bar.
- [ ] **True squircle corners.** No native CSS outside Chromium's unshipped `corner-shape`; placeholder is `border-radius`. Real fix is a `clip-path` superellipse per block — note the hover ring's mask assumes `border-radius: inherit`, so both want solving at once.
- [ ] **Markdown renderer choice.** Owned by [foundation/phase-8-document-engine.md](foundation/phase-8-document-engine.md).
- [ ] **Unicode width is unchecked.** A rendered block's columns line up only while every glyph is one cell wide, which CJK, emoji, ZWJ sequences and combining marks all break. Invisible until someone runs `ls` in a directory of Japanese filenames. The *colour* half of this is fixed — `rowRuns` counts characters rather than cells, so a run no longer drifts off its text on such a row — and `compat/unicode/width.txt` is the check nobody has run. [foundation/phase-h2-compatibility.md](foundation/phase-h2-compatibility.md).

## Awaiting confirmation on a rebuild

- [ ] **Typing `(`, `{`, `[` overwrote the prompt and blanked the input bar.** PSReadLine derives prompt geometry from the prompt string, and escape sequences in it are zero-width on screen but not in the string. Fix: everything not visible prompt text (`133;D`, `133;A`, OSC 7) is written with `[Console]::Write`; only `133;B` stays in the returned string. Next knob if it persists: `Set-PSReadLineOption -PromptText`. `src-tauri/resources/shell/integration.ps1`.
- [ ] **A stray `\` appeared before typed characters.** OSC sequences terminated with ST (`ESC \`); anything dropping the ESC leaves a literal backslash the line editor cannot delete. Switched to BEL. Same file.

---

## Open questions

- [ ] **"Move down" no longer changes the reveal's rate**, only where the view lands — `revealStagger` went with the typewriter. Unwatched against a fast producer. Lever is the flood threshold, not a second pacing curve. (Phase 5)
- [ ] **The reveal counts rows by height ÷ line box.** Off by per-item margins; meaningless for an embed. Cost of being wrong is cadence, never missing content. Revisit when embeds land. `ponytail:` at `rowsIn`. (Phase 5 / 9)
- [ ] **Pinned-head detection is linear in mounted blocks.** Fine today, wrong after a day of scrollback. Fixed by virtualization handing `syncStuck` only mounted blocks. `ponytail:` at the call site. (Phase 7)
- [ ] **The static reveal's total length is unwatched on real output.** Five tiers is 0.8s before the last bar starts, only ever on final text. Check against `git --help` and a long `npm` line. Knobs: `LABEL_STEP`, then overlapping tiers. (Phase 5)
- [ ] **The character wave splits real DOM.** Guarded three ways (final elements only, original text nodes restored, teardown on every exit path). Residual risk: a static-looking element that updates mid-wave. Look if output ever appears one animation behind. (Phase 5)
- [ ] **↑↓ belong to the match strip whenever something is typed.** Empty prompt still gives them to the shell, so plain recall works; prefix-search history does not. Fix if it bites: Alt+↑↓ for the strip. `menuOwns`. (Phase 7 / 12)
- [ ] **`openCompletions` is nearly dead.** Only reached when nothing matched, but it is the sole path that lists a directory for an empty mid-line token. Fold in or delete after watching it. (Phase 7)
- [ ] **Tab belongs to VAD/OS, not the shell**, so PSReadLine's completer never sees it. Deliberate — that completion happens in a line editor the block renderer cannot show. Real loss for `git chec<Tab>` and parameter names. Hand it back when the bar can render what the shell predicts. (Phase 7 / 12)
- [ ] **The mirrored selection reads any cell background as "selected".** A shell tinting token backgrounds for syntax would read as permanently selected; no tier-1 shell does. `ponytail:` at the scan. (Phase 12)
- [ ] **Startup is not measured, only improved.** Needs a cold-start number from PERFORMANCE.md's protocol before further tuning; remaining candidates (profile load, `font-display: block`, xterm's first fit) are guesses. (Phase 7)
- [ ] **A dropped path is quoted from the path's shape, not the shell's identity.** Wrong for git-bash handed a `C:\` path. `ponytail:` at `quotePath`; real fix is the phase-12 shell registry. (Phase 12)
- [ ] **Tab offers a runnable file's path; dropping it offers ways to run it.** `runOptions` has the better answer. Unifying changes what Enter means when completing an argument — probably wants run options as extra rows below the path. `src/lib/input.js`. (Phase 7 / 12)
- [ ] **The resize observer watches `.scroll` and is not cheap** — re-snapshot, re-show, `settleReveals`, `pty_resize` — and now fires when the input bar grows a row. Unmeasured. Fix if it shows up: bail when only height moved. (Phase 7)
- [ ] **Block selection chords die when xterm loses focus.** Ctrl+Up/Down, Ctrl+Shift+C/M, F2, F3 and the strip's keys all sit in `attachCustomKeyEventHandler`. Theoretical until a panel has a real text field. Raw mode exempt by design. (Phase 7)
- [ ] **Ctrl+Shift+C may be eaten by WebView2's element picker.** Handler calls `preventDefault` and `stopPropagation`, which sufficed for F3; unverified here. Fallbacks: another chord, or no devtools in release. (Phase 7)
- [ ] **The cwd panel has no keyboard path.** Ctrl+B toggles it; expanding, walking and picking are pointer-only. Left out rather than half-built — a selection there must answer to the one-selection rule. Shape: a third focus region, with a key that leaves again. (Phase 7)
- [ ] **`tauri-plugin-drag` is a third-party dep on a user-visible path.** Only way to start a native drag out of a Tauri window. Single-vendor, pulls six `windows-*` crates plus `core-graphics`, fails visibly rather than silently. Fallback is the click. (Phase 7)
- [ ] **Panel drag-out untested on Linux; the GTK backend is X11** (`gdkx11`), so native Wayland is the likely failure. Verify on Arch and record the session type. Clicking a row still works if it fails. (Phase 7)
- [ ] **The cwd panel's width is fixed** at `clamp(180px, 18dvw, 300px)`. A grab handle would write `--panel-w` only — never pixel widths onto `.scroll`. (Phase 7)
- [ ] **Three low-severity `npm audit` findings**, all unreachable (`cookie <0.7.0` via `@sveltejs/kit`; no server, no cookies). **Do not run `npm audit fix --force`** — it installs `@sveltejs/kit@0.0.30` and breaks the app.
- [ ] **Ctrl+B costs readline's backward-char** in block mode; raw mode exempt, so tmux's prefix survives.
- [ ] **Ctrl+A costs readline's beginning-of-line**, and PSReadLine's `SelectAll` with it — in block mode it selects the input line here instead, and is never sent to the shell. Home still does beginning-of-line. Raw mode exempt. The selection it makes is ours, not the shell's, so the edit that follows is replayed as backspaces and deletes (`eraseSelection`); a shell whose line editor moves the caret somewhere unexpected would make that erase wrong, which is the thing to watch. (Phase 7 / 12)
- [ ] **The keyboard is taken back from anything that is not a text field.** A `focusout` watchdog returns focus to the input, and a key pressed while focus was already elsewhere is written through by hand (`keyBytes`) so it is not lost — printable characters, Ctrl+letter, Enter, Backspace, and in raw mode Tab and Esc as well. Consequences to watch: the cwd panel's buttons cannot be reached by keyboard at all now (pointer-only anyway, see the gap above); the write-through bypasses xterm's key encoding, so an arrow or function key pressed on the one keystroke where focus had drifted is still dropped rather than encoded (the `focus()` beside it fixes every key after); and a layout that produces a character xterm would encode differently is where the plain-character assumption breaks. (Phase 7)
- [ ] **`data-repaint` is a two-row threshold, not a fact.** A block losing more than two rows is taken as a program redrawing its screen and never character-splits again; one row is a progress spinner erasing itself. A program that repaints a screenful two rows at a time would slip through and tear mid-wave. `anchorNewBlock`, `src/routes/+page.svelte`. (Phase 7)
- [ ] **Claude Sans Modern is not on this machine** and is not sourced — searched every font path. `--font-sans` is a system stack, so Windows and Arch render the sans modes differently, contradicting the README. One line in `.app`'s token block when the file lands. (Phase 4)
- [ ] **How far does the hand-rolled parser go?** Eight shape rules today (see `src/lib/parse.js`, self-check `parse.check.mjs`). Open: keep extending by hand (tables, emphasis, wider tone) or swap to a real renderer — which reopens injection and streaming-reparse cost. (Phase 3)
- [ ] **Error output as a fenced code block.** Needs the renderer above plus a way to tell stderr from stdout; a PTY merges both, so it comes from OSC 133 sub-markers or pattern-matching the shell's error format. (Phase 3)
- [ ] **Incremental vs on-complete markdown rendering.** PERFORMANCE.md permits incremental under three conditions; stays open until the boundary logic is proven against an unterminated fence. (Phase 8)
- [ ] **How does a program declare "this output is markdown"?** OSC private-use marker, an exported env var, or both. Pick before any tool emits it — it becomes a compatibility surface immediately. (Phase 8)
- [ ] **How much does the shape parser keep doing once a real markdown parser exists?** Two paths to maintain, or lose either declared-markdown fidelity or the plain-output value proposition. (Phase 8)
- [ ] **Do rich embeds count against the scrollback cap by size or by count?** Counting blocks is easy and wrong. (Phase 9)
- [ ] ~~**Fish has no clean init-flag injection path for OSC 133.**~~ **Answered** — `--init-command`, recorded in [shells.md](shells.md) and [foundation/phase-2-command-boundaries.md](foundation/phase-2-command-boundaries.md). The *code* item stands: `pty.rs` still gives fish no integration. The question does not.
- [ ] **"Set as default terminal" is not implemented, on purpose.** Windows' `DelegationConsole` keys want a registered COM delegation handler; writing an identifier without one breaks the user's console. Linux's `x-terminal-emulator` needs root and is Debian-only. Reopening means shipping the handler. The schema slot is absent too. (Phase 6 / 12)

---

## Known issues

- **A pager's screen renders as command output.** `git diff` pipes through `less` with `-X` (no alt screen), so the block gets a screenshot of a pager — truncation markers and all. Same root as the `claude` blocker, and owned with it by [foundation/phase-h2-compatibility.md](foundation/phase-h2-compatibility.md); no parser fix helps. Workaround: `git --no-pager diff`.
- **A wave over `WAVE_MAX_WORDS` is simply absent**, not degraded — the element is unclipped and nothing plays. Reached by a single very long element, not by a list (rows split per row now). Fix if it shows: fall back to the whole-element clip sweep the over-`LABEL_MAX` path already uses. `splitChars` / `revealStatic`. (Phase 5)
- **npm 11 blocks esbuild's postinstall.** A fresh clone needs `npm approve-scripts esbuild`. Worth a README note.
- **Bash tool PATH misses `~/.cargo/bin`** until a terminal restart. `export PATH="$PATH:/c/Users/vadim/.cargo/bin"`.
- **Harmless German linker warning on every Windows build** about `.dll.lib` / `.dll.exp`. Not an error.

---

## Deferred by design

Rejected or postponed — see [decisions.md](decisions.md) before reopening.

- Multi-tab / split panes — a second window covers it.
- Plugin system — settings are a fixed curated GUI.
- Real Docker containerisation — "container" means the UI output block.
- SSH **client** — a connection manager, stored hosts, a session picker. *Running* `ssh` in the terminal is not this: it is a compatibility requirement and one of the highest-value rows in [foundation/phase-h2-compatibility.md](foundation/phase-h2-compatibility.md). The two were one line here and read as though both were deferred.
- Built-in AI client — VAD/OS renders LLM output, it does not host a model.
- Terminal graphics protocols (Sixel / Kitty / iTerm2) — until a tool in use needs one. [foundation/phase-9-rich-media.md](foundation/phase-9-rich-media.md).
- Config schema migration — on the first breaking change, not before.
- Full TUI rendering for alt-screen apps — they get raw xterm.
- Per-orientation startup sizes. `scaled()` uses one factor for both axes after the per-axis version inverted the aspect on a rotated monitor. Conservative on portrait (596x349 on a 1080x1920 screen). Revisit with a portrait reference size or remembered geometry.
- ~~Shells beyond bash / zsh / fish / PowerShell.~~ **Reopened** — tiered in [shells.md](shells.md), built in [foundation/phase-12-shell-hosting.md](foundation/phase-12-shell-hosting.md).

---

## Future ideas

Not committed. Parked so they stop occupying working memory.

- **Setting previews — a live demo per row in the settings panel.** A miniature of the real thing running, not a screenshot: the font row sets the same line in each mode, the scroll row emulates a block anchoring each way, the reveal row plays both. No demo for colour — the swatch is one. Constraints: ambient tier under ANIMATION.md, must stop on pointer-leave with a kill path (a panel left open cannot animate forever), and the scroll/reveal demos want the real renderer at small scale or they drift. Deferred until the app stops changing. (Phase 6)
- **Ghost text — remaining sources.** Past sessions' history (needs our own file, or the shell registry to say where that shell keeps its), executables on `PATH` (Rust scan, cached per session), per-command subcommand sets rather than one verb list. `ponytail:` at `history`. PSReadLine prediction is closed twice over: needs 2.1+ (5.1 ships 2.0) and is one shell's feature. (Phase 7 / 12)
- ~~**Scrollback cap or virtualisation.**~~ **Committed** — [foundation/phase-h3-measured-performance.md](foundation/phase-h3-measured-performance.md). Measure `content-visibility` alone at 100k lines before writing a windowing layer.
- ~~**Re-run a block.**~~ **Committed** — [foundation/phase-13-command-as-event.md](foundation/phase-13-command-as-event.md). It types the command; it never sends it.
- ~~**Search across scrollback.**~~ **Committed** — [foundation/phase-14-finding-things.md](foundation/phase-14-finding-things.md). A hit focuses the block, not the line.
- ~~**Exit code in the block heading.**~~ **Committed** — [foundation/phase-13-command-as-event.md](foundation/phase-13-command-as-event.md), with a duration beside it. Still unavailable under `cmd.exe` ([shells.md](shells.md)), where the result line says nothing rather than guessing zero.
- **Arch packaging.** AUR or a plain binary; the Linux build has not been attempted.
- **First-run experience.** The ASCII banner plus whatever a new user needs once.
- **Toast beyond copy.** The primitive is single-slot and un-queued on purpose. Candidates for a second caller: PTY spawn errors, shell-not-found, resize failures. Do not build a queue before one exists.

---

## Tooling

- [ ] **F3 debug overlay** — live state plus a 24-line event ring, above both panes. Free while off. Delete it when the alt-screen blocker closes.
- [ ] **F2 screenshot** — writes `demo/vados-<unix>.png` and rewrites the README gallery between the `demo:start` / `demo:end` markers. **Development only**: the path comes from `CARGO_MANIFEST_DIR`. Fails with a toast.
- [ ] **Screenshots accumulate.** Nothing prunes them and the gallery lists all. Fine at five, wrong at fifty.
