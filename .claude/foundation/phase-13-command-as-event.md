# Phase 13 — The Command Block as an Event

**Status: not started.** Depends on [phase-h1-raw-fidelity.md](phase-h1-raw-fidelity.md) for copy-as-raw, and on nothing else.

Small phase, high ratio. A block already knows its command, its working directory and its exit code. It does not know when it started or how long it took, which are two `Date.now()` calls and the difference between a rendered command and a recorded event.

Once a block is an event, [phase-14-finding-things.md](phase-14-finding-things.md) can search over it, and the structured context in [phase-10-document-view.md](phase-10-document-view.md) has something worth exporting.

## Scope

1. Timing.
2. The result line says what happened, in full.
3. Re-run.
4. Copy modes.
5. What "actionable errors" is deliberately not.

## Timing

`startedAt` at `openBlock`, `endedAt` at `closeBlock`. Nothing times a command today — `showHeldSince` and `handoffAt` exist but they are **animation clocks and must not be reused**, because the moment a display decision is derived from a timing field, changing either one breaks the other.

Duration is displayed against the same tolerance as everything else in the block: a command that took 40 ms does not need three decimal places, and a build that took four minutes does not need milliseconds.

## The result line

Exit code joins duration in the block result. [../tasks.md](../tasks.md) already carries *"exit code in the block heading"* as a future idea; this is where it lands.

`exitLabel()` and `EXIT_MEANINGS` in [../../src/lib/parse.js](../../src/lib/parse.js) already turn a code into words, including POSIX `128+n` signals and NTSTATUS names. **Reuse it. Do not write a second table** — that is the failure mode the curated command list was built to avoid, in a new place.

**Never colour alone.** A glyph carries the state as well as the tint — see [../docs/ACCESSIBILITY.md](../docs/ACCESSIBILITY.md). Green and red are the two colours in the app the user cannot theme, and they are also the two most likely to be indistinguishable to a given reader.

Under `cmd.exe` there is no exit code at all and there never will be ([../shells.md](../shells.md) tier 4). The result line for a shell that cannot report one says nothing rather than guessing zero.

## Re-run

Already in `tasks.md`'s future ideas. `replaceLine()` in [../../src/routes/+page.svelte](../../src/routes/+page.svelte) already knows how to rewrite the shell's line without knowing its keymap, which is the hard part and it is done.

**Re-run types the command. It does not send it.** Same rule as the suggestion strip, the cwd panel and Phase 8's code blocks: the shell owns the line, and nothing in this terminal runs anything the user did not press Enter on. A one-click re-run of `rm -rf build` is the same primitive as a one-click code block, and it is refused for the same reason.

## Copy modes

`copyText()` offers exactly two today: the whole block as text, and the whole block as markdown. That is one gesture short of the thing people actually do.

| Mode | What it copies |
|---|---|
| Copy command | The command line alone |
| Copy output | The output alone, without the prompt or the command |
| Copy block | Both, as they appear |
| Copy as markdown | The AST through `toMarkdown` — exists today |
| Copy as raw | The byte log from H1, escape sequences and all |

**Copy output is the one that pays for the feature.** `$ git status` pasted into an issue is a line someone then has to delete; `git status` pasted into a shell runs. The distinction is invisible until you have wanted it, and then it is the only one you want.

These are five entries in [phase-14-finding-things.md](phase-14-finding-things.md)'s command registry, not five new chords. Two chords stay bound; the rest are reachable from the palette.

## Actionable errors, and what that is not

A failed block offers copy-output and re-run. That is the whole feature.

Not built, deliberately: error parsing, "open at line", "search this error", "explain this". Each needs a language-aware layer that would work for the three toolchains someone tested and fail silently on the fourth, and a terminal that half-understands a compiler is worse than one that does not pretend to. The structured context in Phase 10 is the correct answer to all of them — it hands the block's command, cwd, exit code, duration and output to something that *does* understand the toolchain, without VAD/OS having to.

That is also why this is not an AI feature and must not be described as one. See [../decisions.md](../decisions.md).

## Verify

- A command that fails shows its duration and its exit code with a glyph, not a colour alone.
- A command interrupted with Ctrl+C shows a duration and the signal's meaning, not a bare number.
- Under a shell that cannot report exit codes, the result line says nothing rather than showing `exit 0`.
- Re-run puts the command on the line and stops there.
- Copy output pastes into an editor with no `$` and no command line.
- Copy as raw pastes the bytes, and matches what the raw toggle shows.
- Duration on a command that takes 40 ms is readable; so is one that takes four minutes.

## Gotchas to watch

- **A duration is not a benchmark.** It measures prompt-to-prompt, which includes the shell's own overhead and anything the user typed slowly. Do not present it as the program's runtime.
- **The result line is in the reveal's tier 0.** Adding fields to it adds labels to the highest tier, which is exactly where [../docs/ANIMATION.md](../docs/ANIMATION.md)'s density rule bites. One bar on the result, not three.
- **`startedAt` is not the time the user pressed Enter.** It is the time the block opened, which is OSC 133 `C` at the earliest. The difference is small and it is not zero.
