# Phase H2 — Compatibility

**Status: the suite exists and has never been run (2026-08-10).** `compat/` is built — generator, fixtures, checklist. Every row in `CHECKLIST.md` is unmarked, which is the honest state: nothing here has been checked against another terminal yet. Depends on nothing.

*Compatibility first, beauty second* has been the first line of [../decisions.md](../decisions.md) since the beginning, and it has never been checked. Everything known about how VAD/OS behaves under a real TUI, a real `ssh` session, or an ANSI-heavy program is anecdote from whatever the author happened to run. Three of the five entries under *Blockers* in [../tasks.md](../tasks.md) are compatibility failures found by accident.

The bar this phase sets, and the thing every future rendering feature is measured against:

> **If VAD/OS does not understand something, it behaves like a conventional terminal rather than trying to interpret it.**

That is already the intent of "compatibility first". It has never been written as a fallback *rule*, so it has never constrained anything.

## Scope

1. A checked-in fixture set and a checklist that a person runs.
2. The four compatibility blockers, which belong here rather than scattered across phases 3 and 7.
3. The fallback rule above, recorded in [../decisions.md](../decisions.md).

## The suite is fixtures plus a checklist, not a harness

This is a deliberate ceiling. There is no Python on this machine, real TUIs cannot be driven headlessly from here, and a harness that simulates `vim` would be testing the simulation. Two kinds of thing, and they are checked differently:

- **Fixtures** are files you `cat`. Deterministic, diffable, and comparable against another terminal side by side. These are worth checking in.
- **Programs** are run by a person who looks at the screen. `htop` either looks right or it does not, and no assertion is going to tell you which.

```
compat/
  README.md      how to run this, and what "pass" means
  ansi/          SGR, truecolor, cursor moves, erase operations, scroll regions,
                 DEC private modes, bracketed paste, synchronized output
  unicode/       CJK width, combining marks, emoji and ZWJ sequences, RTL,
                 box drawing, the width edge cases that break column alignment
  osc/           hyperlinks (OSC 8), window title (OSC 0/2), clipboard (OSC 52)
  flood/         generators for plain, ANSI-heavy and Unicode-heavy output at size
  CHECKLIST.md   the program and shell matrix, run by hand
```

`CHECKLIST.md` carries the matrix: bash, zsh, fish, PowerShell, cmd, WSL, ssh, tmux, vim, nvim, less, fzf, htop, btop, git, docker, python REPL, node REPL, plus mouse input, bracketed paste and resize spam. Rows for shells that [../shells.md](../shells.md) already tiers keep their tier — this checklist tests the terminal, and a shell that emits no OSC 133 is a known tier, not a failure. **A row that is known-broken links to its blocker rather than being quietly left out**; a checklist that only lists what passes is marketing.

The `flood/` generators are shared with [phase-h3-measured-performance.md](phase-h3-measured-performance.md), which needs the same pathological inputs to measure against. Write them once.

## The blockers this phase owns

Moved out of [../tasks.md](../tasks.md), which leaves pointers.

**Inline TUIs render as a bare prompt.** Raw mode triggers on alt-screen enter, but Ink repaints inline and never sets `?1049h`, so the block renderer reads a buffer being overwritten under it. `tasks.md` files this as *"architecture work, in front of Phase 7"*. It is in front of everything: it is the single largest compatibility hole in the product, and `claude` is the program most likely to be run in a terminal built partly to render `claude`'s output. Candidate triggers — DEC private modes (`?2004h`, `?1000h`, sustained `?25l`), a repaint-rate heuristic, an opt-out list — each carry a false-positive cost on ordinary output, and a false positive here drops a normal command into the raw view.

**Whether ConPTY forwards `\x1b[?1049h` at all.** The `atPrompt`-not-`$state` half of that bug is fixed; this half is unknown. [../architecture.md](../architecture.md) already flags ConPTY as the layer that rewrites the sequence stream on its way through, and this is the standing suspect. The F3 overlay logs OSC 133 payloads, buffer changes and any `CSI ?1049h/l`; F2 captures it.

