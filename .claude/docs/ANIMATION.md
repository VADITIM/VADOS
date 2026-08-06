# VAD/OS — Animation Rules

**Read this file before writing or changing any animation code.**

Animation is the product here, not decoration. But a terminal is a tool people use hundreds of times a day, and an animation that is delightful once is an obstacle by the fiftieth time. Every rule below exists to keep motion fast, interruptible, and out of the way.

## The brief

Motion in VAD/OS is **lively, smart, fast, and a little playful — without over-committing to the joke.**

Every action consists of an animation that acts on the UI elements involved in it. Not "the action happens and then something fades in" — the action *is* the movement. Submitting a command is the input handing its contents to the output region; the animation is what makes that legible.

Two properties are what "intentional" means here, and both are testable:

1. **The motion guides the eye step by step.** After any action, a viewer should be able to say where to look next without having decided to. If two things move at once and neither is clearly the subject, the choreography is wrong — not too slow, wrong.
2. **The pacing works with the flow, not against it.** Fast enough that a fluent user never waits on it; not so fast that the handoff is a jump cut and the eye has to re-find the content. The failure modes are symmetrical and the second one is the more common mistake.

"Playful, not over-committed" is a real constraint with a real line: the motion may have character (an overshoot, a squash, a stutter), but it may never add a beat that exists only to be charming. Anticipation that sells a handoff is character. A wiggle after the handoff has landed is a delay wearing a costume.

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
6. **Everything that enters also leaves.** If a thing can be dismissed, closed, cleared, collapsed, or removed, it plays an exit — it never blinks out of existence. See below.

## Enter and leave are a pair

**Anything with an entrance animation must have an exit animation.** A panel that rises in and then vanishes on close is not half-animated, it is worse than unanimated: the entrance taught the eye that this object has a physical presence, and the disappearance then contradicts it. The eye reads a cut as *something broke*, and in a terminal that reading is expensive — this app cannot afford motion that looks like malfunction.

This applies to every dismissable thing: panels and overlays, toasts, collapsed sections, removed or cleared blocks, tooltips, the raw/rendered toggle. If there is a code path that stops showing something, that path owns an exit tween.

**The exit is not the entrance reversed.** Three differences, and they are not stylistic:

| | Enter | Leave |
|---|---|---|
| Duration | Full (0.34s for chrome) | **Shorter — roughly two-thirds.** Waiting on something you already dismissed is the most irritating latency in a UI |
| Ease | `out` — decelerates into place | **`in` — accelerates away.** It is leaving; let it go |
| Overshoot | Elastic, if it is gaining focus | **Never.** Overshoot says *arrived*. Nothing that is leaving has arrived |

**The exit tween owns the unmount.** Svelte removes an `{#if}` block the instant the flag flips, so a tween started from the click handler animates a node that is already gone — it silently does nothing, which looks exactly like having no exit animation at all. Clear the flag in `onComplete`, not in the handler, and route every close path through the one function that does it:

```ts
function closeSettings() {
  gsap.to(panel, { autoAlpha: 0, y: fall, duration: 0.2, ease: "power2.in" });
  gsap.to(backdrop, {
    autoAlpha: 0, duration: 0.2, ease: "power2.in",
    onComplete: () => (settingsOpen = false),   // the tween unmounts it, not the click
  });
}
```

Two consequences to design for rather than discover:

- **Re-entry during an exit.** A second toast arriving mid-fade must reset the node, not inherit a half-faded state. Kill the tweens and `gsap.set()` back to neutral on the way in.
- **Reduced motion still leaves.** Duration goes to 0, the code path does not disappear. See the reduced-motion table.

## Attention: one focus at a time

Every animation belongs to exactly one of three tiers, and the tier decides its amplitude. This is the mechanism behind "guides the eye" — not a style note.

