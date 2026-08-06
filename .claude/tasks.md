# Tasks

Live backlog. Phase docs hold the plan; this holds everything that does not fit a phase.

---

## Blockers

- [ ] **Docked input bar and raw xterm view (`vim`/`htop`/`claude`) still broken after two attempted fixes.** Tried: (1) `PS_PROMPT` regex made the trailing space after `>` optional, since `translateToString(true)` trims trailing whitespace and an untyped prompt row ends at `>`; (2) stripped the leading `/` OSC 7 puts before a Windows drive letter (`file:///C:/Users/vadim` → `/C:/Users/vadim` → `C:/Users/vadim`); (3) alt-screen detection (`syncMode()`) now also runs from the per-chunk write callback, not only `onBufferChange`, in case the swap event doesn't fire reliably; (4) the block that launched an alt-screen app stops snapshotting once `mode` flips, since its rows live in the buffer that gets wiped on exit. User confirmed still not working after all four — root cause not found. Next to check: whether ConPTY forwards `\x1b[?1049h` at all on this Windows PowerShell setup (ConPTY is known to intercept/rewrite some alt-screen sequences), and whether `PS_PROMPT` is matching the *actual* live prompt string at all (dump `rowText()` at the point it's read, don't assume `integration.ps1`'s template is what's on screen). `src/routes/+page.svelte`.

- [ ] **Border hover animation source.** Needs to be ported from the portfolio project. Blocks the block-chrome work in Phase 3 and the tween spec in `ANIMATION.md` (`## Open` section). Paste the implementation or point at the repo/file. **Using a flat placeholder radius in the meantime** — swap for real squircle + hover tween once source lands.
- [ ] **True squircle corners.** Block chrome must use squircle (superellipse) corners, not circular `border-radius`. CSS has no native squircle outside experimental `corner-shape` (Chromium-only, unshipped broadly). Placeholder uses a plain `border-radius`. Real fix: `clip-path` with a precomputed superellipse SVG path, sized per block. Needs the border-hover source above before it's worth building properly.
- [ ] **Markdown renderer choice.** Phase 3 placeholder renders output as plain preformatted text, no markdown parsing yet. Needs a renderer that's safe against arbitrary command output being read as markup and fast on streaming content.

## Fixed

- [x] **`PS C:\Users\vadim>` leaked into the command echo and the live input mirror.** Input mirroring cut the typed text out of the cursor row at a remembered column (`promptCol`, captured once from `buf.cursorX` when `133;B` fired). That column goes stale two ways: a window resize between prompt-draw and typing reflows every column after it, and a PTY read chunk boundary landing between the prompt text and the `B` marker means the column was captured before the prompt had actually finished rendering at its current width. Replaced with a direct regex strip of the known literal template (`PS <path>> `, from `integration.ps1`) applied fresh to the row every time — no remembered state, nothing to go stale. Also swapped the `> cwd  command` double-space separator for `> cwd | command` throughout (block heads, docked input bar, live preview).
- [x] **Output always chased the tail on every chunk, scrolling past the command that produced it for anything longer than a screen.** Replaced the per-chunk `scrollToEnd()` with `anchorNewBlock`, a Svelte action that fires once when a block is created and scrolls its head to the top of the viewport (GSAP `ScrollToPlugin`, element target). A command's output now reads top-down from where it started instead of endlessly following the newest line; the reader scrolls manually for anything that overflows.
- [x] **Long output (e.g. `git diff`) still dragged the view to the bottom** even after the fix above. The browser's own scroll-anchoring (a built-in heuristic that adjusts `scrollTop` to "keep the view stable" as a scroll container grows) was fighting the deliberate top-anchor as the block's output streamed in below the fold. Fixed with `overflow-anchor: none` on `.scroll` — the standard fix for this class of bug in any growing scroll feed (chat apps hit the same thing).

- [x] **Two empty containers appeared between the banner and the first real prompt.** PowerShell writes startup noise (loading the injected profile, its own interactive-loop setup) before the first `133;A`/`B` prompt cycle completes — that output has no cwd yet, so it fell through the "output arrived with no block open" fallback and opened headerless, contentless blocks. Fixed with a `booted` flag, set true the first time `133;B` fires; output arriving before that is dropped instead of block-ified. Also reverted the whole-window scale-in animation added earlier this session — deferred to the typewriter reveal (Phase 5, [ANIMATION.md](../../ANIMATION.md)) instead of a separate boot effect.

- [x] **Prompt text leaked into the command field; phantom empty blocks; caret drifted; banner ran through the markdown parser.** Four related bugs from the same session. (1) `integration.ps1` writes the prompt text and the `133;B` marker as one logical unit, but a PTY read chunk boundary (8 KB) has no relation to the shell's write boundary — a read could land between them, and the input mirror would read `promptCol` before `B` had actually updated it, briefly showing the raw `"PS C:\...>"` prompt as if typed. Fixed with a `promptReady` flag, set by `B`, cleared by `A`; the input mirror and Enter handling both wait on it. (2) Pressing Enter on a blank line still opened a block — skip when `input.trim()` is empty. (3) The caret was a fixed 8px block with a `-4px` negative margin overlapping the last character; switched to `width: 1ch` so it sits on the monospace grid instead of an eyeballed offset — most of the reported "wrong position on delete" was actually bug (1)'s stale mirror, not the caret itself. (4) The banner is ASCII art, not command output — gave `Block` an `md` flag; the banner (`md: false`) skips `parse()` and renders in the accent color, everything else is unaffected.

