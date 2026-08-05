# Phase 2 — Command Boundaries (OSC 133)

**Status: done, verified.** PowerShell prompt integration confirmed working — clean prompt, no leaked escape sequences.

## Why this comes first

Every block feature depends on knowing where one command's output ends and the next begins. Nothing in Phase 3 can be built before this works.

## Original plan

- Write shell integration snippets emitting OSC 133 markers:
  - `A` — prompt start
  - `B` — command start
  - `C` — output start
  - `D;<exit code>` — command done
- One snippet each for PowerShell, bash, zsh, fish.
- Ship as app resources; inject at spawn via shell init flags rather than editing user dotfiles:
  - PowerShell — `-NoExit -Command`
  - bash — `--rcfile`
  - zsh — `ZDOTDIR`
  - fish — no clean injection path; document a manual rc line
- Parse markers out of the byte stream **before** they reach the renderer.
- Also parse **OSC 7** (cwd reporting) — this gives the file-nav panel (Phase 7) and the prompt path for free.
- Emit structured events to the frontend: `command_start{text}`, `command_output{bytes}`, `command_end{exit_code}`.

## Also needed here

Alt-screen detection belongs in this parser, even though it is consumed in Phase 3: watch for `\x1b[?1049h` (enter) and `\x1b[?1049l` (exit) and emit a mode event. Doing it in the same pass avoids a second scan over the stream.

## Verify

- Log parsed events. `git status` produces exactly **one** start/end pair, exit code 0.
- A failing command reports a non-zero exit code.
- Multiline and piped commands do not produce spurious boundaries.
- Markers never leak into visible output.

## Gotchas to watch

- Markers can be **split across read chunks**. The parser must be stateful and hold a partial-sequence buffer — an OSC sequence straddling two 8 KB reads is normal, not an edge case.
- PowerShell's prompt function must be wrapped without clobbering a user's existing custom prompt. Capture and call through to the original.
- Do not strip OSC sequences while in alt-screen mode — the raw view needs the byte stream untouched.

## Open questions

- Where do the shell snippets live on disk, and how are they referenced as Tauri resources on both platforms?
- Fish has no injection flag equivalent. Ship a documented manual step, or skip fish for v1?