| Tier | What it is | Amplitude |
|---|---|---|
| **Focal** | The one thing the user should be looking at right now | Full: overshoot, character ease, the numbers in the table below |
| **Peripheral** | Things that must move to stay coherent, but are not the subject | **40% of the focal amplitude, and no overshoot.** `power2.out` only |
| **Ambient** | Idle chrome — hover, caret, dividers | Unchanged by any action; never competes |

**There is exactly one focal element per action.** If a design wants two, one of them is peripheral and the choice of which has to be made deliberately, not left to whichever tween happens to be louder.

This is the whole rule behind the settings panel: the panel is focal and gets the character-glitch plus the typewriter; the terminal behind it is peripheral and gets a dim and a small scale, at 40% and with no overshoot. Not "subtle because subtle looks nicer" — subtle because it is not what you are meant to be reading.

## Durations and eases

| Thing | Duration | Ease |
|---|---|---|
| Line reveal (typewriter) | 0.18s | `steps(n)` — see below |
| Line stagger interval | **0.12s** | — |
| Block entrance | 0.25s | `power2.out` |
| Result heading pulse | 0.3s | `power2.out` |
| Divider draw | 0.25s | `power2.inOut` |
| Border hover | 0.25s | `power2.out` |
| Settings panel slide | 0.34s | `power3.out` |
| Raw/block mode crossfade | 0.2s | `power1.inOut` |
| **Handoff — retract (anticipation)** | 0.12s | `back.in(2.4)` |
| **Handoff — pop out** | 0.16s | `back.out(2)` |
| **Handoff — travel / arrive** | 0.2s | `power3.out` |
| **Settle (element losing focus)** | 0.16s | discrete — see *Two bounces* |
| Glitch entrance | 0.35s | `rough(...)` — see *The glitch* |
| Glitch exit | 0.2s | `steps(4)` |
| Per-character glitch, one-shot | 0.18s | `steps(1)` keyframes |

Two budgets, and they are different numbers:

- **Per tween: 0.3s in the output path, 0.4s for chrome.** Unchanged.
- **Per sequence: 0.45s from the user's input to the result being readable.** A handoff is three short beats and its beats overlap; the sum is what the user feels, and it is what gets measured. A sequence that respects every per-tween cap and totals 0.7s has failed this file.

Set the project defaults once at startup:

```ts
gsap.defaults({ duration: 0.25, ease: "power2.out" });
```

## Handoff choreography

The default shape for any action that moves content from one region of the UI to another. Submitting a command is the canonical case; opening a file into a panel, promoting a block, and re-running a command are the same shape.

**Three beats, on one timeline, overlapping.** Never three chained `delay:`s.

| Beat | What happens | Why it exists |
|---|---|---|
| **1. Retract** | The source compresses into itself, to a **fixed width**, past its resting size | Anticipation. This is what makes the pop read as *released* rather than merely appearing |
| **2. Pop** | The new element emerges **from the source's retracted size**, not from nothing | The size continuity is the whole trick — it is what says *this came from that* |
| **3. Travel** | The new element arrives in its destination and settles | Puts the eye where the content now is |

The beats overlap by roughly a third. Beat 2 starts before beat 1 has fully settled, beat 3 before beat 2 has. Sequential beats read as three separate events; overlapped, they read as one gesture. On a timeline that is a negative position offset, e.g. `"-=0.05"`, not a shortened duration.

**Meanwhile, the source returns to rest.** It does this on the same timeline, in the peripheral tier, with the discrete settle below. Both halves of the handoff are one timeline object, because both have to die together on interrupt.

### Amplitude is a width, not a scale factor

**A constant `scaleX` is wrong and must not be used.** `scaleX: 0.82` on a 600px input retracts it by 108px; on a 1600px input the same number retracts it by 288px. Same code, two different gestures — playful at one width, slapstick at the other. The bug is that a scale factor is relative to a box whose size is not a constant.

**Retract to a fixed distance, expressed in `dv` units, and derive the scale from it.** The gesture then looks identical at every window size, which is the point.