- [x] **Command output vanished — blocks showed the command line and a result, nothing between.** OSC markers were parsed in Rust and forwarded on a second Tauri channel. Two channels have no ordering guarantee against each other, and for any command that finishes fast the whole thing — output, `133;D`, `133;A`, next prompt — arrives in one 8 KB read. The events were dispatched ahead of the bytes, so `atPrompt` was already true when the output finally landed and it was routed to the input bar and discarded. Fix: markers are parsed by xterm via `parser.registerOscHandler(133/7)`, where the handler runs mid-parse with the cursor exactly where the marker sat. `osc.rs` deleted; Rust is now a dumb pipe. Alt-screen detection moved to `buffer.onBufferChange` for the same reason. The final block snapshot also had to move into the `D` handler — by the time the write callback runs, the cursor has moved onto the next prompt row.

- [x] **Every block reported the same non-zero exit code** (`exit 128` forever, after one failing `git`). `integration.ps1` read `$LASTEXITCODE`, which PowerShell only sets for *native executables* and never clears — a cmdlet error leaves the previous native command's code in place. Fixed by reading `$?` as the first statement of `prompt` (any earlier statement clobbers it), falling back to `$LASTEXITCODE` for native failures and `1` otherwise, then resetting `$LASTEXITCODE` to `0`.

- [x] **Block view showed raw ANSI, duplicated the prompt on every keystroke, and filled with garbage on resize.** The block renderer was accumulating the decoded byte stream into a `<pre>`. That stream contains every escape sequence PSReadLine emits — it redraws the entire input line on each keypress, so one typed word produced dozens of literal `ESC[93m…ESC[?25h` copies of the prompt, and a resize replayed the whole reflow. Fix: block text is now read back out of xterm's screen buffer (`translateToString`) after each write, with an `IMarker` tracking the block's first row. xterm has already applied the escapes, so redraws collapse and reflow is handled for free. Also: blocks now open on first output rather than on OSC `133;B`, since the prompt string is emitted before `B` and events arrive on a different channel than the bytes they refer to (marker would land against a stale screen).

- [x] **DSR/cursor-query garbage leaking into block view, first prompt never appeared.** Block mode was bypassing xterm entirely and dumping raw bytes into a `<pre>`, so PowerShell/PSReadLine's `ESC[6n` cursor-position query never got answered — it stalled and the literal escape leaked through as visible text. Fix: xterm now processes every byte regardless of mode (its VT emulation answers these queries automatically via `term.onData` → `pty_write`, same path as real keystrokes); block mode additionally decodes the same stream for display. Also fixed the hidden pane collapsing to 0×0 (`display:none` → absolutely-positioned + opacity toggle) which would have thrown off PTY sizing.
- [x] **PowerShell OSC markers leaked as literal text** (`e]133;D;0e]133;A...`). Windows PowerShell 5.1 does not support the `` `e `` backtick-escape — that's PS7+ only. Fixed by building ESC explicitly via `[char]27` in `integration.ps1`. Verified: prompt renders clean.
- [x] Phase 1 manual verification — `git status`, prompt render all confirmed working in-window.

---

## Open questions

- [ ] **Claude Sans Modern** — where is it sourced from, and does it ship bundled with the app? (Phase 4)
- [ ] **Accent palette values** — blue, yellow, and orange still need picking by eye. Each should be "vibrant in its own style", not a hue rotation of the indigo. (Phase 4)
- [ ] **Markdown renderer — how far does the hand-rolled parser go?** `src/lib/parse.js` now handles six rules: level-2 heading (colon-terminated line with a separate body), list (2+ line body under a level-2 heading), fenced code (2+ consecutive code-shaped lines — shape-based, not language detection: indentation, shell-prompt markers, diff markers, or symbol density), inline code (same shape test per-token: flags, paths, `fn()`, `key=value`), single-line labels (colon with text on the *same* line, e.g. `Usage: run with --foo`), and tone (a warning/error word tints red, success/done tints green). A single-line label only becomes a level-3 heading if it carries a tone — otherwise it's bold prose, specifically so inline code (`--foo`) keeps working on it; a heading's text is never inline-tokenized. Emits structured nodes rendered as real DOM, sidestepping the injection question — no markup is ever produced or re-parsed. Open: whether to keep extending this by hand (tables, emphasis, tone beyond headings/labels) or swap to a real renderer once the rule count grows. A real renderer reopens the injection surface and the streaming-reparse cost. Self-check: `node src/lib/parse.check.mjs`. (Phase 3)
- [ ] **Error output as a fenced code block.** Stderr / PowerShell `ErrorRecord` text (`In Zeile:1 Zeichen:1`, `+ CategoryInfo`, `+ FullyQualifiedErrorId`) should render inside a ``` ``` ``` block rather than as prose. Needs the markdown renderer above first, plus a way to tell stderr from stdout — a PTY merges both streams, so the split has to come from either OSC 133 sub-markers or pattern-matching the shell's error format. (Phase 3)
- [ ] **Incremental vs. on-complete markdown rendering** — incremental looks better but re-parsing every chunk is expensive. (Phase 3)
- [ ] **Fish shell** — no clean init-flag injection path for OSC 133. Document a manual rc line, or drop fish from v1? (Phase 2)
- [ ] **`cwd` change semantics** — applying a new startup directory to an already-running shell. Next-launch only, or offer a restart action? (Phase 6)
- [ ] **File panel placement** — persistent sidebar or summoned? (Phase 7)

