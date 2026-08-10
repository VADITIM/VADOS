# Accessibility

**Read this file before changing anything that communicates state.** Binding, on the same terms as [ANIMATION.md](ANIMATION.md) and [PERFORMANCE.md](PERFORMANCE.md): those files plan nothing and constrain everything, and where a phase doc disagrees with one, the binding doc wins.

Short on purpose. Every rule here has code behind it or is about to.

## Why a terminal in particular

A conventional terminal is accessible mostly by accident: it is text, in one font, in a scrollable region, and a screen reader can read it because there is nothing else there. VAD/OS adds a semantic layer on top of that — colour that means something, motion that means something, structure that means something — and **every one of those is a channel that some reader does not receive.**

So the rule the rest of this file is made of: **a semantic layer may add a channel, never replace one.** If the only way to know a command failed is that something is red, the terminal has taken information away from a reader who could previously have read the word.

## Never colour alone

Success and failure carry a glyph as well as a tint. `✓` and `✗`, or the word, or both — but never the colour by itself.

This binds:

- **The block result line.** The largest offender and the one that matters most, because it is the answer to *did that work*.
- **Status headings**, `--err` and `--ok` tone.
- **The accent swatches** in the settings panel, which are eight colours distinguished only by being different colours. They need names.

Green and red are the two colours in the app the user cannot theme ([../decisions.md](../decisions.md), *fixed colors are exempt from theming*). They are also the two most likely to be indistinguishable to a given reader. Those two facts together are why this rule is first.

## Motion

Reduced motion is already a first-class path with its own table in [ANIMATION.md](ANIMATION.md), and this file does not restate it. Two things it adds:

- **`prefers-reduced-motion` is not the reveal mode.** `instant` is a preference about the product; reduced motion is an accessibility setting the OS reports. They are handled at different points and neither substitutes for the other. ANIMATION.md says this already; it is repeated here because this is where someone will come looking.
- **Motion is never the only signal.** The reveal's tiers rank meaning, but nothing may exist *only* as a difference in when it animated. A reader with reduced motion on sees the end state, and the end state has to carry everything.

## Announcements

The result of a command is announced — `aria-live="polite"` on the block result — because a block that finishes while the reader is somewhere else in the scrollback is otherwise silent. That is a regression against a conventional terminal, where the result was simply the next line of text.

Politeness matters: `assertive` would interrupt on every command, which is worse than saying nothing.

## Focus

Focus must be visible without relying on hue. The settled decision — *selection is marked with a rail, not a border colour, and it does not animate* — already satisfies this, and it was made for a different reason (persistent state and transient animation must not share a property). Recorded here so a restyle does not remove it by accident while chasing the other rationale.

The keyboard path has to reach anything the pointer can reach. It currently does not: the cwd panel is pointer-only, tracked in [../tasks.md](../tasks.md) as an open question. That is a real gap, not a deferral.

## Type

Type stays in `rem` and honours the reader's font scaling. The `dv`-unit rule in [ANIMATION.md](ANIMATION.md) is about **animation distance and layout**, not about type, and the two are routinely confused — `rem` still wins for type is already written there, and this is the reason why.

A monospace grid that stops lining up under font scaling is a bug in the scaling path, not a reason to fix the type size.

## What this file does not ask for

Not because they do not matter — because committing to them without a plan to check them would be a claim, and a claim is what this project keeps having to walk back.

- A full screen-reader audit. Worth doing; nobody here has run one; saying it passes would be a guess.
- A high-contrast theme. It belongs to [../foundation/phase-11-theme-engine.md](../foundation/phase-11-theme-engine.md), where themes are data, and it is a good first non-default theme.
- WCAG contrast ratios on the accent palette. Eight accents times two tones is sixteen numbers nobody has measured. Measure them in Phase 11 and drop or adjust what fails.