```ts
// The retract pulls the input in by a fixed visual distance, not by a
// fixed proportion of whatever width it happens to have.
const RETRACT_DVW = 6;                                    // tune this, not the scale
const retractPx = (RETRACT_DVW / 100) * window.innerWidth;
const width = input.getBoundingClientRect().width;

// Floor it: on a narrow window the retract must not eat the whole element.
const scaleX = Math.max(0.6, (width - retractPx) / width);
```

This stays inside the transform-only rule — `width` is read once to compute a target, never tweened. The beat that follows pops from this same computed `scaleX`, so the size continuity that makes the handoff legible is preserved for free.

Same reasoning applies to every travel distance and offset in this file: **express it in `dv` units, never in `%` of the moving element.** A percentage of the element is a percentage of a thing whose size you do not control.

### `dv` units are the house unit

Use `dvw` / `dvh` for animation distances and for layout, in preference to `vw` / `vh`, `%`, or `rem`, wherever a choice exists.

Inside a Tauri webview there is no collapsing browser chrome, so `dvh` and `vh` resolve identically today and this costs nothing. It is a consistency rule with an upside and no downside: one unit across the codebase, and the day any part of this renders somewhere with dynamic viewport chrome, it is already right.

`rem` still wins for type and for chrome that should track the font scale. `dv` is for distances that should track the window.

### Two bounces, and which one goes where

There are exactly two overshoot characters in this app and they are not interchangeable. The distinction carries meaning, so using the wrong one is a correctness bug, not a taste call.

| | **Elastic** | **Discrete settle** |
|---|---|---|
| Feel | Springy, alive, a little goofy | A hard clack. One overshoot, quantized, done |
| Ease | `back.out(2)` / `back.in(2.4)` | `steps(2)` across keyframes |
| Goes on | The element **gaining** focus | The element **losing** focus |
| Why | It is what you are meant to watch | It has to finish visibly, without asking for the eye |

```ts
// Discrete settle — the losing element gets back to its size and stops asking
// for attention. Quantized on purpose: a smooth spring here reads as "still
// happening", and it would compete with the thing that just took over.
gsap.to(label, {
  keyframes: [
    { scale: 1.06, duration: 0.08, ease: "steps(2)" },
    { scale: 1,    duration: 0.08, ease: "steps(2)" },
  ],
});
```

Rule of thumb, and it is the only one needed: **elastic pulls the eye, discrete releases it.** An action has one of each.

### Worked example — submitting a command

The reference implementation of everything above. Numbers are the starting point, not sacred; the structure is.

```
t=0.00  input field    retract  scaleX → computed from 6dvw   0.12s  back.in(2.4)    FOCAL
t=0.09  new block      pop      from that same computed scaleX → 1
                                                              0.16s  back.out(2)     FOCAL
t=0.09  input label    settle   scale 1.06 → 1                0.16s  discrete    PERIPHERAL
t=0.21  new block      travel   y → resting, autoAlpha → 1    0.2s   power3.out      FOCAL
t=0.41  block content  typewriter reveal begins
```

Total to first revealed row: **0.41s**, inside the 0.45s sequence budget.

Three things this example is actually specifying:

- **The pop starts from the retracted width, not from zero.** It reads the retract's computed end value, so the two stay matched at every window size. Popping from `0` loses the connection and it becomes a generic appear-animation.
- **The label settles at the same instant the block pops.** Not before, not after. Simultaneous is what makes it read as a handoff rather than as two things that happened.
- **The reveal does not start until the block has arrived.** Content animating into a container that is itself still moving is unreadable, and it is the most common way this gets built wrong.

### Guards

Choreography is per-action, and a terminal delivers actions faster than any choreography can absorb.

- **One handoff in flight at a time.** A second submit while one is running kills the first and hard-sets it to its end state. Never queue — a queued handoff is a lie about when the command ran.
- **The handoff is for user-initiated actions only.** Output arriving on its own gets the block entrance, not the three beats. A handoff per line under `npm install` is the flood-control failure with extra steps.
- **Under reduced motion the handoff does not exist.** Not shortened — the block appears in place. See below.