**A pager's screen renders as command output.** `git diff` pipes through `less -X`, which does not take the alt screen, so the block gets a screenshot of a pager — truncation markers and all. Same family as the first two: the question in all three is *knowing a repaint from a stream*, which `data-repaint`'s two-row threshold currently guesses at.

**Unicode width.** Not previously tracked as a blocker and it should be. Column alignment in a rendered block depends on every glyph being one cell wide, which CJK, emoji and combining marks all break. This is invisible until someone runs `ls` in a directory of Japanese filenames.

## SSH is two different things

[../tasks.md](../tasks.md) defers *"SSH / remote sessions"* as one line, which reads as if both halves are deferred. They are not the same feature:

- **Building an SSH client** — a connection manager, stored hosts, a session picker. Deferred, and stays deferred. That is someone else's product.
- **Running `ssh` in the terminal** — a compatibility requirement, and one of the highest-value rows on the checklist. `ssh <host>` then `vim` inside it exercises the alt screen, the resize path, mouse reporting and the full sequence stream through two PTYs. If that is indistinguishable from a conventional terminal, most of this phase is passing.

## Verify

- `CHECKLIST.md` is run end to end by hand, and every row is marked. A row nobody has run is not a pass.
- `cat compat/ansi/*` in VAD/OS and in Windows Terminal, side by side. Differences are either bugs or documented gaps — never surprises.
- `ssh <host>`, then `vim`, then `htop`, then resize the window while each is running.
- `tmux` with its prefix intact — Ctrl+B is currently taken by the cwd panel in block mode, and raw mode is exempt by design. Confirm that exemption actually holds inside tmux.
- Every fixture renders identically after a window resize, and after the cwd panel opens and closes.
- A program VAD/OS has never seen — pick one nobody here has run — does not produce anything worse than a conventional terminal would.

## Status / Learned

**Built 2026-08-10, run zero times.**

`compat/make.mjs` generates the fixtures rather than them being checked in — a file of raw ESC bytes is unreadable in a diff, and the flood set is 300 MB. The generator is the reviewable artefact; the fixtures are gitignored. `--flood` is opt-in.

Two decisions worth recording:

- **Fixtures are plain files, not per-shell scripts.** `cat` works in every shell on both platforms, and a `.sh` plus a `.ps1` would be the same fixture written twice — in a suite whose whole point is that it does not care which shell is hosting it.
- **Each fixture is split into numbered sections.** So a failure is reported as "`ansi/erase.txt` section 4 leaves ten lines" rather than "erase is broken", which is the difference between a bug report and a mood.

`CHECKLIST.md` carries `less` and `claude` already marked `[!]` with links to their blockers, per the rule above about not quietly omitting what is known broken.

**The Unicode-width blocker gave up half of itself without the suite being run (2026-08-12).** Writing the `unicode/width.txt` row's expectation down was enough to find that `rowRuns` indexed colour runs by cell and not by character, so on any row with a CJK glyph, an emoji or a combining mark the colour boundary sat off the text it was colouring. Fixed, with a self-check in `ansi.check.mjs` built on a fake buffer line — the run walk is now in `ansi.js` rather than the page, because a check that needs a live terminal is a check nobody runs. What remains of the blocker is the part only the screen can answer: whether a rendered block's *columns* still line up when a glyph takes two cells.

The order is worth noting for the rest of this phase: the fixture did not have to run to be useful. Deciding what a row must show is where a compatibility suite pays first, and the three remaining blockers are all heuristics that should be left alone until the suite has actually produced evidence — per the last gotcha below.

## Gotchas to watch

- **A fixture is only evidence if it fails when the code breaks.** A file of escape sequences nobody compares against anything is decoration. The comparison against another terminal is the test; the file is the input.
- **Passing on Linux proves nothing about Windows**, and the reverse. ConPTY is the leak. Record which platform a row was checked on.
- **The checklist will rot.** It rots slower than the alternative, which is no checklist.
- **Resist making the trigger cleverer than the evidence.** Every candidate fix for the inline-TUI blocker is a heuristic, and each one costs ordinary output a false positive. Prefer the one that fails toward *conventional terminal*, per the rule at the top of this file.
