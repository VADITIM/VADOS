# Quirks

A catalogue of bugs that turned out to be *classes* of bug, not one-offs. Every entry is here because the fix generalises: the same shape shows up again somewhere else, usually looking like something completely different.

**Read this when a symptom is confusing**, especially when output appears in the wrong place, animates wrong, or is slow for no visible reason. The odds are good that it is one of these wearing a new hat.

Each entry: the symptom as it was reported, what it actually was, and the rule that came out of it. The rule is the part that matters — the specific fix is in the code and the CHANGELOG.

---

## 1. Reactivity: a plain `let` read in a template is a constant

**Symptom.** The live prompt line never appeared once. Four rounds of tuning the prompt regex changed nothing.

**Cause.** `atPrompt` was a plain `let`, not `$state`. Svelte 5 compiles a non-rune `let` read in a template as a *constant* read, so the value was pinned to its initial `false` for the life of the session. The logic that assigned it was correct the whole time; nothing re-read it.

**Rule.** When a value is visibly stuck at its initial state and the code that sets it looks right, check the declaration before checking the logic. Anything a template reads is `$state`. This was the worst bug in the codebase and it cost four sessions.

**Tell.** The compiler warns. Read the warnings.

---

## 2. Ordering: two channels have no ordering guarantee against each other

**Symptom.** Command output vanished — blocks showed a command line and a result with nothing between them.

**Cause.** OSC 133 markers were parsed in Rust and forwarded on a second Tauri channel, separate from the byte stream they referred to. For any command that finishes fast, the whole exchange arrives in one read, and the events were dispatched ahead of the bytes: the "prompt is back" marker landed before the output it was supposed to follow, so the output was routed to the input bar and discarded.

**Rule.** A marker delivered out-of-band from the bytes around it arrives out of order. Anything that means "the stream is at position X" must be parsed *in* the stream — for us that is xterm's own OSC handlers, where the handler runs mid-parse with the cursor exactly where the marker sat. **Rust is a dumb pipe** ([architecture.md](../architecture.md)), and this is why.

**Family.** The same reasoning killed a Rust-side alt-screen detector and moved the final block snapshot into the `133;D` handler.

---

## 3. Chunk boundaries are an artefact of the pipe, not a fact about the text

**Symptom, four different times.**

- The prompt string leaked into the command field.
- A phantom empty block appeared beside every real one.
- The typewriter made one command's output look like two different products depending on where a read landed.
- `ping` grew an entry at the top of its block and deleted it a moment later.

**Cause.** A PTY read boundary has no relation to the shell's write boundary. 8 KB is not a semantic unit. Anything that treats "what has arrived so far" as "what there is" will be wrong at a rate set by the pipe, not by the program.

**Rule.** Never let a decision depend on how much has arrived. Concretely, three mechanisms exist because of this:

- `booted` / `betweenCommands` — output with nothing to attribute it to is dropped rather than block-ified.
- `promptReady` — the input mirror waits for the marker rather than reading a half-drawn prompt.
- The **settle gate** — the block renderer takes the buffer's structure only after the stream has been quiet (see §5).

**Tell.** A bug that happens "sometimes", on fast commands, or only on one machine.

---

## 4. A rule about finished text, applied to text still arriving

**Symptom.** `ping` printed a heading and one reply per second. The first reply appeared as prose, then vanished and came back as a list item.

**Cause.** A body under a heading was prose at one line and a list at two. That is a perfectly good rule for a *finished* body and a broken one for a growing body: the second reply changed the first reply's node kind, so the DOM built for it was destroyed.

**Rule.** If a parse rule's answer depends on how many lines it has seen, it cannot be used on live output. Either make it length-independent (what we did — a body is a list at any length) or defer it until the block closes. This is the parser-side twin of §3.

**Watch for.** Any other rule keyed on a count: the `2+ consecutive code-shaped lines` fence rule has the same shape and has not bitten yet, because a single code-shaped line falls through to a path that produces the same thing either way. If it ever does bite, this is the entry.

---

## 5. Structure is re-derived from the whole buffer, so it is not stable while growing

**Symptom.** `npm --help` landed at one height and jumped to another. `npm ls --all` revealed in pieces.

**Cause.** Every chunk re-parses the entire buffer. Mid-stream that parse is *provably not final*, so the renderer was mounting, animating, and destroying nodes on their way to being replaced.

**Fix, and its shape.** The renderer takes the buffer only when the stream goes quiet: 80 ms, capped at 240 ms so a command that never stops talking still flows, and **1.5 s before the first paint** because there is nothing on screen yet to hold back and half a block arriving reads as broken. The raw bytes keep arriving throughout; only the parse waits.

