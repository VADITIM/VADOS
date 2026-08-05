# Phase 5 — GSAP Animation Layer

**Status: spec written, implementation not started.** Blocked on Phase 4.

> **The binding rules live in [`../../ANIMATION.md`](../../ANIMATION.md).** Read that file before writing any animation code. This doc tracks *progress*; that file defines *constraints*. If the two disagree, `ANIMATION.md` wins.

## Why it comes after styling

Animation targets styled elements. Animating unstyled boxes is throwaway work.

## Original plan

- New command block: entrance animation (fade + small y-translate).
- Output: typewriter reveal, staggered per rendered row.
- Result heading: brief pulse on completion, green or red.
- Mode switch to/from raw xterm: crossfade, not a hard swap.
- Settings panel (Phase 6): scale/fade in with backdrop blur.
- Animate `transform` and `opacity` only.
- Blocks scrolled off-screen must not animate.
- Respect `prefers-reduced-motion` via `gsap.matchMedia()`.

## The signature animation

Settled after discussion, full detail in `ANIMATION.md`:

- **Stagger by rendered row at 0.12s** — not per character (an 80-column line would take 4 seconds), and not per logical line (a wrapped line must produce one reveal per visual row).
- `SplitText` with `type: "lines"` handles wrap detection natively. Do not hand-roll with `Range.getClientRects()`.
- **Typewriter look = one tween per row with `ease: steps(n)`**, where `n` is that row's character count, animating a `clipPath` wipe. This reads as genuine character-by-character typing at roughly 1% of the tween count of real per-character animation.
- Applies identically to markdown and plain output — a visible difference between the two would draw attention to the boundary.

## Non-negotiable guards

- **Flood control.** `npm install` emits thousands of lines. Queue cap ~40 rows; past that, instant reveal. At 0.12s/row a 40-row backlog is already ~5s behind reality.
- **Revert splits after reveal.** `SplitText` creates one element per row; an hours-long session would accumulate tens of thousands.
- **Kill on interrupt.** Ctrl+C, `clear`, and unmount must kill in-flight tweens.
- **Never animate inside the raw xterm view.** Only the crossfade into and out of it.

## Verify

- Run a command producing 500+ lines; profile for dropped frames.
- Animation must not queue up behind a fast-scrolling stream.
- Toggle `prefers-reduced-motion` — reveal is skipped entirely, not merely shortened.

## Blocked on

**Border hover animation** — to be ported from the portfolio project. Source not yet provided.
