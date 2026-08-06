# Architecture

## Vocabulary

These two words were used interchangeably early on and no longer are. Getting them wrong in a doc or a class name makes the layout discussion ambiguous, so:

| Term | Means |
|---|---|
| **Container** | A region of the window that holds modules. There are two today — the **output container** (the scrolling stream) and the **input container** — and later there will be others for overlays. |
| **Module** | The reusable component almost everything is built from: the **input module**, an **output module** (one per command), the **settings module**, the **debug module**. A module is the bordered, floating surface itself. |

So a command produces an *output module*, which lives in the *output container*. What earlier notes called "the container" for a single command is an output module; where "container" survives in older text about the live `<pre>`, it means the module's live region.

The font-mode slots `--font-outside` / `--font-inside` predate this split and are named for module boundaries, not container ones.

## What this is

VAD/OS is a **terminal emulator**, not a shell. It hosts whatever shell the user points it at — PowerShell, cmd, WSL, Git Bash, bash, zsh, fish, anything with a binary path — inside a PTY, and everything above that (blocks, markdown, panes, export, theming) is the terminal's job, not the shell's.

That split matters because it decides where features can live. Anything that requires the shell's cooperation (OSC 133 boundaries, cwd reporting) needs a per-shell snippet and degrades where the shell has no hook. Anything the terminal can do from the byte stream alone (rendering, folding, export, theming) works on every shell for free. When a feature can be built either way, build it in the terminal.

**PowerShell is the Windows default, not the foundation.** It is what `pty_spawn` picks when nothing is configured, because it ships with Windows and every Windows developer already has it. Nothing in the renderer knows it exists — the one PowerShell-shaped thing in the frontend is the prompt-strip regex, and that is a bug to fix, not a design. See [foundation/phase-12-shell-hosting.md](foundation/phase-12-shell-hosting.md).

## The differentiator, and its constraint

Warp, Ghostty, and WezTerm are all polished. Polish is not the moat. The thing none of them do is treat a command's output as a **document** — an addressable structure that can be folded, styled, linked, exported, and diffed — rather than a span of styled text.

The constraint that comes with it: **compatibility first, beauty second.** Most command output is plain text or ANSI, and rendering it as markdown would be wrong more often than right. A terminal that mangles `ls` output to look pretty is a terminal people uninstall on day one. So:

1. Plain and ANSI output renders **exactly as it is**. This is the default path and it is never a downgrade.
2. Markdown rendering is entered on **evidence** — an explicit declaration from the program, or a detector confident enough to be right nearly every time. See [foundation/phase-8-markdown-engine.md](foundation/phase-8-markdown-engine.md).
3. Every block keeps its raw bytes and can be **toggled back** to them. If the renderer gets it wrong, one keystroke undoes it.

Rule 3 is what makes rules 1 and 2 safe to be wrong about.

## Stack

| Layer | Choice |
|---|---|
| Shell / native | Tauri v2 (Rust) |
| Frontend | SvelteKit 2 + Svelte 5, SPA mode via `adapter-static` |
| Build | Vite 6 |
| Terminal process | `portable-pty` 0.9 |
| Raw terminal render | xterm.js (`@xterm/xterm` + `@xterm/addon-fit`) — **fallback only** |
| Animation | GSAP (+ SplitText) |
| Config | TOML (`toml` crate), watched with `notify` |
| Styles | A CSS custom-property token layer on `:root` (no preprocessor) |

## The dual renderer

This is the load-bearing decision. Everything else hangs off it.

xterm.js is **not** the primary view. Since ~95% of output is markdown blocks with the input pinned at the bottom, two renderers share one PTY stream:

```
                 ┌──────────────────────────┐
  shell ──PTY──▶ │ Rust: dumb pipe          │
                 └────────────┬─────────────┘
                              │ Tauri channel (raw bytes, untouched)
                 ▼
                 ┌──────────────────────────┐
                 │ xterm.js: VT parse       │
                 │  OSC 133/7 handlers,     │
                 │  alt-screen buffer swap  │
                 └────────────┬─────────────┘
                 ┌────────────┴─────────────┐
                 ▼                          ▼
        Block renderer (default)     xterm.js view (fallback)
        reads back xterm's buffer    raw passthrough,
        styled + animated            never intercepted
```

**One parser, not two.** Markers are read by xterm's own `registerOscHandler`, so a handler fires mid-parse with the cursor exactly where the marker sat in the stream. Parsing them in Rust and forwarding them out-of-band was tried and reverted: two channels have no ordering guarantee, so a `command_end` could overtake the output chunk it referred to and that output ended up filed under the wrong command. Alt-screen detection rides on `buffer.onBufferChange` for the same reason.

**Block text is read back out of xterm's screen buffer**, not accumulated from the raw stream. xterm has already applied every escape sequence — cursor moves, erase-line, PSReadLine's full-line redraw on each keystroke, reflow on resize. Each block holds an `IMarker` on its first row and re-reads to the cursor with `translateToString()`.

**Block renderer** — plain DOM. One `<section>` per command: divider, `#` command heading, output body, `##` result heading tinted by exit code. This is what gets styled and animated.

**xterm.js** — mounted only when the PTY emits alt-screen enter (`\x1b[?1049h`), torn down on exit (`\x1b[?1049l`). This is the `vim` / `htop` / `claude` CLI path. Raw bytes, no interception, **no animation** except the crossfade in and out.