**Rule.** Animating a node on its way to being thrown away is worse than not animating it. When in doubt about whether output is final, wait — the wait is cheap and bounded, and the run bar covers it.

---

## 6. Re-reading from the top on every chunk is quadratic

**Symptom.** `git --no-pager diff` took seconds where a raw terminal was instant.

**Cause.** Two independent instances of the same mistake:

1. `snapshot()` re-read *every row of the block* out of xterm's buffer on every chunk, at a `translateToString` and a regex per row. Thousands of rows times dozens of chunks.
2. The reveal pass prepared every element before asking whether it was on screen (see §7).

**Rule.** Anything that runs per chunk must be O(new bytes), not O(block). The read now resumes from where the last one committed — two rows behind the cursor, because the join between two rows is decided by looking at the row *after* them. A repaint (the block got shorter) or a reflow (a resize) invalidates the cache, because in both cases rows already read have been rewritten.

This is the same rule [PERFORMANCE.md](PERFORMANCE.md) states for incremental parsing, one level down. Whenever a new per-chunk consumer is added, it inherits the rule.

---

## 7. A guard is worth nothing after the work it is guarding

**Symptom.** Same as §6 — a long diff was slow, and "only animate what is visible" was already implemented.

**Cause.** The viewport test ran *after* the tier walk and after the character split. So an off-screen element paid for a DOM walk, had its text replaced with one span per character, and had it all put back. The guard was real; it just sat behind the expense.

**Rule.** A cheap test guarding expensive work goes first, unconditionally. When something is slow despite having a guard for exactly that case, check where the guard sits before assuming it is missing.

**Family.** `boxIn` had no viewport test at all and fired per code block on mount. The scrollport rect was read once per element rather than once per pass.

---

## 8. Splitting DOM the framework owns

**Symptom.** Elements froze mid-animation at the text they held; live output tore.

**Cause.** The character wave replaces an element's text nodes with per-character spans. Svelte re-renders an output element from the parser on every chunk — so splitting one hands its text to a render that is about to throw it away. A pager makes it constant rather than occasional, because `less` repaints the whole block on every keypress.

**Rule.** Never split an element the framework may re-render. Two mitigations are load-bearing and both must stay: the *original text nodes* are detached and handed back (not restored from a saved HTML string, which is what `SplitText` gets wrong and which leaves every framework reference pointing at a node that will never be on screen again), and every early-exit path calls the teardown.

**Which elements are unsafe:** the growing edge of an open block, and *every* element of a block that has been seen to shrink. Not all elements of an open block — treating it as all of them took the wave off every code block in a running command, which is its own entry in the "overcorrected" file.

---

## 9. Interactive programs that deliberately avoid the alternate screen

**Symptom.** `claude` shows a prompt and no interface. `git diff` renders a screenshot of a pager, complete with truncation markers and fragments of the previous page.

**Cause.** The renderer switches to raw xterm on alt-screen enter (`\x1b[?1049h`). Ink apps render *inline*, repainting in place with cursor moves and line clears. Git sets `LESS=FRX`, and `-X` means no alternate screen. So the swap never fires, the block renderer reads back a buffer that is being overwritten dozens of times a second, and the parse of that is garbage because the input is garbage.

**Rule.** **This is not a parser bug and no parser fix improves it.** When output looks scrambled, first establish whether the program is repainting. If it is, the answer is upstream.

Still open — it is [tasks.md](../tasks.md)'s first blocker, and it is architecture rather than a patch.

---

## 10. Elevation, environment, and process identity on Windows

**Symptom.** Starting as administrator opened two black unresponsive windows.

**Causes, three in sequence, all real, on a design that was wrong anyway.**

1. An env-var marker to detect the relaunch — `ShellExecute` across a UAC boundary gives the child a *fresh* environment block from the AppInfo service. Switched to an argv flag.
2. A second window that was never ours — a debug build is console-subsystem (`windows_subsystem = "windows"` is release-only), and an elevated child cannot inherit the dev CLI's console, so Windows hands it a new one.
3. Killing the parent left `Failed to unregister class Chrome_WidgetWin_0`, ended the `tauri dev` session, and raced the child for the shared `EBWebView` data folder.

**Rule.** Tauri creates the windows declared in `tauri.conf.json` **before** `setup` runs, so a config-dependent decision about whether this process should exist cannot be made in `setup` — by then a webview exists. The feature is Unix-only now; see [decisions.md](../decisions.md) before reopening.

---

## 11. Shell integration writes bytes that are not prompt text

