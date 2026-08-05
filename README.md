# VAD/OS

**Status:** Concept / Early Design

A cross-platform terminal for Windows and Linux that renders command output as structured markdown instead of a raw text stream.

## Why

Existing terminals split along OS lines — the ones that feel good on Linux often don't exist or don't feel native on Windows, and vice versa. On top of that, raw terminal output is hard to scan: commands, logs, and results blur together with no visual separation.

VAD/OS is built to solve both problems at once: one terminal, same experience on both platforms, with output that's actually readable.

## Goals

- **One terminal, both platforms.** Identical functionality and visuals on Windows and Linux — no feature gaps, no "works better on X."
- **Markdown-structured output.** Every command becomes a distinct block instead of a wall of text:
  - A command is rendered as a `#` heading, preceded by a `---` divider.
  - Active/running output (downloads, progress bars, loading text) is contained in a live-updating fenced code block.
  - On completion, a closing `##` heading shows the result — green for success, red for failure — followed by a `---` divider.
- **Modern, intentional styling.** Dark theme, muted accent colors, thin rounded borders — a terminal that looks designed, not default.
- **Font choice.** Three selectable fonts: System (OS default), Mono (the terminal's standard monospace), and Modern (Claude Sans Modern).
- **Full-screen app compatibility.** Programs that take over the screen (vim, htop, tmux) fall back to a normal raw terminal view — markdown rendering only applies to standard command output.

## Non-goals (for now)

- Replacing full TUI rendering for alt-screen applications.
- Supporting shells beyond bash/zsh/fish/PowerShell in the initial version.

## Status

Currently in the design/architecture phase. Core stack direction: Tauri + xterm.js + portable-pty, with shell integration scripts driving command boundary detection via OSC escape sequences.

---

**Last Updated:** 2026-08-05