## The glitch

Ported from `Classified-Section.vue` in the portfolio, which is where the effect was tuned. Two independent pieces that get used separately.

### Stuttered entrance

Position drags in on a jitter ease while opacity blinks its way up on a *different*, stepped ease. The two not tracking each other is the entire effect — a smooth fade over a jittering transform reads as a rendering fault, which is the intent.

```ts
// `rough` is GSAP's own jitter ease (EasePack, bundled with core — no plugin).
// `randomize: true` means no two entrances stutter identically.
const GLITCH_IN = "rough({ template: power2.out, strength: 1.6, points: 14, taper: out, randomize: true, clamp: true })";

tl.fromTo(el, { x: -24, opacity: 0 }, { x: 0, duration: 0.35, ease: GLITCH_IN }, at);
tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: "steps(3)" }, at + 0.05);
```

**Retuned from the portfolio's values on purpose.** The portfolio runs `strength: 2.4, points: 24` over `0.7s` because a section entrance there is a destination the visitor has arrived at. A terminal panel is on the way to something, so: shorter, and roughly two-thirds the strength. Copying the portfolio's numbers directly produces motion that is correct in character and twice too long for this app.

Exit is the mirror and is shorter still — a few held frames and gone: `steps(4)`, 0.2s, no ease-out curve.

### Per-character flicker — the toggle animation

**There is no idle glitch.** Nothing in this app flickers because time passed. The portfolio's per-word effect is an infinite CSS animation, randomized delay and duration, idle 97% of its cycle — a permanently non-idle compositor, which [PERFORMANCE.md](PERFORMANCE.md) budgets at literally zero. The portfolio affords it with ten modules on screen; a terminal with a scrollback cannot.

So the effect is not deleted, it is **spent somewhere it does work**: the character flicker is the **toggle's state-change animation**, played on the toggle's own label.

This is strictly better than putting it on a panel entrance. It is the same look for a fraction of the cost, it fires only on a real user action, and it lands on the one element whose job at that moment is to say *this changed*.

- **Fires on state change only.** Toggle flipped → its label glitches once. No hover, no open, no timer, no loop.
- **Roll per character, ~10% chance, once.** With a floor of one affected character per label, or a short label silently does nothing.
- One flicker is three stepped keyframes over 0.18s — RGB split via `text-shadow` plus a 1–2px `translateX`, `ease: "steps(1)"`. Same shape as the portfolio's `@keyframes sc-word-glitch`, fired once instead of looped.
- **Tear down the wrapper spans on completion.** Same rule as reverting `SplitText`: the effect is over, the DOM cost is not.
- The label is focal for those 0.18s. Nothing else in the panel moves with it.

### Where the glitch is allowed

Two places, and no others:

| Effect | Where | Trigger |
|---|---|---|
| Stuttered entrance (`rough` + stepped opacity) | Panel and overlay entrances | Opening |
| Per-character flicker | A toggle's label | That toggle changing state |

Never on a command block, never on output, and never on a clock. Output that stutters on arrival is indistinguishable from output that is broken, and this is a terminal — the user cannot tell it was a joke and will assume the worst. An effect that fires without the user doing anything is an effect that is burning battery to be noticed.

## The hover ring

Ported from `Module.vue`. This closes the standing blocker; the section below on block chrome describes where it applies.

A radial gradient tracks the pointer inside the element and is masked to the border ring only, so the whole border lifts to the accent while the cursor keeps a bright hot spot:

```scss
.block-hue {
  position: absolute;
  inset: 0;
  padding: 1.5px;              // the ring's thickness
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(
    11rem circle at var(--mx, 50%) var(--my, 50%),
    color-mix(in srgb, var(--accent) 95%, transparent),
    color-mix(in srgb, var(--accent) 50%, transparent) 45%,
    color-mix(in srgb, var(--accent) 20%, transparent) 100%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.25s ease;
}
```