**Symptom.** Typing `(`, `{` or `[` landed inside the prompt and the input bar went blank. Separately, a stray `\` appeared in front of typed characters and could not be deleted.

**Causes.**

- PSReadLine remembers where the prompt ended so it can redraw the input line in place, and it derives that from the prompt *string* it is handed. Escape sequences are zero-width on screen but not in the string, so its geometry was wrong, and the first thing to force a full-line redraw — typing a bracket, which it re-renders to colorize — rewrote the line at the wrong column.
- OSC sequences terminated with ST (`ESC \`) are two bytes, the second of which is a backslash. Anything that drops the ESC leaves a literal `\` on screen that the line editor never typed and cannot erase.

**Rule.** In `integration.ps1`, everything that is not visible prompt text goes straight to the console with `[Console]::Write`, and only `133;B` — which marks the point *after* the prompt text — stays in the returned string. Terminate OSC with BEL, one byte, which cannot be split.

---

## 12. Windows PowerShell 5.1 is not PowerShell 7

**Symptom.** OSC markers leaked as literal text (`e]133;D;0e]133;A…`).

**Cause.** The `` `e `` backtick-escape is PS7+. 5.1 needs `[char]27`.

**Rule.** The shell script targets 5.1 because that is what ships with Windows. Same family: no `&&`/`||`, no ternary, no null-coalescing, `ConvertFrom-Json` returns a `PSCustomObject`.

---

## 13. A shell's exit code is not one number

**Symptom.** Every block reported `exit 128` forever after one failing `git`.

**Cause.** `$LASTEXITCODE` is set only for *native executables* and is never cleared, so a cmdlet error leaves the previous native command's code in place.

**Rule.** Read `$?` as the very first statement of `prompt` — any earlier statement clobbers it — then fall back to `$LASTEXITCODE` for native failures and `1` otherwise, and reset `$LASTEXITCODE`.

---

## 14. The browser moves the scroll for you

**Symptom.** Long output dragged the view to the bottom despite a deliberate top-anchor. Later: swapping pages in a pager rearranged the view.

**Causes.** Scroll anchoring — a built-in heuristic that adjusts `scrollTop` to keep the view "stable" as a container grows — fought the anchor. Fixed with `overflow-anchor: none`, the standard fix for any growing scroll feed. The second one was ours: a block that got *shorter* had no path in `syncTail`, so both scroll modes bailed and left the browser to clamp `scrollTop`.

**Rule.** In a scroll container the app positions itself, every size change needs an explicit answer, including *shrinking*. A missing case is not a no-op; it is a handover to the browser's heuristic.

---

## 15. Terminal state the app changes without telling the shell

**Symptom.** After `clear`, typing was invisible until Enter ran it.

**Cause.** `term.clear()` drops the scrollback *and* rewrites the screen, promoting the cursor row to row 0. The shell is never told, so PSReadLine kept redrawing the input line where it still believed the prompt was.

**Rule.** Prefer operations that move nothing — `\x1b[3J` frees the same memory without renumbering rows. And the input mirror bails when the prompt strip matches nothing, rather than mirroring a row the prompt is not on: a desync should produce nothing, never an invented reading.

---

## 16. Remembered coordinates go stale; markers do not

**Symptom.** `PS C:\Users\vadim>` leaked into the command echo.

**Cause.** The input mirror cut typed text at a remembered column captured once when `133;B` fired. That column goes stale two ways: a resize reflows every column after it, and a chunk boundary between the prompt text and the marker means it was captured before the prompt finished rendering.

**Rule.** Prefer a marker or a fresh derivation over a remembered number. The current strip is applied fresh to the row every time and has nothing to go stale — at the cost of being PowerShell-specific, which is [tasks.md](../tasks.md)'s `PS_PROMPT` blocker and Phase 12's first task.

---

## 17. Fixing the general case when only a special case was broken

**Symptom.** A blank line inside a diff hunk split it into two code blocks. The obvious fix — let a blank line bridge a fence — swallowed `npm --help`'s heading and list into one code block.

**Cause.** The general form of the rule was wrong. Only diffs have blank rows inside a run, because a diff's context line for a blank source line is a single space.

**Rule.** Narrow the fix to the evidence that justified it — here, a diff line on *both* sides of the blank. And: **this is the one regression a self-check caught before the user did**, which is the entire argument for the fixtures in `parse.check.mjs` existing. Every parser change gets a case.

**Family.** The same session, the same mistake in the other direction: "live output is never split" was correct about the growing edge and wrong about everything above it, and it took the wave off every code block in a running command.

---

## 18. A tween writes an inline style, and inline outranks every rule forever

**Symptom.** The focused block's accent border did not appear — but only on blocks the pointer had crossed at some point, which meant "sometimes", and meant it worked when tested on a fresh block and stopped working later.

