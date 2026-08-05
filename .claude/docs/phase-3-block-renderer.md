# Phase 3 — Block Renderer & Live Container

**Status: not started.** Blocked on Phase 2.

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
- Long scrollback: consider virtualising or capping retained blocks. See [tasks.md](tasks.md).

## Open questions

- Which markdown renderer? It must be safe against arbitrary command output being interpreted as markup, and fast enough to run on streaming content.
- Does markdown render incrementally as output streams, or only once the command completes? Incremental is nicer but re-parsing on every chunk is expensive.
