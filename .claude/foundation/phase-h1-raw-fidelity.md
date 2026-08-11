# Phase H1 — Raw Fidelity

**Status: all four items built, none verified on screen (2026-08-10).** First phase of the Hardening group, and the one everything in Expansion sits on.

Two of the project's load-bearing statements are currently false in block mode, and both have the same cause.

`snapshot()` in [../../src/routes/+page.svelte](../../src/routes/+page.svelte) reads a block's text back out of xterm's screen buffer with `translateToString()`. What it keeps is a decoded string. So:

- **"Every block keeps the raw bytes it rendered from"** ([../../CLAUDE.md](../../CLAUDE.md), [../README.md](../README.md), [../decisions.md](../decisions.md)) — it keeps text, not bytes. The README lists the raw toggle under *Known broken*; the reason it is broken is that there is nothing to toggle to.
- **"Plain and ANSI output renders exactly as it is"** ([../architecture.md](../architecture.md)) — colour is discarded entirely on the block path. `git status` renders monochrome, and what tint a block does have is re-derived from token *shape* by the parser, which is a different thing wearing the same clothes.

[phase-8-document-engine.md](phase-8-document-engine.md) already names the second one as a gotcha: *"ANSI and markdown collide… the AST needs to carry inline colour spans, or colour is dropped on the markdown path — and dropping it silently is a regression from a plain terminal."* That gotcha is not a future risk. It is the current state, and Phase 8 would be written on top of it.

## Scope

1. Colour and attributes survive into a block.
2. A block retains the raw bytes it was produced from.
3. The raw toggle exists.
4. The three representations a block now holds are written down, because phases 8 through 14 all read them.

## 1. ANSI colour in blocks

The mechanism already exists and is proven — the mirrored-prompt loop reads *cell attributes* off the same buffer to find the shell's selection. It has simply never been pointed at output.

- `snapshot()` walks rows through `rowText(y)` today and produces a flat string. It produces **runs** instead: `{ text, fg, bg, bold, italic, underline, inverse }`, with adjacent cells of equal attributes coalesced into one run. The default-attribute run stays the overwhelmingly common case and must carry no styling at all — a run with no attributes is indistinguishable from today's plain text, in memory and in the DOM.
- The parser's `text` node parts and `code` spans carry the attributes through. **The AST still emits nodes, never markup** — a run is data, Svelte escapes it, and the injection surface does not reopen. This is the rule that survives every phase and it is not negotiable here either.
- Colour resolves through the token layer rather than hardcoded hex, so [phase-11-theme-engine.md](phase-11-theme-engine.md) can retheme the sixteen ANSI slots later. `xtermTheme()` / `applyTokens()` already own that mapping for the raw view. Reuse it; a second palette is two palettes to keep in agreement.
- **The program's colour and the parser's tint are different things and must not fight.** Where a program coloured a run itself, that is the answer — the parser's shape-derived tint is what fills in when the program said nothing. Deciding which wins where is the real work in this item, not the plumbing.
- Cost control follows the existing discipline: past `CODE_SPAN_MAX` a block falls back to one untinted span, exactly as it does now. A run per attribute change on a `--help` dump is bounded by the same ceiling.

## 2. The per-block raw byte log

Distinct from item 1, and not a substitute for it.

**Raw bytes cannot be replayed as the screen.** The comment above `snapshot()` is right about why: xterm has already applied cursor moves, erase-line, PSReadLine's full-line redraw on every keystroke, and reflow on resize. Appending raw bytes and rendering them reproduces all of that as literal garbage. The byte log is a **viewing and export representation only** — what the program actually emitted, shown as itself.

- The PTY channel handler appends each chunk to the open block's log as a `Uint8Array` slice. No decoding, no concatenation, no parsing: push and move on. This sits in the hot path and [../docs/PERFORMANCE.md](../docs/PERFORMANCE.md) forbids per-byte work there.
- Capped per block and in total, counted against the 250 MB figure in that same document. When the cap is reached the **oldest** blocks drop their log first, and a block that lost its log says so in its raw view rather than showing a plausible-looking empty one.
- PERFORMANCE.md already decided the order of sacrifice: *"If it cannot be met, the AST is what gets dropped and re-derived on demand, not the raw bytes."* So AST eviction is part of this item, not a later optimisation.
- A block whose command took the alt screen (`rawBlockId`) keeps no log. There is no block to view, and the session is xterm's.

## 3. The raw toggle

One chord on the focused block swaps its rendered nodes for the byte log, shown with escape sequences visible, and swaps back.

- The focus model is already built — `focusedId`, `focusBlock`, `moveFocus` — and the comment at its head names the raw toggle as one of its intended consumers. Copy is the only one today. This is the second, and it needs no new selection concept.
- **The binding and its `HELP_NODES` line land in the same change.** [../../CLAUDE.md](../../CLAUDE.md) makes that one task rather than two, and a key that is not in `/help` does not exist as far as anyone but the author is concerned.
- Crossfade is 0.2s, per the durations table in [../docs/ANIMATION.md](../docs/ANIMATION.md). The settled *"the character glitch is the toggle's state-change animation"* applies to a toggle's own label and not to the block — a command block never glitches.

## 4. What a block is now

Three representations, and which one is authoritative matters to every phase after this one. This goes in [../architecture.md](../architecture.md), not into a doc of its own.