**Cause.** The hover ring animates `border-color` with GSAP. GSAP writes to `element.style`, and it does not clean up after itself unless told to — `hoverLeave` tweens the colour *back* to `--border`, which leaves an inline `border-color` on the element for good. Any stylesheet rule for that property, however specific, is outranked from then on.

**Rule.** Before styling a property from a class, check whether anything tweens that property on the same element. If it does, pick a property nothing animates (the focus mark is a `::after` rail) or have the animation clean up with `clearProps`. Persistent state and transient animation must not share a property — the transient one always wins, and it wins *later*, which is why this reads as intermittent.

**Family.** `pullToCursor` already does the clean version: it clears its transform on complete, because a stale inline transform would also stale the rect the hover ring positions against.

---

## 19. A webview drag carries text; the rest of the desktop wants a file

**Symptom.** Dragging a file out of the cwd panel into Paint or Aseprite showed the "stop" cursor. Dragging the same file from Explorer into those apps worked. Dragging from the panel *inside* VAD/OS worked.

**Cause.** An HTML5 drag hands over a `DataTransfer` — MIME types and strings. A native application asked to accept a drop wants a file handle: `CF_HDROP` through OLE on Windows, `text/uri-list` on GTK. There is no `setData` call that produces one. A `text/plain` path *looks* like the right information and is the wrong kind of object, so every target refuses it, and refusal is drawn as the stop cursor.

**Why it took a wrong turn first.** Everything was reachable from the DOM API, so the API looked like the place the answer was. The failing check was between processes, where none of that vocabulary exists.

**Rule.** **Anything that has to be understood by another application is an OS-level API, never a DOM one.** The DOM stops at the webview boundary. This is the same boundary [decisions.md](../decisions.md) already crossed in the other direction: dropping a file *in* goes through the native drag-drop rather than the HTML5 `drop` event, and for the same reason — the two ends of a drag are negotiated by the window system, not the document.

**Corollary, and it is the part to check.** The webview's own drag handling and the native one displace each other, so a gesture that needs the native path cannot start from `dragstart` — it starts from a measured pointer move. If a drag "works in the app and nowhere else", this is it.

**Family.** §16's remembered coordinates and the OSC 133 rule in [CLAUDE.md](../../CLAUDE.md) are the same shape: information handed across a boundary out of band arrives stripped of what made it meaningful.

---

## 20. The reveal was on the container, and the container only arrives once

**Symptom.** `ping`'s reply rows appeared with no animation. Not all of them — the first row or two rose into place normally, and every row after that simply popped into existence. Ordinary prose output animated fine, so the reveal itself was clearly working.

**Cause.** The action was on the `<ul>`. An element animates **once, on the chunk it mounted in** — that rule is load-bearing (it is what makes a re-render cheap, see [ANIMATION.md](ANIMATION.md)), and it means the reveal fires when the *list* arrives, not when a row does. A list grows a row at a time: the `<ul>` mounts on the first chunk that produced two items, animates, and every later row is appended into an element that has already had its turn.

**Why it took a wrong turn first.** The report was "do not animate this with the wave", which reads as *too much animation* — so the first fix removed the wave from lists. That fix was a **no-op for the exact command that prompted it**: `ping`'s list is the last element of an open block while the command runs, which already made it unsafe to split, so it was already rising as one piece. The change typechecked, built, had a passing self-check and a written test plan, and changed nothing on screen. Only the user saying "it behaves as before" surfaced that.

**Rule.** **Attach a reveal to the thing that arrives, not to the thing that contains it.** If a container can gain children after it mounts, the child is the unit. Applies to any future grouped node — a table's rows, a nested list — not just `<ul>`.

**Second rule, which is the more expensive one.** *A fix that cannot be shown to change behaviour has not been verified.* Green typecheck, green build, green self-check and a plausible mechanism are all compatible with a diff that does nothing, because none of them observe the screen. When a change is aimed at a specific command, work out what that command's code path actually does before writing it — here, five minutes of reading `runReveals` would have shown that `ping`'s list was already on the unsplit branch.

**Family.** §17 is the same failure viewed from the other side: fixing a general case that was not broken, versus fixing a case that was already fixed. Both come from reasoning about the rule instead of tracing the run.

---

## Housekeeping

Add an entry when a bug's *cause* was surprising, not when its fix was long. If the next occurrence would be recognised from the symptom alone, it does not need to be here.

Cross-references: [ANIMATION.md](ANIMATION.md) and [PERFORMANCE.md](PERFORMANCE.md) are binding rules; this file is why several of them exist. [decisions.md](../decisions.md) holds settled calls, [tasks.md](../tasks.md) the live backlog.
