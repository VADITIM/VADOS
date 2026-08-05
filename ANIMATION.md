# VAD/OS — Animation Rules

**Read this file before writing or changing any animation code.**

Animation is the product here, not decoration. But a terminal is a tool people use hundreds of times a day, and an animation that is delightful once is an obstacle by the fiftieth time. Every rule below exists to keep motion fast, interruptible, and out of the way.

## Library

GSAP only. No CSS keyframe animations for anything stateful, no Web Animations API, no hand-rolled `requestAnimationFrame` loops.

All GSAP plugins are free since the Webflow acquisition — install everything from the public `gsap` package. Never add an `.npmrc` auth token or reference `npm.greensock.com`.

```bash
npm install gsap
```

Register plugins once, at module scope, never inside a component that re-renders:

```ts
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
gsap.registerPlugin(SplitText);
```

CSS `@keyframes` is allowed for exactly one thing: the blinking input caret. It is decorative, never interrupted, and never coordinated with anything else — GSAP would be overhead.

## Core principles

1. **Timelines over chained delays.** If two things animate in sequence, they belong on one timeline. Manual `delay:` chaining is only acceptable for a single one-shot tween.
2. **Animate `transform` and `opacity`.** Never `width`, `height`, `top`, `left`, `margin`, or `padding`. Use `x`/`y`/`scale`/`rotation` and `autoAlpha`.
3. **Store every tween and timeline you create.** Terminal output is interruptible by nature — the user can hit Ctrl+C, clear the screen, or scroll away mid-reveal. An animation you cannot `.kill()` is a bug.
4. **Short.** Nothing in the output path exceeds 0.3s. Chrome and panels may go to 0.4s. If it feels slow, it is slow.
5. **Reduced motion is a first-class path,** not an afterthought. See below.

## Durations and eases

| Thing | Duration | Ease |
|---|---|---|
| Line reveal (typewriter) | 0.18s | `steps(n)` — see below |
| Line stagger interval | **0.12s** | — |
| Block entrance | 0.25s | `power2.out` |
| Result heading pulse | 0.3s | `power2.out` |
| Divider draw | 0.25s | `power2.inOut` |
| Border hover | 0.35s | `power2.out` |
| Settings panel | 0.4s | `power3.out` |
| Raw/block mode crossfade | 0.2s | `power1.inOut` |

Set the project defaults once at startup:

```ts
gsap.defaults({ duration: 0.25, ease: "power2.out" });
```

## The typewriter reveal

This is the signature animation and the one most likely to be implemented wrong.

### The rule

**Stagger by rendered row, not by character, and not by logical line.**

A per-character stagger is forbidden. At 0.05s per character, a single 80-column line takes four seconds — output would fall minutes behind a real command. Character-level staggering also means one tween per character, which is thousands of tweens for a normal `git log`.

Instead: **one tween per rendered row, staggered 0.12s apart.** A "rendered row" is a visual line as the browser actually laid it out. This matters because a single logical line that wraps across three rows must produce **three** staggered reveals, not one. The stagger follows what the eye sees, not what the string contains.

### How

`SplitText` with `type: "lines"` splits on rendered rows, wraps included. Do not hand-roll this with `Range.getClientRects()` — the plugin already handles font loading, resize re-splits, and nested inline elements.

```ts
SplitText.create(el, {
  type: "lines",
  linesClass: "line",
  autoSplit: true,        // re-split when fonts load or width changes
  reduceWhiteSpace: false, // preserve alignment in ASCII / <pre> content
  onSplit(self) {
    // Return the animation so SplitText can revert and re-sync it on re-split.
    return gsap.from(self.lines, {
      clipPath: "inset(0 100% 0 0)",
      stagger: 0.12,
      duration: 0.18,
      ease: (i: number) => `steps(${self.lines[i].textContent?.length || 1})`,
    });
  },
});
```

Two details carry the whole effect:

- **`clipPath` wipe, not a slide.** `inset(0 100% 0 0)` → `inset(0 0 0 0)` reveals the row left-to-right while the text stays put. A `mask: "lines"` + `xPercent` slide looks wrong here — text should appear where it lands, like it was typed, not slide in from the side.
- **`steps(n)` ease, where `n` is that row's character count.** This is what makes a smooth wipe read as *typing*. One tween per row still produces a discrete character-by-character reveal. This is the trick that buys the typewriter look at a fraction of the cost.

`autoSplit: true` requires the animation to be created **inside** `onSplit()` and **returned** from it. Creating it outside means it targets stale line elements after the first resize.

### Applies to

Both markdown-rendered output and plain output. Same rule, same timing — the reveal must not visibly differ between them, or the boundary between md and non-md content becomes distracting.

The echoed command line (`> path/to/cwd` + the typed text) is one row, revealed with the same tween before the output block starts.

## Flood control — mandatory

Real commands do not emit twenty tidy lines. `npm install` emits thousands, fast.

**Rule: the animation queue never exceeds ~40 pending rows.** Past that, reveal instantly (`gsap.set`, no tween, no stagger). At 0.12s per row, forty rows is already 4.8 seconds of backlog — beyond that the terminal is lying about what has finished.

Implement as a single check before animating a batch:

```ts
// ponytail: fixed 40-row threshold; make it rate-based if it misjudges real workloads
if (pending.length > 40) {
  gsap.set(rows, { clearProps: "clipPath" });
} else {
  // staggered reveal
}
```

Additional guards:

- **Off-screen blocks do not animate.** If the user has scrolled away from the tail, reveal instantly. Never animate what nobody is looking at.
- **Revert splits once revealed.** `SplitText` produces one `<div>` per row. In a long scrollback that is tens of thousands of elements. Call `.revert()` on a block's split after its reveal completes — the animation is done, the DOM cost is not.
- **Kill on interrupt.** Ctrl+C, `clear`, and unmount must `.kill()` every in-flight tween for that block.

## Block chrome

Each command block is a `<section>` with a slightly lighter background than the terminal base and a slightly lighter border than that. Both read off the token layer (see Phase 4) — never hardcode.

- **Entrance:** `autoAlpha: 0, y: 8` → in, 0.25s. Fires once when the block is created, before the output reveal begins.
- **Divider:** drawn at the end of each block, separating it from the next. Reveal with `scaleX: 0` → `1`, `transformOrigin: "left center"`. Never animate `width`.
- **Result heading:** brief pulse on completion, tinted green or red by exit code. Success and failure use the same motion — only the color differs. Do not make failure animate more aggressively; the color already carries it.
- **Border hover:** see below.

## Reduced motion

Every animation goes through `gsap.matchMedia()`. This is not optional and not a nice-to-have — the typewriter reveal in particular is exactly the kind of motion that triggers vestibular symptoms.

```ts
const mm = gsap.matchMedia();

mm.add({
  reduceMotion: "(prefers-reduced-motion: reduce)",
}, (ctx) => {
  const { reduceMotion } = ctx.conditions as { reduceMotion: boolean };
  // reduceMotion → no reveal at all, content appears instantly
});
```

Under reduced motion the typewriter is **skipped entirely**, not merely shortened. Content appears. Call `mm.revert()` on unmount. Do not nest `gsap.context()` inside `matchMedia` — it creates one internally.

## Cleanup

Svelte components must return a cleanup function from `onMount` that kills timelines, reverts `SplitText` instances, and calls `mm.revert()`. A terminal session runs for hours; leaked tweens compound.

## Do not

- ❌ Per-character stagger.
- ❌ Animate `width`/`height`/`top`/`left`.
- ❌ Animate anything inside the raw xterm.js fallback view. That view is a real terminal — it renders at the speed the program writes, with no interception. Only the crossfade into and out of it is animated.
- ❌ Set `will-change` globally. Only on elements actually mid-animation.
- ❌ Create animations outside `onSplit()` when `autoSplit` is on.
- ❌ Ship `GSDevTools`.

## Open

**Border hover animation** — to be ported from the portfolio project. Source not yet provided; paste the implementation and this section gets filled in with the exact tween.