```
CommandBlock
  metadata  — id, cwd, command, exitCode, and (phase 13) startedAt / endedAt
  raw       — the byte log. Authoritative. Evicted oldest-first under pressure.
  buffer    — decoded text plus attribute runs, read back from xterm's buffer.
  nodes     — the AST. Derived, cheap to drop, re-derived on demand.
```

The direction of derivation is the point: nodes come from the buffer, the buffer comes from the screen, and the bytes are what actually happened. Anything that has to be right — export, copy-as-raw, a bug report — reads down the list rather than up it.

## Verify

- `node src/lib/parse.check.mjs` covers attribute runs, including a run spanning a wrapped row and a block past `CODE_SPAN_MAX`.
- `git status`, `ls --color=always`, `eza -l` and `Get-ChildItem` all show the program's own colours in block mode, matching what the same command shows in the raw view.
- A program that emits no colour produces no styled runs at all — verified by looking at the DOM, not by looking at the screen.
- The raw toggle on a focused block shows escape sequences and toggles back. Toggling twice returns the block to exactly what it was.
- A block whose log was evicted says so.
- RSS after 100k lines stays inside the PERFORMANCE.md budget with logs retained. If it does not, the AST eviction path is what gets exercised — not the byte cap.

## Status / Learned

**The byte log, the toggle and the block model landed together (2026-08-10).** `logRaw` / `rawText` / `toggleRaw` in `+page.svelte`, Ctrl+Shift+R, caps at 1 MiB per block and 24 MiB per session with oldest-first eviction. Notes from building it:

- **The log is written before `t.write`, not in its callback.** The callback runs after xterm has parsed the chunk, and `133;D` fires mid-parse and closes the block — so the chunk that finished a command would have been filed under no block at all. Logging early means the chunk carries the next prompt behind the `D` marker, and that tail is cut in `rawText` instead, where a cut costs nothing.
- **The start boundary is free and the end boundary is not.** `openBlock` runs when the user presses Enter, so the log already begins at the command echo — there is no start marker to look for. Which is as well: PowerShell's integration **never emits `133;C`**, so an output-start marker is not something that exists here. Do not write code that waits for one.
- **`rawText` is cached on the log, keyed on chunk count.** The template reads it on every render and a block re-renders on every chunk. Carries a `ponytail:` naming the ceiling — a block left on the raw view *while* still producing output re-decodes from the top per chunk.
- Copying a block that is showing raw copies the bytes. The rest of the copy modes are phase 13's; this one had to exist the moment the toggle did.

**Colour landed by offset, and the offsets are found rather than threaded.** The choice was between rewriting every parser rule to carry positions and giving nodes source ranges; the third option considered and rejected was routing coloured blocks around the parser entirely, which would have been much smaller and would have traded away the structure that makes this a different terminal rather than a prettier one.

What made it cheap: **every run of text a node holds is a verbatim substring of the buffer.** The parser joins lines and drops the odd backtick but it never rewrites text, so a cursor that only moves forward can find each run in order — `locate` in `parse.js`, one pass, no rule touched. Notes:

- **Headings and list rows are walked but not marked.** They are not verbatim enough to colour, but skipping them entirely let a later part match text belonging to one of them. The check has a case for it, with the same word repeated either side of a heading.
- **`locate` runs only when the block has runs**, so a session with no colour in it pays nothing and gets exactly the nodes the parser made.
- **Runs stay in the pre-slice coordinates and `runShift` carries the difference.** Re-indexing every run when the echoed command line is dropped off the front is a walk over the whole array on every chunk; one subtraction inside `tint` is not.
- **Reverse video is resolved at snapshot time, not at paint time.** A block has no terminal background to fall back on the way the raw view does, so "swap them" has to become two concrete values while the cell is still in hand.
- **The sixteen palette colours are tokens (`--ansi-0` … `--ansi-15`), and xterm's theme now reads the same ones**, so a program's red is one colour in both views. The 216-colour cube and the greyscale ramp are arithmetic and are computed.
- **A program's colour is not a label**, so it waves rather than sweeping under a bar. Recorded in `ANIMATION.md`: a tier is the parser's verdict, and a colour the program chose is not a verdict this app made — `ls --color` would otherwise put a bar over every filename on screen.
- `ponytail:` on `rowRuns` — cell index is taken as character index, which drifts by one on a row containing a wide glyph. The *text* is unaffected, so the cost of being wrong is a colour boundary one character out on a CJK or emoji row.

## Gotchas to watch

- **A run per attribute change is a DOM element per attribute change.** A program that changes colour every character produces one span per character, which is the wave's problem in a new place. The `CODE_SPAN_MAX` fallback is the ceiling; check it fires before a pathological input reaches the DOM.
- **`inverse` and the theme.** A program using reverse video expects the terminal's own background, which the block renderer does not have in the same way the raw view does. Decide once whether inverse is resolved at snapshot time or at paint time.
- **The byte log and the block boundary.** OSC 133 `D` closes a block, but the bytes arrive in chunks that may straddle it. The log has to be split where the marker sat, which is the same ordering problem that forced OSC parsing into the frontend in the first place.
- **Do not let the log become the render source.** Every future session will be tempted by it, because it looks like the honest input. It is not; the screen is. See the comment above `snapshot()` and QUIRKS.md.
