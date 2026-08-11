# Compatibility checklist

Run by hand, against Windows Terminal or Alacritty side by side. See [README.md](README.md) for what counts as a pass.

**Mark the platform.** `W` for Windows, `L` for Linux. A row with no platform has not been run — ConPTY rewrites the sequence stream, so the two are separate results and neither predicts the other.

**A row that is known broken links to its blocker rather than being left out.** A checklist that only lists what passes is marketing.

Legend: `[ ]` not run · `[x]` matches the comparison terminal · `[~]` differs, and the difference is written down here · `[!]` broken.

---

## Fixtures

`node compat/make.mjs` first.

| | Fixture | What it proves | Result |
|---|---|---|---|
| | `ansi/sgr.txt` | Colours, attributes, independent resets, unknown parameters skipped | `[ ]` |
| | `ansi/truecolor.txt` | 256-colour cube, greyscale, 24-bit, colon-form | `[ ]` |
| | `ansi/cursor.txt` | Relative and absolute moves, save/restore, clamping | `[ ]` |
| | `ansi/erase.txt` | EL 0/1/2, a self-erasing spinner, DCH/ICH | `[ ]` |
| | `ansi/scroll.txt` | Scroll regions, SU/SD, reverse index | `[ ]` |
| | `ansi/modes.txt` | DEC private modes are consumed, not printed; unterminated sequence recovers | `[ ]` |
| | `ansi/paste.txt` | Bracketed-paste markers in *output* are not treated as a paste | `[ ]` |
| | `unicode/width.txt` | CJK and emoji double width, combining marks zero, box drawing, RTL | `[ ]` |
| | `osc/hyperlink.txt` | OSC 8, both terminators, and the `id=` parameter | `[ ]` |
| | `osc/title.txt` | OSC 0/2 print nothing; OSC 52 does not silently write the clipboard | `[ ]` |

**`unicode/width.txt` is the one most likely to fail in block mode**, and it is tracked as a blocker — a rendered block's columns line up only while every glyph is one cell wide. See [tasks.md](../.claude/tasks.md).

---

## Shells

Tiers are [shells.md](../.claude/shells.md)'s, by OSC 133 marker fidelity. **A shell in a lower tier is not a failure** — this checklist tests the terminal. What is being checked here is that the shell is *usable*: it echoes, it wraps at the right column, it resizes, and its line editor works.

| | Shell | Tier | Result |
|---|---|---|---|
| | PowerShell 5.1 | 2 — shipped | `[ ]` |
| | PowerShell 7 | 2 | `[ ]` |
| | bash | 2 | `[ ]` |
| | zsh | 2 | `[ ]` |
| | fish | 2 — `--init-command`, not yet wired in `pty.rs` | `[ ]` |
| | Nushell | 1 — native markers | `[ ]` |
| | WSL (bash) | 2 | `[ ]` |
| | Git Bash | 2 | `[ ]` |
| | `cmd.exe` | 4 — no exit codes, structurally | `[ ]` |

---

## Programs

The ones that decide whether this is a real terminal.

| | Program | What it exercises | Result |
|---|---|---|---|
| | `vim` | Alt screen, cursor control, resize | `[ ]` |
| | `nvim` | The same, plus truecolor | `[ ]` |
| | `less` | Alt screen off (`-X`), paging, `q` | `[!]` — [renders as a screenshot of the pager](../.claude/tasks.md) |
| | `htop` | Continuous repaint, colour, mouse | `[ ]` |
| | `btop` | Truecolor, braille glyphs, heavy repaint | `[ ]` |
| | `fzf` | Inline (non-alt-screen) full-screen UI, live filtering | `[ ]` |
| | `claude` | Ink, repaints inline, never sets `?1049h` | `[!]` — [renders as a bare prompt](../.claude/tasks.md) |
| | `tmux` | Nested terminal, its own resize, Ctrl+B prefix | `[ ]` |
| | `ssh <host>` | The whole stream through two PTYs | `[ ]` |
| | `ssh <host>` then `vim` | **The highest-value row here.** If this is indistinguishable from a conventional terminal, most of this phase passes | `[ ]` |
| | `git log` / `git diff` | Pager, colour, wide output | `[ ]` |
| | `git status` | Colour that VAD/OS currently drops in block mode | `[ ]` |
| | `docker ps` / `docker logs -f` | Wide columns, and a follow that never ends | `[ ]` |
| | `python` REPL | Line editing, Ctrl+D, tracebacks | `[ ]` |
| | `node` REPL | The same, plus its own completion | `[ ]` |

`tmux` note: **Ctrl+B is the cwd panel in block mode**, and raw mode is exempt by design so the prefix survives inside tmux. That exemption is the thing to actually confirm rather than assume.

---

## Interaction

| | Case | Result |
|---|---|---|
| | Mouse reporting — click and drag inside `htop`, `vim`, `tmux` | `[ ]` |
| | Bracketed paste — paste multi-line text at a prompt; it must not run line by line | `[ ]` |
| | Paste a very large block of text | `[ ]` |
| | Resize the window while a TUI is running | `[ ]` |
| | Resize repeatedly and fast, while output is arriving | `[ ]` |
| | Resize with the cwd panel open — the shell must wrap where the text ends | `[ ]` |
| | Ctrl+C stops a running program on the first press | `[ ]` |
| | Ctrl+D at an empty prompt exits the shell | `[ ]` |
| | A window resize while a reveal is mid-flight | `[ ]` |

---

## Flood

`node compat/make.mjs --flood` first. Numbers go in [BENCHMARKS.md](../BENCHMARKS.md); what is checked *here* is only that nothing breaks or becomes unusable.

| | Case | Result |
|---|---|---|
| | `cat compat/flood/plain.txt` | `[ ]` |
| | `cat compat/flood/ansi.txt` | `[ ]` |
| | `cat compat/flood/unicode.txt` | `[ ]` |
| | `yes`, then one Ctrl+C | `[ ]` |
| | Any of the above while scrolled up — the view must not be yanked down | `[ ]` |
| | Any of the above while resizing | `[ ]` |
| | Any of the above with the cwd panel open | `[ ]` |

---

## Differences that are recorded and accepted

Nothing yet. Every `[~]` above gets a line here saying what differs and why that is the right answer.