The border colour itself transitions separately, `border-color 0.25s ease` to `color-mix(in srgb, var(--accent) 30%, #262626)`. Ring and border are two layers; the ring supplies the falloff, the border supplies the base lift.

**Three changes from the portfolio version, all forced by scale.** The portfolio has ten modules on screen; VAD/OS has a scrollback.

1. **One delegated `mousemove` on the scroll container**, not a listener per block. Per-block listeners are failure mode #4 in [PERFORMANCE.md](PERFORMANCE.md), and they leak per command.
2. **Write `--mx` / `--my` on the hovered block only**, resolved from `event.target.closest()`. Never loop blocks on move.
3. **No permanent `will-change`.** `Module.vue` carries `will-change: transform, opacity` at rest, which is fine for ten elements and is a GPU layer per block here. Set it on hover-enter, drop it on leave.

This is ambient tier: it never animates in response to an action, and an action never changes it.

## Height — the one sanctioned exception

Animating `height` is banned everywhere in this file. There is exactly one exception, and it comes with the loop guard that makes it survivable, taken from `Module.vue`'s `ResizeObserver` block.

**Where:** a block whose content genuinely re-flows to a new natural height — a fold or unfold ([../foundation/phase-8-markdown-engine.md](../foundation/phase-8-markdown-engine.md)), or a rendered block whose embed finished loading. Snapping is worse than the cost here, because the snap moves everything below it under the reader.

**The guard, which is the only reason this is allowed:**

- The tween writes an inline height, which the observer then measures, which triggers another tween. **Unobserve before the tween, re-observe in `onComplete`,** and clear the inline height there.
- **A window resize is not a content change.** Kill any in-flight tween, clear the inline height, re-baseline the remembered height, and return without animating. Without this the box latches onto a mid-tween size and chases it for the rest of the resize.
- `0.45s`, `power3.out`, `overwrite: "auto"`.

Prefer `scaleY` on a wrapper with `transformOrigin: "top"` wherever the content can tolerate the squash — it is a compositor-only property and needs none of the above. Reach for real height only when the squash is visible, which for text it is.

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

### The scroll mode changes the rate, not the effect

"Move down" (see `SCROLL_MODES`) exists for the reader who does not want to watch output arrive from the top. Playing the normal 0.12s stagger in that mode contradicts the point of it — the view is at the tail specifically to be current, and a reveal paced for reading makes it permanently behind.

**In "move down", the stagger scales with the backlog rather than being a constant.** The deeper the queue of unrevealed rows, the faster each one lands, converging on instant. Concretely: the stagger is the reading-paced 0.12s when there is nothing queued, and falls toward zero as the queue fills, hitting the flood-control threshold below at the same point it would anyway.

This is a rate curve, not a second animation. The wipe, the `steps(n)` ease, and the row-level split are identical in both modes — the reveal must look the same, or the setting becomes a choice between two different products. What changes is only how long each row takes.

The same reasoning already governs the scroll itself: `tailDuration()` scales the catch-up scroll with the distance to travel, so arriving from a screen away reads as travel while the per-chunk nudges stay near-instant. The reveal should follow the scroll's example rather than invent its own pacing.

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
- **Border hover:** the pointer-tracked ring, above. Ambient tier — it never responds to an action.

The entrance above is what an **arriving** block gets. A block created by the user submitting a command gets the handoff instead, and the handoff's third beat replaces the entrance rather than playing alongside it.

## Nodes that are not text

The reveal measures rendered rows. Three node types from the expansion phases have none, and each gets an explicit rule rather than an accidental one.

