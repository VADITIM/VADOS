# Compatibility suite

The check that VAD/OS is still a terminal. Phase [H2](../.claude/foundation/phase-h2-compatibility.md).

*Compatibility first, beauty second* has been the first rule of this project since the beginning and had never been checked against anything. This directory is what checks it. The bar it holds VAD/OS to:

> If VAD/OS does not understand something, it behaves like a conventional terminal rather than trying to interpret it.

## What is here, and why it is two things

**Fixtures** — files of real control bytes. Deterministic, and comparable side by side against another terminal. `cat` them.

**A checklist** — [CHECKLIST.md](CHECKLIST.md), the programs and shells a person runs and looks at. `htop` either looks right or it does not, and no assertion is going to tell you which. There is no harness here on purpose: real TUIs cannot be driven headlessly from this machine, and a harness that simulated `vim` would be testing the simulation.

## Generating

Fixtures are generated rather than checked in — a file full of raw ESC is unreadable in a diff, and the flood set is far too large for a repository. [`make.mjs`](make.mjs) is the thing to review.

```bash
node compat/make.mjs
```

The flood files are ~300 MB and are skipped unless asked for:

```bash
node compat/make.mjs --flood
```

## Running the fixtures

```bash
cat compat/ansi/sgr.txt
```

Then the same command in **Windows Terminal** or **Alacritty**, on the same machine, with the two windows side by side. That comparison is the test — the file is only the input. A fixture nobody compares against anything is decoration.

Each file is split into numbered sections, so a failure is reported as *"`ansi/erase.txt` section 4 leaves ten lines"* rather than as *"erase is broken"*.

## What "pass" means

**Identical to the comparison terminal**, or a difference that is written down in [CHECKLIST.md](CHECKLIST.md) with a reason. Those are the only two outcomes. A difference nobody has decided about is a bug that has not been filed yet.

Two things that are *not* failures:

- A fixture that renders identically in both and looks wrong in both. That is the fixture being wrong, or the terminal spec being stranger than expected. Fix the fixture.
- A sequence VAD/OS ignores that the comparison terminal also ignores.

And one thing that always is: **any escape sequence that reaches the screen as visible text.** That is the failure mode this whole directory exists to catch.

## Recording results

In [CHECKLIST.md](CHECKLIST.md), against the row, with the platform. ConPTY rewrites parts of the sequence stream on its way through, so **passing on Linux proves nothing about Windows** and the reverse. Note which one you ran.
