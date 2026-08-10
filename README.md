# VAD/OS

**A terminal that treats a session as a structured interaction rather than a stream of text.**

Commands become blocks, output keeps the structure it already had, results are explicit, and anything the terminal does not understand is passed through untouched. Cross-platform, Windows and Linux.

That last clause is the load-bearing one. A terminal is only worth switching to if everything that worked in the old one still works, so the order is **compatibility first, beauty second** — and where VAD/OS has no confident answer, it gives the conventional one.

## Demo

<!-- demo:start -->

![vados-1786229389.png](demo/vados-1786229389.png)

![vados-1786229398.png](demo/vados-1786229398.png)

![vados-1786229406.png](demo/vados-1786229406.png)

![vados-1786229493.png](demo/vados-1786229493.png)

![vados-1786229641.png](demo/vados-1786229641.png)
<!-- demo:end -->

## Status

**Pre-1.0 and under active development. Nothing here is stable, and several common cases are broken; see *Known broken* below.** It is developed on Windows; the Linux half has never been run.

## What works

- **Structured output.** Each command becomes its own block: a head carrying the working directory and the command line, the output parsed into headings, lists, code blocks and inline code, and a result line on completion. The parser emits nodes rather than a markup string, so command output can never be read as markup.
- **Structure on evidence, never assumed.** A document is rendered only when a program declares it, or a reader command prints a `.md` file, or the text clears a high bar on its own. Everything else is plain text — which is the safe wrong answer, because a missed structure costs plainness and a false positive changes what the program printed.
- **Reveal animation.** A bar sweeps each coloured token in the order of how much it means, and a character wave rises under the grey prose between them. Motion is spent on what benefits from attention, not on everything that could take it. Off-screen output is never animated, and long output degrades to a coarser unit rather than falling behind. `Instant` in the settings turns it down to a single rise per element.
- **Font modes.** Not a font picker, a rule about where each font applies. **Mixed** (default) puts mono outside modules and sans inside them; **Mixed Reverse** swaps that; **Sans** and **Modern** apply one font throughout. Code blocks, inline code, ASCII banners and the raw view stay monospace in every mode, because alignment is load-bearing there.
- **Settings panel** on Shift+Esc: font mode, accent colour, scroll behaviour, reveal mode, startup directory. Stored in `config.toml`, which is watched. An external edit applies without a restart.
- **Sticky command lines.** When a block's output runs taller than the screen, the command line that produced it pins to the top.
- **Input completion.** A suggestion strip above the prompt with ghost text inline: this session's history, a curated command list, and the contents of the directory being typed. Tab or → takes it; Enter always runs the line.
- **Block selection and copy.** Ctrl+Up/Down or a click selects a past block; Ctrl+Shift+C copies its output and Ctrl+Shift+M copies it as markdown. Right-click does the same two.
- **A folder panel** on Ctrl+B, as a tree on the right. It takes width from the terminal rather than covering it, so the shell keeps wrapping where the text ends. Click to expand, shift+click to put `cd` at the prompt, click a file for the ways to run it, and drag a file out into any other application. It never moves, renames or edits anything.
- **Files dropped on the window** offer the same choices as a file clicked in the panel.
- **`open <path>`** opens a file or folder in whatever the system opens it with. `help` lists every command and key.
- **Full-screen apps.** `vim` and `htop` hand over to a raw xterm.js view at native speed, and nothing is intercepted or animated there.

## Known broken

- **`claude` and other inline TUIs render as a prompt with no interface.** The raw-view switch triggers on the alternate screen, and Ink-based apps do not use it — they repaint in place, so the block renderer reads back a buffer being overwritten many times a second. Most modern Node TUIs are in this category; `vim` and `htop` are the easy case. Fixing it is a design decision about what else should trip raw mode, not a patch.
- **`git diff` through its pager lands as a screenshot of `less`**, right-truncation markers and all, for the same reason. `git --no-pager diff` is the workaround.
- **ANSI colour is dropped in block mode.** A block's text is read back off the screen without its cell attributes, so `git status` renders monochrome and what tint a block does have was derived by the parser from the shape of the text. The raw view is unaffected. This is the next thing being fixed.
- **A block cannot be toggled back to its raw bytes** — and, contrary to what this file used to say, it does not currently keep them. Same fix as the line above.
- **Compatibility is largely unverified.** `ssh`, `tmux`, `fzf`, mouse reporting, bracketed paste, hyperlinks and Unicode width have not been checked systematically against a conventional terminal. A checklist and a fixture suite are being built; until they have been run, assume nothing.

## Not built yet

- One terminal, both platforms: identical on Windows and Linux, no feature gaps. Linux has never been run.
- Shells beyond PowerShell, bash and zsh, WSL, Git Bash, `cmd`, fish, Nushell, or any binary you point it at.
- Interactive code blocks: copy, or run after an explicit confirmation showing exactly what will be sent.
- Collapsible output, with stack traces folded to the frames that matter.
- Mermaid diagrams, images and video rendered inline in the block that printed them.
- Split view, rendered on one side, raw terminal on the other.
- Export of a block or a session to Markdown, HTML or PDF.
- Themes as data over a fixed token contract, hot-reloaded from a file.
- A command palette, and search across the session that lands on the command rather than the line.
- Duration and exit code on every block, and re-running one.

## Why

Existing terminals split along OS lines — the ones that feel good on Linux often don't exist or don't feel native on Windows, and vice versa. On top of that, raw terminal output is hard to scan: commands, logs and results blur together with no visual separation.

VAD/OS answers both at once: one terminal, the same on both platforms, with output that is actually readable. The structure it shows you was already there — it is what a program's output means, made visible instead of left to be inferred. That is useful to a person reading it, and it happens to be useful to anything else that has to read it too.

What it deliberately is not: an IDE, a file manager, or a chat window. It hosts a shell and renders what comes back.

## Performance

A terminal is used hundreds of times a day, so animation and block chrome are not allowed to cost anything you can feel. The bar is that VAD/OS must never be noticeably heavier than Windows Terminal or Alacritty.

The budgets the code is written against are in [`.claude/docs/PERFORMANCE.md`](.claude/docs/PERFORMANCE.md). The measurements are in [`BENCHMARKS.md`](BENCHMARKS.md) — **which is currently empty, because they have not been taken.** Earlier versions of this section published the budget table as though it were results; it was not, and no comparison run has happened.

One claim in it is architectural rather than measured, and holds either way: nothing here animates because time passed. No idle loop, no polling, no ambient effect — so with no output arriving and nothing being animated, there is nothing running.

---

**Last updated:** 2026-08-10