---

## Known issues

- **npm 11 blocks esbuild's postinstall.** A fresh clone needs `npm approve-scripts esbuild` or Vite will not run. Worth a note in the README setup steps.
- **Bash tool PATH misses `~/.cargo/bin`** until a terminal restart. Workaround: `export PATH="$PATH:/c/Users/vadim/.cargo/bin"`.
- **Harmless linker warning on every Windows build** — German-language `linker stdout` message about `.dll.lib` / `.dll.exp` creation. Not an error.

---

## Deferred by design

Rejected or postponed with reasons — see [decisions.md](decisions.md) before reopening.

- Multi-tab / split panes — rejected, a second window covers it.
- Plugin system — rejected, settings are a fixed curated GUI.
- Real Docker containerisation — rejected, "container" means the UI output block.
- SSH / remote sessions.
- Shells beyond bash / zsh / fish / PowerShell.
- Config schema migration and versioning — add on the first breaking schema change, not before.
- Full TUI rendering for alt-screen apps — they get the raw xterm fallback, by design.

---

## Notifications

- [x] **Toast primitive, wired to copy.** Single-slot notice (`notice` state + `notify()`) shown top-center over the terminal, GSAP fade/slide in, auto-clears after 1.6s. Right-click on a block → "Copied output"; shift+right-click → "Copied as markdown". `src/routes/+page.svelte`.
- [ ] **Extend beyond copy.** The primitive is intentionally single-slot and un-queued — fine for one user-triggered action at a time, wrong if two things need to notify close together (e.g. a future PTY-spawn failure firing during a copy). Revisit if/when a second call site shows up: candidates are PTY spawn errors, shell-not-found (fish fallback), and resize/reconnect failures. A queue or stacked-toast design is not needed until there's a second real caller — don't build it speculatively.

## Future ideas

Not committed. Parked here so they stop occupying working memory.

- **Fast script-execution picker.** A keybind opens a file picker as a visual extension of the docked input bar — a module appearing directly above it at ~80% the input bar's width, sharing a border with it (fused together, no gap/seam between the two — caelestia-style on Arch) so it reads as one expanded control, not a separate popup. Lists runnable scripts in cwd (`.sh`, `.py`, other shebang'd files, maybe `.ps1`/`.bat` on Windows). Arrow up/down moves the selection (not building the nav now, just the shape of the feature). Enter runs the selected file. On Linux, if the file lacks the executable bit, `chmod +x` it automatically before running — this is the actually-useful part, the everyday `chmod +x ./script.sh && ./script.sh` two-step collapses to one keypress. Windows has no exec-bit equivalent, so that half is Linux/macOS-only; on Windows the picker still lists and runs `.ps1`/`.bat`/`.exe` directly. Needs: a keybind (see Phase 7 nav), a directory-listing Tauri command filtered to executable-shaped files, the fused-shape input-bar-extension chrome (new, nothing like it exists yet), and the auto-chmod step gated to non-Windows.

- **Ghost-text autocompletion in the input bar.** Typing `gi` shows a dimmed `git` completing inline; `git st` shows `git status`. Accept with →/Tab, ignore by continuing to type. Sources, roughly in order of value: this session's and past sessions' command history, then executables on `PATH`, then per-command subcommands. Note that PSReadLine already does history prediction server-side (`Set-PSReadLineOption -PredictionSource HistoryAndPlugin`) and its ghost text would arrive in the stream for free — worth checking whether that covers it before building a client-side completer, since the input bar mirrors xterm's cursor row and would need to distinguish typed text from predicted text.

- **Scrollback cap or virtualisation.** An hours-long session accumulates unbounded DOM. Likely needed before the app is genuinely usable all day; currently unmeasured.
- **Command block collapse / fold.** Long output collapses to its heading and result. Pairs naturally with the Phase 7 keyboard navigation.
- **Copy block output.** One action to copy a command's output without its chrome.
- **Re-run a block.** Click a past command heading to run it again.
- **Search across scrollback.** Structured blocks make this much better than a raw terminal's find.
- **Exit code in the block heading**, not only the result line — helps when scanning a long history.
- **Arch packaging.** AUR or a plain binary release; the Linux build has not been attempted yet at all.
- **First-run experience.** The ASCII banner from the concept screenshots, plus whatever a new user needs to see once.
