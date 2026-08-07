# Phase 3 — Block Renderer & Live Container

**Status: in progress.** Structure is in place; markdown rendering is not.

## Current state

- **Block text comes from xterm's screen buffer, not the raw byte stream.** Each block registers an `IMarker` on its prompt row; after every `term.write()` completes, the rows from that marker to the cursor are read back with `translateToString()`. xterm has already applied the escape sequences, so PSReadLine's per-keystroke line redraws collapse to one line and resize reflow is handled for free. This is the "use an existing parser, do not hand-roll one" rule below, satisfied by the parser already in the app.
- **The input bar is docked at the bottom of `.app`** as a flex sibling of the scroll region (not `position: fixed`), so output and input are locked independently and the prompt is always visible. It mirrors xterm's cursor row, split at the column where the shell's prompt string ends — that column is captured once per prompt, on the first write after OSC 133;A.
- **Enter is the hand-off.** `term.onData` seeing `\r` is what converts the typed line into a new block; the OSC events cannot do it because they arrive on a different channel than the bytes they describe, so a marker placed on an event lands against a not-yet-written screen.
- **Block anatomy is split three ways** — `command` (plain), `buffer` (markdown, once a renderer is chosen), result line (plain). The command line is stored separately at Enter and stripped from the snapshot, so it never reaches the markdown path.

- **Structured output, not a markdown string.** `src/lib/parse.js` turns `buffer` into `heading` / `list` / `text` nodes and the component renders them as DOM. No markup is generated or re-parsed, so arbitrary command output can never be read as markup — Svelte escapes text nodes. Two rules so far: a line ending in `:` is a heading, and the body under it becomes a list only if it has 2+ lines (so `npm`'s `Usage:` lists but `All commands:` stays prose). One blank line between heading and body is allowed; the next blank ends the group. Self-check: `node src/lib/parse.check.mjs`.

- **A whole command is one inline code run.** A known command name, an optional known subcommand verb, and every argument-shaped token after them — so `git diff --no-index [<options>] <path>` is one span rather than a lone backticked `--no-index` sitting inside plain prose. Both lists are curated in `parse.js` rather than detected; see [../decisions.md](../decisions.md) for why, and for why the subcommand list is a whitelist after a blacklist failed on "git is not installed" and "cmd instead". Two things the rule needs that are not obvious: a bare relative path (`src/lib`) counts as an argument *only inside a command run*, because the general path rule refuses it on purpose (it would read the `/OS` in `VAD/OS` as a path); and every gap inside a run is `[ \t]`, never `\s`, since `\s` matches a newline and a token crossing a line break lands in the wrong node.

## Still to do

Phase 3 closes once blocks render reliably. The renderer's future — a real parser, the classifier, streaming, folding — is [phase-8-markdown-engine.md](phase-8-markdown-engine.md), not more scope here. Anything below that is not a bug in the existing structure belongs there.

- More parser rules, or a swap to a real renderer — Phase 8 owns the decision; see [../tasks.md](../tasks.md).
- Error / note output as fenced code blocks — needs stderr detection, see [../tasks.md](../tasks.md).
- The input-to-block transition animation ("shoot out" the typed line into a new block as one module) — Phase 5, see [../docs/ANIMATION.md](../docs/ANIMATION.md).

## Original plan

- Svelte block-list component. Layout: `flex-direction: column`, scroll region `flex: 1`, input row fixed height at the bottom. **Not `position: fixed`** — it must resize cleanly and must not fight the settings overlay's stacking context.
- Per-command render lifecycle:
  1. `---` divider
  2. `#` command heading
  3. live `<pre>` container (output streams in here)
  4. on `command_end`: `##` result heading, colored by exit code
  5. `---` divider
- ANSI → HTML **inside the live container only**. Use an existing converter (`ansi-to-html`, or xterm's own parser). Do not hand-roll one.
- Alt-screen mode event (from Phase 2) mounts xterm.js over the viewport with raw passthrough; on exit, unmount and restore blocks.
- Input field at the bottom is the real prompt — keystrokes go to the PTY.

## Block anatomy (per later discussion)

```
> C:\path\to\cwd    npm run build      ← echoed command, PLAIN text, not markdown
─────────────────────────────────────
  <markdown-rendered output>          ← typewriter reveal, per ANIMATION.md
─────────────────────────────────────  ← closing divider
```

- The **echoed command line** is always plain, never markdown-rendered. Prefix `>`, then the path, then the typed text.
- Below it, the markdown output block renders with the typewriter reveal.
- A divider closes each block, separating it from the next.
- The block carries a subtle background: slightly lighter than the terminal base, with a border slightly lighter again. Both from the Phase 4 token layer — never hardcoded.
- Border hover animation is ported from the portfolio project. **Source not yet provided.**

## Verify

- `git log` renders as blocks.
- `npm install` — progress bars stay intact and aligned inside the live container.
- A command printing an ASCII banner keeps its alignment.
- Launching `claude` switches cleanly to raw mode and returns cleanly on exit.

## Gotchas to watch

- **ASCII art and banners must survive.** They live in the `<pre>` container with `white-space: pre` and monospace. Prose markdown styling must never touch them. This is the single most likely thing to break.
- Carriage returns (`\r`) used for in-place progress bar redraws must be handled — naive appending turns one progress bar into hundreds of lines.
- **Two kinds of line break reach the snapshot and only one of them is real.** xterm's own soft wrap is flagged (`isWrapped`) and joined. PowerShell wraps its error records itself, at the console width, with a genuine newline — nothing flags those, and most of them belong in the output. The exception is a word longer than a line: it has no wrap point, so PowerShell cuts it mid-word, and keeping that break puts a space in the middle of a token in both the rendered block and the markdown export. `splitWord` in `src/routes/+page.svelte` rejoins exactly that case, off the shape of the seam. A word that happens to end on the last column, followed by a new logical line, is indistinguishable from a split and gets joined — the emitting program's own wrap width is not something the PTY carries.
- Long scrollback: consider virtualising or capping retained blocks. See [../tasks.md](../tasks.md).

## Open questions

- Which markdown renderer? It must be safe against arbitrary command output being interpreted as markup, and fast enough to run on streaming content.
- Does markdown render incrementally as output streams, or only once the command completes? Incremental is nicer but re-parsing on every chunk is expensive.