- **Embeds** — mermaid diagrams, images, video ([../foundation/phase-9-rich-media.md](../foundation/phase-9-rich-media.md)). An embed is a leaf: it fades in as one unit, `autoAlpha` only, 0.2s, and it holds its slot in the row stagger so the rows after it stay in sequence. Never scale an embed in — a diagram that grows into place reflows everything under it.
- **Folds** — collapsing and expanding a section ([../foundation/phase-8-markdown-engine.md](../foundation/phase-8-markdown-engine.md)). This is the one place height genuinely changes, and the rule against animating `height` still holds: animate `scaleY` on a wrapper with `transformOrigin: "top"`, or accept an instant fold. **A fold during an in-flight reveal kills the reveal**, it does not queue behind it.
- **Split view** — showing or hiding the raw pane ([../foundation/phase-10-document-view.md](../foundation/phase-10-document-view.md)) uses the same 0.2s crossfade as the raw/block mode switch. The xterm side itself is still never animated; only the pane's opacity is.

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

The same applies to everything added by the choreography rules, and *skipped* means skipped, not scaled down:

| Effect | Reduced-motion behaviour |
|---|---|
| Handoff (three beats) | Does not run. The block appears in its final position |
| Glitch entrance, and the toggle's character flicker | Does not run. No jitter, no RGB split, no stutter |
| Discrete settle | Does not run |
| Panel slide | Becomes a 0.1s opacity fade |
| Exit animations | **Kept, at 0.1s opacity only.** The tween still owns the unmount — removing the code path leaves a dangling `{#if}` that never clears |
| Hover ring | **Kept.** It tracks the pointer the user is already moving; it is not motion imposed on them |

The glitch is the item on this list that matters most. Simulated malfunction is exactly the class of motion that reads as a real fault to someone who cannot filter it, and this is a terminal, where a real fault is plausible.

## Cleanup

Svelte components must return a cleanup function from `onMount` that kills timelines, reverts `SplitText` instances, and calls `mm.revert()`. A terminal session runs for hours; leaked tweens compound.

## Do not

- ❌ Per-character stagger.
- ❌ Animate `width`/`height`/`top`/`left`.
- ❌ Animate anything inside the raw xterm.js fallback view. That view is a real terminal — it renders at the speed the program writes, with no interception. Only the crossfade into and out of it is animated.
- ❌ Set `will-change` globally. Only on elements actually mid-animation.
- ❌ Create animations outside `onSplit()` when `autoSplit` is on.
- ❌ Ship `GSDevTools`.
- ❌ Move two elements at full amplitude in the same action. One focal, everything else at 40% with no overshoot.
- ❌ Use the elastic bounce on an element that is losing focus, or the discrete settle on one that is gaining it. The two carry meaning.
- ❌ Chain a handoff's beats with `delay:`. One timeline, overlapping positions.
- ❌ Start a content reveal before its container has finished arriving.
- ❌ Queue a handoff behind one already in flight. Kill and hard-set.
- ❌ Glitch anything but a panel entrance or a toggle's own label. Never output, never a block, never on a clock.
- ❌ Ship an infinite CSS animation, or any effect that fires without the user acting. Idle CPU is budgeted at literally zero.
- ❌ Use a constant `scale` factor for a gesture on an element whose width varies. Fixed `dv` distance, derived scale.
- ❌ Reach for `vw`/`vh`/`%` where `dvw`/`dvh` would do.
- ❌ Attach a per-block pointer listener. One delegated listener on the scroll container.
- ❌ Animate `height` without the unobserve/re-observe guard and the resize bail-out.
- ❌ Add a beat that exists only to be charming.

## Open

- **Retract distance is a guess.** `6dvw` is a starting number, not a measured one. Tune it against the real input bar — too shallow and the pop has nothing to release from, too deep and "goofy" tips into slapstick. The `0.6` scale floor for narrow windows is likewise untested.
- **Per-character glitch probability.** 10% with a floor of one character per label is the current rule. Whether the floor should instead be proportional (`max(1, round(len * 0.1))`) needs checking against real toggle labels, which are short — at eight characters, 10% and the floor are the same thing.
- **Does the handoff survive a fast typist?** The kill-and-hard-set rule is correct and untested. Someone submitting three commands in under a second should see three blocks land cleanly, not three interrupted gestures. Verify before this ships, not after.
