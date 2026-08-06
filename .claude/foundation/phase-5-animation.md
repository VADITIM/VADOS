# Phase 5 — GSAP Animation Layer

**Status: spec written, implementation not started.** Unblocked — Phase 4's token layer and accent system have landed, so there is a styled surface to animate against. The one Phase 4 item still open (the bundled sans font) does not gate anything here.

> **The binding rules live in [`../docs/ANIMATION.md`](../docs/ANIMATION.md).** Read that file before writing any animation code. This doc tracks *progress*; that file defines *constraints*. If the two disagree, `ANIMATION.md` wins.

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

## Every action is a handoff

The framing that drives this phase, settled and specified in [`../docs/ANIMATION.md`](../docs/ANIMATION.md): an action is not "something happens, then a thing fades in". The animation **is** the action, moving content from one region of the UI to another so the eye follows it there.

Three things to build in this order, because each is the substrate for the next:

1. **The attention tiers** — focal / peripheral / ambient, with peripheral pinned at 40% amplitude and no overshoot. This is a convention plus one helper, not a system, and everything else assumes it exists.
2. **The handoff timeline** — retract, pop, travel, overlapping by a third, with the source settling on the same timeline. Submitting a command is the reference case and the one to build first.
3. **The two bounce characters** — elastic for the element gaining focus, discrete settle for the one losing it. Getting these backwards inverts what the animation says, so it is a correctness bug and worth a check, not a taste call.

The signature reveal below is what plays *after* a handoff lands. It is not a substitute for one.

## The signature animation

Settled after discussion, full detail in `ANIMATION.md`:

- **Stagger by rendered row at 0.12s** — not per character (an 80-column line would take 4 seconds), and not per logical line (a wrapped line must produce one reveal per visual row).
- `SplitText` with `type: "lines"` handles wrap detection natively. Do not hand-roll with `Range.getClientRects()`.
- **Typewriter look = one tween per row with `ease: steps(n)`**, where `n` is that row's character count, animating a `clipPath` wipe. This reads as genuine character-by-character typing at roughly 1% of the tween count of real per-character animation.
- Applies identically to markdown and plain output — a visible difference between the two would draw attention to the boundary.

## Not every node is a row

The reveal measures rendered rows, and the expansion phases introduce content that has none: embeds, folds, and the split-view pane. Each has an explicit rule in the *Nodes that are not text* section of [`../docs/ANIMATION.md`](../docs/ANIMATION.md). Build the reveal so an embedded, row-less node can hold its slot in the stagger — retrofitting that into a row-index loop is the kind of rework this phase ordering exists to avoid.

## Non-negotiable guards

- **Flood control.** `npm install` emits thousands of lines. Queue cap ~40 rows; past that, instant reveal. At 0.12s/row a 40-row backlog is already ~5s behind reality.
- **Revert splits after reveal.** `SplitText` creates one element per row; an hours-long session would accumulate tens of thousands.
- **Kill on interrupt.** Ctrl+C, `clear`, and unmount must kill in-flight tweens.
- **Never animate inside the raw xterm view.** Only the crossfade into and out of it.

## Verify

- Run a command producing 500+ lines; profile for dropped frames.
- Animation must not queue up behind a fast-scrolling stream.
- Toggle `prefers-reduced-motion` — reveal, handoff, and glitch are skipped entirely, not merely shortened. The hover ring stays.
- Submit three commands inside a second: three blocks land clean, no interrupted gestures left mid-flight.
- Cover the focal element in a screen recording and step through it. The remaining motion must not read as the subject.
- Hover across fifty blocks with devtools open: one `mousemove` listener total, and no `will-change` left on a block the pointer has left.

## Ported from the portfolio

Both outstanding ports have landed and are specified in [`../docs/ANIMATION.md`](../docs/ANIMATION.md). Neither is implemented yet; `src/routes/+page.svelte` still carries the flat placeholder.

- **Hover ring** (`Module.vue`) — pointer-tracked radial gradient masked to the border ring via `mask-composite`, plus a separate border-colour lift. **Three changes forced by scale:** one delegated listener instead of one per block, writes only to the hovered element, and no permanent `will-change`. The portfolio has ten modules on screen; this has a scrollback.
- **Glitch** (`Classified-Section.vue`) — `rough()` jitter on transform against a `steps(3)` opacity blink, the two deliberately not tracking each other. **Retuned:** roughly two-thirds strength over half the duration, because a section entrance there is a destination and a panel here is on the way to something. The per-character flicker is one-shot, not the portfolio's infinite CSS animation — that would violate the zero-idle-CPU budget outright.
