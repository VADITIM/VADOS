# Phase H3 — Measured Performance

**Status: the two implementation gaps that did not need a measurement first are closed (2026-08-10). Nothing has been measured.** `BENCHMARKS.md` exists and every row in it says *not measured*, which is the point of it. The `flood/` generators are in [phase-h2-compatibility.md](phase-h2-compatibility.md)'s `compat/make.mjs`.

[../docs/PERFORMANCE.md](../docs/PERFORMANCE.md) says it itself, under *Open*:

> Baseline numbers not yet taken. The budget table is target-derived, not measured.

Meanwhile the root README publishes those targets in a section headed *Performance*, and `0.0 % idle CPU` is the sharpest example — a number that reads as a measurement, is not one, and cannot be reproduced by a reader without being told what was sampled over what interval.

The rule that comes out of this phase: **a target with no measurement behind it is listed as "not measured", never as a number.**

## Scope

1. `BENCHMARKS.md` — measured numbers only, and the protocol that produced them.
2. The README's performance section stops asserting figures.
3. The three implementation gaps between PERFORMANCE.md and the code.
4. The pathological cases.

## BENCHMARKS.md

New file at the repo root, next to `CHANGELOG.md`. The division of labour: **PERFORMANCE.md keeps the budgets, BENCHMARKS.md records reality.** A budget is a decision, a benchmark is an observation, and mixing them is how the README ended up publishing intentions.

Every row carries the date, the machine, the build (**release only** — a debug build measures nothing), and where a comparison exists, the same run against Windows Terminal and Alacritty on that same machine. PERFORMANCE.md's measuring protocol already specifies all of this; this phase executes it rather than inventing it.

First fill covers the budget table as it stands: keystroke-to-glyph p99, sustained throughput, idle CPU focused with no output, idle CPU with an animation in flight, RSS fresh and after 100k lines and after a long session, frame time during a reveal, and cold start to interactive prompt.

**The third RSS number is the one that matters** — PERFORMANCE.md says so, and it is the one nobody ever takes.

## The README correction

The *Performance* section stops publishing the budget table and links to `BENCHMARKS.md`.

`0.0 % idle CPU` splits into the two things it currently conflates:

- **A design statement**, which is true and checkable: zero timers, zero `requestAnimationFrame`, zero polling when nothing is happening. That is an architectural property, it is enforced by ANIMATION.md's ban on idle animation, and it can be asserted by reading the code.
- **A measurement**, which is whatever the number turns out to be over 60 seconds on this machine.

The first is the claim worth making. The second is the honest version of the number.

## The three gaps between the budget and the code

**PTY coalescing and backpressure.** PERFORMANCE.md mandates coalescing at 4 KB or 8 ms (`FLUSH_BYTES` / `FLUSH_INTERVAL`) and backpressure over unbounded queues. The reader thread in [../../src-tauri/src/pty.rs](../../src-tauri/src/pty.rs) sends one channel message per read with neither. Never flush mid-escape-sequence — a sequence split across two sends is a sequence xterm may act on twice. Note that the coalescing that *does* exist today is `showSoon`'s quiet window in the frontend, and that is a **parse gate, not a transport one**; the two solve different problems and having one is not having the other.

**The scrollback cap.** PERFORMANCE.md mandates a 10,000-line default and calls unlimited scrollback *"a memory leak with a nice name"*. xterm is configured for 20,000 rows, and the block DOM is unbounded — every block ever run is still mounted. Per that document's own instruction, **measure `content-visibility` alone at 100k lines before writing a windowing layer.** The measurement decides whether a windowing layer is written at all.

**`syncStuck` is linear in mounted blocks, per frame.** It already carries a `ponytail:` comment naming virtualization as its ceiling, and [../tasks.md](../tasks.md) tracks it as an open question. It stops being theoretical the moment the cap above is real, because the fix is the same fix.

## Pathological cases

Not `echo hello`. From `compat/flood/`:

- `yes`, unbounded, until it is interrupted.
- A 100 MB log through `cat`.
- The same volume ANSI-heavy, and again Unicode-heavy.
- Output arriving **while the reader is scrolled up**, which must not yank the view.
- Output arriving **while the window is being resized**, which triggers the resize observer's re-snapshot and re-render on every frame.
- Output arriving **while a reveal is mid-flight**, which is where flood control either holds or does not.
- All of the above with the cwd panel open, since its band tween mutes the resize observer for its duration.

Each one gets a number in `BENCHMARKS.md`, not a verdict.

## Verify

- `BENCHMARKS.md` exists, is filled from a release build, and every row names its date and machine.
- Throughput on `compat/flood/*` is measured against Windows Terminal and Alacritty on the same hardware, in the same session.
- Keystroke-to-glyph p99 is measured **under that load**, not at rest. At rest it is not a number worth having.
- Idle CPU over 60 seconds, focused, no output, window visible.
- RSS fresh, after 100k lines, and after a long session with H1's byte logs retained.
- `yes` can be interrupted with one Ctrl+C, and the UI is responsive throughout.
- **No optimisation lands without a before and after number in that file.** That is the point of the file.

## Status / Learned

**Coalescing landed without a timer, and that turned out to be the whole design.**

The obvious implementation of "4 KB or 8 ms" is a flush thread on a timer. It is also a thread waking 125 times a second on a session where nothing is happening, which spends the one budget in this file that is written as *literally zero*. The two rules were in direct conflict and the idle one wins.

What replaced it: a 64 KB read buffer, and **a read that comes back full means the pipe still has more queued**, so the loop keeps reading instead of sending. A read that does not fill the buffer means the stream has gone quiet, and that is the flush signal — arriving from the stream itself rather than from a clock. Latency is unchanged at idle, the message count drops by roughly eight under flood, and nothing ticks. `FLUSH_MAX` (256 KB) is what stops a sustained flood accumulating forever.

**Coalescing creates a boundary that did not exist before**, and that boundary is ours rather than the stream's. `safe_cut` / `terminated` hold back a trailing unterminated escape sequence, with `MAX_HOLD` as the escape hatch so an overlong OSC splits rather than stalling the stream. Seven tests in `pty.rs`; `cargo test`.

**Backpressure is not implemented and the reason is worth keeping.** Tauri channels do not acknowledge, so there is nothing to apply back-pressure *from*. It also may not be needed: the loop only reads as fast as it sends, and a reader that has stopped reading is what makes the OS pipe block the shell — the real backpressure was always the pipe. Carries a `ponytail:` naming the measurement that would reopen it.

**xterm's scrollback went from 20,000 rows to the 10,000 this file mandates.** The block DOM is still unbounded, deliberately: this document says to measure `content-visibility` alone at 100k lines before writing a windowing layer, and that measurement has not happened. Adding paint containment blind would have been the same mistake as the timer — following one rule in this file by breaking another.

## Gotchas to watch

- **Measuring the measurement.** A debug build, a devtools window, or the F3 overlay open all change the answer. Release, no overlay, no inspector.
- **The comparison terminals are not doing the same work**, and that is fine — the point is whether VAD/OS is *noticeably* heavier to a person, not whether it wins a benchmark it designed.
- **A budget missed by a little is information, not a failure.** Record it. A benchmark file that only contains passes is the README problem again.
- **Do not tune against a number taken once.** Idle CPU in particular varies with what else the machine is doing.