### The live container

Output arriving *while a command is still running* goes into a `<pre>` container that preserves `white-space: pre` and monospace. This is where progress bars, ASCII banners, and ANSI color survive — the thing that would otherwise be destroyed by markdown prose styling.

ANSI → HTML conversion happens **only** here. Prose-styled markdown never touches raw bytes.

## The render decision

A closed block's snapshot goes through one classifier before anything is drawn. This is the single place where "is this a document or is this text" is decided, so there is one thing to fix when it decides wrong.

```
block snapshot (text read back from xterm's buffer)
        │
        ▼
  ┌─────────────┐   declared    ┌──────────────────┐
  │ classifier  │──────────────▶│ markdown AST     │
  │             │   detected    │  (parse.js, or   │
  │             │──────────────▶│   a real parser) │
  │             │               └────────┬─────────┘
  │             │   neither              │
  └──────┬──────┘                        ▼
         │                    ┌──────────────────────┐
         ▼                    │ node renderers       │
  ┌─────────────┐             │ headings, lists,     │
  │ raw <pre>   │             │ tables, code blocks, │
  │ ANSI → DOM  │             │ mermaid, images      │
  └─────────────┘             └──────────────────────┘
```

**Declared** beats **detected** beats **raw**, and raw is the default when neither fires. A program that wants markdown says so; everything else has to earn it.

Three properties this has to keep:

- **The raw bytes survive.** The block owns its snapshot regardless of how it rendered. Toggling to raw, copying, and exporting all read from it, so none of them depend on the renderer having been right.
- **No markup is generated.** The AST renders to real DOM nodes through Svelte, which escapes text. Command output can therefore never be interpreted as markup — the injection question does not arise, and it must not be reintroduced by any renderer swap.
- **One AST, many outputs.** Screen rendering, `copy as markdown`, and file export are three consumers of the same tree. A rule added to the parser lands in all three at once. This is why the parser emits nodes and not a markdown string.

## Rich nodes

Some AST nodes are not text. Mermaid diagrams, images, and video render as embedded elements inside the block, sized to the block's width and never to the terminal grid.

The rule that keeps them from breaking everything else: **an embed is a leaf.** It occupies a block-level slot, it does not reflow with the character grid, and it is skipped by the typewriter reveal (which measures rows, and an embed has none). See [foundation/phase-9-rich-media.md](foundation/phase-9-rich-media.md).

## Data flow

1. Rust reads PTY output in 8 KB chunks on a dedicated thread.
2. Bytes stream to the frontend over `tauri::ipc::Channel` as `InvokeResponseBody::Raw`. Deliberately *not* `emit` — channels avoid per-event JSON overhead on a high-frequency binary stream.
3. **Decoding is the frontend's job.** Rust never converts to `String`, so multi-byte characters split across two reads are not corrupted. xterm and the block renderer both reassemble.
4. Rust forwards the bytes verbatim. OSC 133 / OSC 7 markers are consumed in the frontend by xterm's OSC handlers (returning `true` keeps them off the screen) — see the ordering note above for why this cannot move back into Rust.

## Command boundaries

Everything block-structured depends on knowing where one command's output ends. Solved with **OSC 133 shell integration**: a small init script per shell emits `A` (prompt start), `B` (command start), `C` (output start), `D;<exit>` (done). Industry standard — VS Code, WezTerm, and Windows Terminal all use it.

Injected at spawn time via shell init flags rather than editing the user's dotfiles where possible: PowerShell `-NoExit -Command`, bash `--rcfile`, zsh `ZDOTDIR`. Fish needs a documented manual line.

OSC 7 (cwd reporting) comes along for free and drives the file-nav panel and the prompt path.

## Layout

The input field is pinned to the bottom via a flex column — scroll region `flex: 1` above, fixed-height input row below. **Not `position: fixed`**: it must resize cleanly with the window and must not fight the settings overlay's stacking context.

## PTY layer

`portable-pty` abstracts the platform difference, and nothing above it should ever need to know which side it is on:

| Platform | Mechanism |
|---|---|
| Windows | ConPTY (`conhost.exe` pseudoconsole) |
| Linux | `openpty` / `forkpty` |

ConPTY is the one that leaks. It rewrites parts of the sequence stream on its way through — most relevantly, alt-screen enter/exit is not guaranteed to arrive verbatim, which is the standing suspect for the alt-screen blocker in [tasks.md](tasks.md). Anything that depends on a specific escape sequence surviving the PTY has to be verified on Windows separately; passing on Linux proves nothing about it.

## Files

```
src-tauri/src/
  lib.rs          Tauri builder, command registration
  pty.rs          PTY session: spawn / write / resize
  screenshot.rs   F2 debug capture → demo/, rewrites the README gallery
src/lib/
  parse.js        output → AST (headings, lists, code, inline code, tone)
  parse.check.mjs assert-based self-check: node src/lib/parse.check.mjs
src/routes/
  +layout.ts      ssr = false (SPA mode)
  +page.svelte    terminal view
.claude/docs/ANIMATION.md    binding animation ruleset
.claude/docs/PERFORMANCE.md  binding performance budgets
CLAUDE.md         project entry point for agents
```
