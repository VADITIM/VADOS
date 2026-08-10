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
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { RoughEase } from "gsap/EasePack";
gsap.registerPlugin(ScrollToPlugin, RoughEase);
```

`rough` is an ease, not a tween property, so an unregistered `RoughEase` does not throw — GSAP falls back to the template ease and the jitter silently disappears. Register it like any plugin.

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

**The panel rises in and leaves upward**, not back down the way it came. It is centred in the window, so it has no edge to belong to and no drawer to retract into — the pair reads as one object passing through, which is the honest description of a panel that is neither docked nor persistent. The travel is 6dvh: at the 2dvh it used to be, a centred panel just appears with a twitch.

The exit also owns the refocus. The panel took focus from the terminal when it opened, and the terminal is the input engine — a close path that does not hand focus back leaves the user typing into nothing.

## Attention: one focus at a time

Every animation belongs to exactly one of three tiers, and the tier decides its amplitude. This is the mechanism behind "guides the eye" — not a style note.

| Tier | What it is | Amplitude |
|---|---|---|
| **Focal** | The one thing the user should be looking at right now | Full: overshoot, character ease, the numbers in the table below |
| **Peripheral** | Things that must move to stay coherent, but are not the subject | **40% of the focal amplitude, and no overshoot.** `power2.out` only |
| **Ambient** | Idle chrome — hover, caret, dividers | Unchanged by any action; never competes |

**There is exactly one focal element per action.** If a design wants two, one of them is peripheral and the choice of which has to be made deliberately, not left to whichever tween happens to be louder.

This is the whole rule behind the settings panel: the panel is focal and gets the character-glitch and the stuttered entrance; the terminal behind it is peripheral and gets a dim and a small scale, at 40% and with no overshoot. Not "subtle because subtle looks nicer" — subtle because it is not what you are meant to be reading.

## Durations and eases

| Thing | Duration | Ease |
|---|---|---|
| Label reveal — bar sweep | 0.28s | `power3.inOut` |
| Label reveal — bar retreat | 0.32s | `power3.inOut` |
| Label reveal — beat between tiers | 0.2s | — |
| Character wave — one character | 0.3s | `power2.out` |
| Character wave — stagger | 0.012s per unit, 0.6s total cap | — |
| Block entrance | 0.25s | `power2.out` |
| Result line | — | the label reveal, tier 0 |
| Divider draw | 0.25s | `power2.inOut` |
| Border hover | 0.25s | `power2.out` |
| **Copy — lean toward the cursor** | 0.12s | `power2.in` |
| **Copy — return** | 0.16s | `power2.out` + discrete settle |
| Settings panel rise (from 6dvh below) | 0.34s | `power3.out` |
| Settings panel leave (to 6dvh above) | 0.2s | `power2.in` |
| Raw/block mode crossfade | 0.2s | `power1.inOut` |
| **Handoff — mark run (anticipation)** | 0.16s | `power2.inOut` |
| **Handoff — border draw** | 0.34s | `power2.inOut` |
| **Handoff — box bounce (0.4dvw wider)** | 0.18s | `back.out(2)` |
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
| **1. Run** | The source's leading mark travels to the **end of the content being handed over** | Anticipation, and it states what is being handed over: the throw is as long as the command is |
| **2. Draw** | The new container's border draws outward from the **top centre**, in both directions, **glowing in the accent with the brightest point at each growing end** | The continuity is positional — the border starts from the point the mark just left, so the container reads as spawned by the ghost line rather than as a box that appeared near it. The bright head is what says the line is *being drawn* rather than being uncovered |
| **3. Bounce** | The box closes, its content appears, the **box springs a little wider and settles**, and the reveal starts — all at the same instant | Says *arrived*. The content is what the box was drawn for; staging it after the bounce makes the container arrive twice |

The beats overlap by roughly a third. Beat 2 starts before beat 1 has fully settled, beat 3 before beat 2 has. Sequential beats read as three separate events; overlapped, they read as one gesture. On a timeline that is a negative position offset, e.g. `"-=0.05"`, not a shortened duration.

**Meanwhile, the source returns to rest.** It does this on the same timeline, in the peripheral tier, with the discrete settle below. Both halves of the handoff are one timeline object, because both have to die together on interrupt.

### Distances are measured, never assumed

**Beat 1's throw is the width of the text being handed over**, read off the DOM at submit time — not a constant, and not a proportion of the bar. A one-word command gets a short run and a long pipeline a long one, which is the gesture reporting what was actually submitted. A fixed distance would say the same thing about every command, which is to say nothing.

```ts
const dx = Math.max(0, text.getBoundingClientRect().right - mark.getBoundingClientRect().right);
```

Where a distance is *not* derived from content — a travel offset, an entrance's rise — **express it in `dv` units, never in `%` of the moving element or as a constant `scale`.** A percentage of the element is a percentage of a thing whose size you do not control, and `scaleX: 0.82` is a small pull on a narrow window and a slapstick squash on a wide one.

### The border draws with a clip, on its own layer

The frame is a separate absolutely positioned element created by the entrance and removed on completion, never the block's own `border` and never part of the template:

- **A clip on the block would take its content with it.** The frame is the only thing being drawn, so the frame is the only thing clipped.
- **Svelte re-renders the block's subtree on every chunk** — the same hazard that keeps the reveal bars in their own static host.
- The draw is `clip-path: inset(0 50% 0 50%)` → `inset(0)`. Opening from the vertical centre line grows the top edge outward from the point the mark stopped at and lands the sides last, which is the order a box gets drawn in.
- **`power2.inOut`, never `power2.out`** — the same trap the label bar's sweep documents, and it is the one that gets "fixed" back by matching the eases around it. An `out` ease is most of the way across before the eye has found it, so the border reads as having already been there rather than as being drawn. This is a longer beat than the rest of the sequence (0.34s, at the chrome cap) for the same reason: at 0.18s a full-width draw is over before it registers as motion.
- **The block's own border and background are transparent for the duration** and are restored at the pop. A border already on screen makes the draw a decoration over it; a filled box gives the draw nothing to describe.
- The frame's corner radius is **one pixel larger** than the block's — its box is 1px outside it on every side, and a concentric corner is not the same radius.

**One number drives the whole thing.** `--gap` is the clip's inset from each side *and* the x of each glowing head, written from a proxy in `onUpdate` rather than tweened as a `clip-path` string — one value cannot disagree with itself. Two values agreeing by tuning is a bright head that drifts off the edge it is meant to be the end of; one value cannot drift.

**The glow is a masked gradient, not a border colour.** A `border` cannot carry a gradient that tracks a moving point, so the frame is the `.block-hue` trick again: a background clipped to a 1px ring by two composited masks. The line already drawn is the accent at 40%; each head is a tall narrow radial at the clip edge, at full accent, over a small `drop-shadow`. Tall, because past the corner the growing end is running down the side and a round glow would come off it.

### The container arrives before its content, and only once

**Everything inside the block is hidden for the duration of the draw** — not just its text. The reveal hides text only, so without this a code block's box, its background and its border are on screen before the border that is supposed to be enclosing them, which is the container arriving second.

It is a class on the block, not a tween on its children: **output keeps arriving during the draw**, and a child that mounts mid-gesture has to be covered by the same rule. `visibility`, so the box still takes its real size and the frame is drawn around the shape the block actually ends up being.

### The bounce is on the frame, and that is what keeps the text still

**The box springs wider on arrival; nothing inside it moves.** The three obvious ways to widen a box all fail that second half, and the failure is the point of the rule:

- `scale` on the block takes its content with it — that is a zoom, not a box growing.
- Animating the block's `padding` or `margin` pushes the text sideways, and it is a layout property being tweened per frame.
- Animating `width` is banned outright and would reflow the column.

So the bounce runs on the **frame**, which is an empty overlay: a `scaleX` on it widens the box the user sees and there is nothing inside it to carry. **The block's own border therefore stays transparent until the bounce has landed** — for those frames the frame *is* the border, and handing the edge back mid-stretch would snap it to its resting width.

Amplitude is a fixed `0.4dvw` per side with the scale derived from the block's measured width, under the same rule as every other gesture here: a constant factor is a nudge on a narrow window and a lurch on a wide one.

The class comes off at the bounce, in the same instant the reveal is released — the content appearing, the overshoot, and the reveal are one beat. Releasing the reveal on the timeline's completion instead puts the reveal behind the pop, and the block reads as arriving twice.

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
t=0.00  ghost "> " mark  run    x → end of the command text   0.26s  power2.inOut    FOCAL
t=0.00  path, sep, text  wiped  clipped from the left, driven by the mark's x   FOCAL
t=0.00  caret            rides  x = the mark's own x, out and back      PERIPHERAL
t=0.30  path, sep        written back, by the same clip retreating      PERIPHERAL
t=0.10  block frame      draw   --gap 50% → 0, heads glowing  0.34s  power2.inOut    FOCAL
t=0.30  ghost "> " mark  return x → 0                         0.12s  power2.in   PERIPHERAL
t=0.42  ghost "> " mark  settle                               0.16s  discrete    PERIPHERAL
t=0.44  block frame      bounce scaleX 1 → 0.4dvw wider → 1   0.18s  back.out(2)     FOCAL
t=0.44  block content    unhidden, and the reveal begins
t=0.62  block frame      fade   autoAlpha → 0                 0.12s  power2.in   PERIPHERAL
```

Total to first revealed row: **0.44s**, inside the 0.45s sequence budget.

Three things this example is actually specifying:

- **The mark takes the line with it, and puts the prompt back.** Everything the mark passes over — the path, the separator, the command — is clipped away from the left, and the clip is driven off the mark's *own* x each frame rather than off a matching duration and ease, so characters vanish under the glyph and not merely near it. Without this the beat was a mark sliding across text that had already been cleared, and it read as too fast to follow because there was nothing to follow.

  **The two halves are not symmetrical, and that is the point.** The command does not come back — it is in the block now, and it is removed at the top of the return. The path and the separator do: the same clip retreats with the mark and writes the prompt back, so the bar is ready by the time it lands. What went with the mark went somewhere; what is still the prompt is still the prompt.

  The caret rides the mark by the mark's own displacement, out and back. It is what says where typing goes, and typing goes where the mark is. Clearing the input fires the caret's own catch-up bounce in the same frame, so for the length of the gesture that tween is taken off it rather than fought.

  The path and separator are clipped **live** — a clip is a style on an element, not a rewrite of its contents, so a re-render drops it harmlessly, which is the same allowance the reveal's bars have. Only the command is a frozen copy, because only the command is cleared out from under the gesture. Every path out removes the copy *and* undoes the clips: a gesture killed before its timeline exists would otherwise leave the prompt clipped to nothing.
- **The draw starts before the mark has landed**, and the mark returns *under* the draw rather than after it. Sequential beats read as three separate events.
- **The mark returns to rest while the block is the subject.** It is the source being left behind, so it is peripheral and it ends on the discrete settle — never the elastic, which belongs to the box that just arrived.
- **The reveal starts at the pop, not after it.** The content is what the box was drawn for. What must not happen is content arriving *during* the draw, which is why everything inside the block is hidden until this instant.

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
- One flicker is three stepped keyframes over 0.18s — a 1–2px `translateX` on `ease: "steps(1)"`, against an RGB split via `text-shadow`. Same shape as the portfolio's `@keyframes sc-word-glitch`, fired once instead of looped. **The split is a class held for the duration, not a tweened value:** `text-shadow` interpolates as a string, and a stepped ease over a value GSAP cannot interpolate is a snap dressed up as an animation. The motion is the stepped `x`; the split is what it steps through.
- **Only ever on static text.** The effect rebuilds the element's children, which detaches any text node a framework is holding a reference to. Toggle labels come from frozen tables and are written once; command output is rewritten on every chunk. This is the same hazard that rules `SplitText` out of the reveal, and the reason the reveal touches no DOM at all.
- **Tear down the wrapper spans on completion.** The effect is over; the DOM cost is not.
- The label is focal for those 0.18s. Nothing else in the panel moves with it.

### Where the glitch is allowed

Two places, and no others:

| Effect | Where | Trigger |
|---|---|---|
| Stuttered entrance (`rough` + stepped opacity) | Panel and overlay entrances | Opening |
| Per-character flicker | A toggle's label | That toggle changing state |

Never on a command block, never on output, and never on a clock. Output that stutters on arrival is indistinguishable from output that is broken, and this is a terminal — the user cannot tell it was a joke and will assume the worst. An effect that fires without the user doing anything is an effect that is burning battery to be noticed.

## Copy — the block leans to the cursor

Right-clicking a block copies its output. The block leans toward the pointer, shrinks slightly, and settles back: the same feel as the portfolio's magnetic buttons, and it works for the same reason — the element the user acted on acknowledges the pointer, instead of a notification appearing somewhere else to report that something happened. The toast stays, but it is no longer the only thing saying the click landed.

```
lean    x/y toward pointer, scale → 0.97   0.12s  power2.in     FOCAL
return  x/y → 0                            0.16s  power2.out
settle  scale 0.988 → 1                    0.16s  discrete, at the same instant
```

Four things this is specifying, and three of them are rules from elsewhere in this file being applied rather than new ones:

- **The amplitude is a `dv` distance, not a fraction of the block.** A block is anything from two rows to a screenful, so a percentage of the element is a percentage of a thing this code does not control — the same bug the handoff's retract documents. The pointer supplies the *direction* only; a click at the block's edge and one at its centre travel equally far.
- **The lean eases `in`, the return eases `out`.** The first leg is the content being taken and accelerates away from rest; the second is the block arriving back.
- **The return is the discrete settle, never elastic.** The block has handed its text over — it is the element *losing* focus, and the spring belongs to the one gaining it. A smooth bounce here reads as "still happening" after the copy is already done.
- **Clear the transform on completion.** It is spent, and leaving it stales the rect the hover ring is positioned against and keeps a compositor layer alive on a block that is no longer doing anything.

Total 0.28s, inside the output-path budget. Under reduced motion the gesture does not exist — the copy still happens and the toast still fires.

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

## Width — the other sanctioned exception

Animating `width`, `padding` and insets is banned everywhere in this file. There is one exception, and like the height one it is allowed only with the guard that makes it survivable.

**Where:** a surface that takes layout width away from the terminal rather than covering it — the cwd panel today, and a split view later. The terminal's own frame never moves when one of these opens, so there is no transform that could carry the output and input containers to their new width. The width *is* what changed. A tween that reaches for a layout property when a transform was available is the thing the ban is for; this is not that case.

**The two rules, and the second is the one that gets skipped:**

- **One tween, one value, both edges.** The panel's leading edge and the terminal's trailing edge are the same line, and they read as one object pushing another only while they stay welded. Two tweens with matching duration and ease agree until someone retunes one of them. Write a single multiplier and derive both sides from it — the same rule as the handoff's `--gap`.
- **Mute the resize observer for the length of the tween and run it once when it lands.** A layout property moving per frame is precisely what a `ResizeObserver` fires on, and VAD/OS's callback re-reads the open block out of xterm's buffer, re-renders it, walks every tracked reveal and round-trips to Rust for `pty_resize`. Thirty of those, for a width that is still moving, is the entire reason this ban exists in general. The final frame is the only one whose answer is worth computing.

Durations are the chrome pair: 0.34s `power3.out` opening, 0.2s `power2.in` closing. Under reduced motion the band snaps and the panel gets its 0.1s opacity fade.

## Height — the one sanctioned exception

Animating `height` is banned everywhere in this file. There is exactly one exception, and it comes with the loop guard that makes it survivable, taken from `Module.vue`'s `ResizeObserver` block.

**Where:** a block whose content genuinely re-flows to a new natural height — a fold or unfold ([../foundation/phase-8-document-engine.md](../foundation/phase-8-document-engine.md)), a rendered block whose embed finished loading, or **a block's first content landing**, which is the same event: the box holds a head and a loading bar while the command works, then a screenful arrives in one frame. Snapping is worse than the cost here, because the snap moves everything below it under the reader.

The first-landing case animates **once**. After it, the command is streaming, and a tween per chunk fights both the next chunk and the scroll sync — so the observer disconnects the moment it has animated, which satisfies the unobserve-before-tween guard by never observing again.

**The guard, which is the only reason this is allowed:**

- The tween writes an inline height, which the observer then measures, which triggers another tween. **Unobserve before the tween, re-observe in `onComplete`,** and clear the inline height there.
- **A window resize is not a content change.** Kill any in-flight tween, clear the inline height, re-baseline the remembered height, and return without animating. Without this the box latches onto a mid-tween size and chases it for the rest of the resize.
- `0.45s`, `power3.out`, `overwrite: "auto"`.

Prefer `scaleY` on a wrapper with `transformOrigin: "top"` wherever the content can tolerate the squash — it is a compositor-only property and needs none of the above. Reach for real height only when the squash is visible, which for text it is.

## One reveal, played on the shell's timeline

**There is one reveal, and every piece of output gets it**: the **label reveal** sweeps a bar over each coloured token, tier by tier, and the **character wave** rises under the grey prose between them. Text that arrived finished and text landing chunk by chunk are animated identically.

What is live about live output is **when** an element animates, not how. An element reveals as its content lands, so output still arrives in the order the program wrote it — the timeline belongs to the shell, and the gesture is the same everywhere.

**The typewriter is gone.** It was a `clip-path` staircase that wrote a still-growing element row by row, with the bars and the wave reserved for text that was already final. It was removed rather than retuned, and the reason is not taste: one command's output looked like two different products depending on where a PTY chunk boundary happened to fall. A chunk boundary is an artefact of the pipe, not a fact about the text, so the reader was being shown a distinction with nothing behind it. Deleted with it: the output caret, `revealClip` / `revealHead` / `revealStagger`, and `src/lib/reveal.js` entirely.

### The timeline is the shell's, not the pipe's

An element reveals as its content lands — but "lands" means the program finished a thought, not that a chunk boundary happened to fall somewhere. The renderer takes the buffer's structure only after the stream has been quiet for 80ms, capped at 240ms so a command that never stops talking still flows. Below that cap nothing is being delayed; it is being allowed to arrive.

A block's **first** paint is held longer — 1.5s (`SHOW_FIRST_MAX`) — because there is nothing on screen yet to hold back, and half a block arriving before the rest is the thing that reads as broken. What covers that wait is the **run bar**: an indeterminate bar beside the running hint at the foot of the block, ambient tier, after a third of a second so fast commands never flash one. It runs for as long as the command does. It was once shown only while nothing had been printed, on the argument that output is its own proof of life — it is not: output is evidence that something *happened*, and a command that printed two lines and then stalled looked identical to one that had finished. The bar holds the result line's slot until there is a result to put there. It loops forever by construction, so its kill path is not optional; the action's `destroy` owns it, and the element unmounts the moment the block closes.

This is not a performance measure, it is a correctness one. Structure is re-derived from the whole buffer on every change, and a growing buffer's structure is not final: `ping`'s header is a heading with a single reply under it, and then a heading with a list, so the first replies mounted as prose and were destroyed a moment later. Animating a node on its way to being thrown away is worse than not animating it, and it is the same cause as a block that lands at one height and jumps to another.

### Live output is not split

The character wave splits real DOM, and Svelte re-renders an output element from the parser on every chunk. Splitting an element that is about to be re-rendered is the `SplitText` hazard exactly — the element freezes at whatever it held when the split ran, or the animation tears halfway through.

**Two kinds of element are unsafe to split, and it is not "everything in an open block" — treating it as that took the wave off every code block in a running command.**

1. **The last element of an open block, and only while its line is unfinished.** Output is appended to it — that is the hazard, and being last is not. A program that writes a whole row and a newline has nothing more to put in the element that row landed in, and the cursor standing at column 0 is its own statement of that (`tailComplete`, read off the same buffer pass the rendered text came from).

   **Holding every tail is what left a streaming list with no wave anywhere.** Each row is the tail at the instant it arrives, so `ping` revealed row after row as one piece, and the only row that ever waved was the last — released when the block closed. The report reads as "the first three do not animate and the fourth does", which is a strange enough symptom to be worth recognising: it means a per-element safety rule is firing on everything except the final element.
2. **Every element of a block that has been seen to lose more than two rows at once.** A block that gets shorter by a screenful is a program redrawing its own screen, and a redraw rewrites all of it. Once a block has repainted it is assumed to keep repainting, because it will — it carries a `data-repaint` attribute from the moment the resize observer sees that drop.

   **A line is not a screen, and the threshold is what says so.** Every progress spinner erases the line it stands on; `npm ls` does it once, right before printing its tree. Flagging that took the character wave off the whole command for the rest of its life, an entire second before the output that would have waved existed. The tail element is held back on its own account anyway, and that is where a rewrite in place actually lands.

Everything else splits and waves normally, including code blocks, whose wave drops to a per-word unit at `WAVE_MAX` and is the same gesture at a coarser grain.

**Unsafe elements are not held back.** They reveal on the same beat as everything else — the bars sweep their tokens, and the grey prose rises as one piece rather than character by character, which is the resolution the wave already degrades to for a code block. A coarser version of the same gesture, not a second animation. **Nothing is held back and nothing is revealed twice**: an element animates once, on the chunk it mounted in, and later chunks only rewrite its text.

The bars are safe on live content where the wave is not, and that asymmetry is the whole rule: a bar is an overlay div, and the only thing it writes into the element is a `clipPath` that a re-render harmlessly drops.

**"Only the last element can change" is false, and a pager is the proof.** `less` repaints the entire screen on every keypress, so every element in that block is rewritten each time. An earlier design held only the tail on that theory: with a single-element block it showed nothing at all, and it split the others while they were still changing, which tore them mid-animation. Do not reintroduce a rule that assumes an open block has a stable head.

**The scroll mode no longer changes the reveal's rate.** It used to: the typewriter's burst scaled with the backlog in "move down". The reveal has one duration now, and the mode governs only where the view lands. If "move down" starts to feel behind, the lever is the flood threshold below, not a second pacing curve.

`REVEAL_MODES` is the reader's switch over all of the above, and it has exactly two positions:

- **`reveal`** (default) — the rule as written above: bars over the tokens, the wave under the prose, played as content lands.
- **`instant`** — none of it. Every output element arrives as one piece, rising `0.008` of the viewport on `power3.out` over 0.22s: the settings panel's entrance at the scale of a line of text. No character is ever typed, nothing is clipped between chunks, and an element is on screen in full one frame after it mounts (`revealInstant`).

Three things this setting is not:

- **It is not `prefers-reduced-motion`.** That is handled before any reveal is chosen and produces no animation at all. `instant` still animates — it just never *writes*.
- **It does not touch chrome.** The panel, the suggestion strip, the block border draw and the arrival bounce are responses to a gesture the user just made, and they keep their animation in both modes. The setting governs command output only.
- **It is not a rate curve.** "Move down" (below) is the same reveal at a different pace; `instant` is a different reveal, and it takes the element out of the row-counting machinery entirely.

An element that is mid-reveal when the mode changes is shown where it stands, never replayed — the same rule the live/final handoff follows above, for the same reason.

### The label reveal

Ported from the portfolio's `miscLabelReveal.ts` (`buildLabelReveal`), beat for beat. An accent bar grows from zero across the label, the text is uncovered underneath it, and the bar then slides off to the right — so the text is revealed by the bar leaving, not by a separate animation racing it.

```
bar   scaleX 0 → 1     0.28s  power3.inOut   transformOrigin: left center
text  clipPath set open                      (instant, under the bar)
bar   transformOrigin: right center
bar   scaleX 1 → 0     0.32s  power3.inOut
```

Durations are roughly two-thirds of the portfolio's 0.42s/0.5s, under the same rule that retuned the glitch: a section entrance there is a destination, a line of output here is on the way to something.

Three details carry the whole gesture, and all three are easy to get wrong:

- **`power3.inOut`, never `power3.out`.** An `out` ease is most of the way across before the eye has found it, so the bar never reads as *growing* — it reads as already being there. The `inOut` starts from a standstill. This is the single most likely thing to be "fixed" back by someone matching the eases used elsewhere in this file.
- **The text is `set` visible, not tweened.** It is behind the bar at that instant, so there is nothing to animate. Tweening a clip alongside the retreat means two eases over one edge, and wherever they part the text either leads the bar or trails it.
- **The retreat is longer than the sweep.** The asymmetry is what makes the bar read as uncovering the text rather than as a highlight passing over it.

The origin flip between the legs happens at `scaleX: 1`, where it is invisible — a scale of 1 is the identity whichever corner it is anchored to. That flip is what turns the retreat into the bar sliding off rather than collapsing back the way it came.

**The bar is never a child of the element it reveals, and never a child of anything the framework renders into.** Two independent reasons, and either one alone is decisive:

1. Output elements are re-rendered from the parser on every chunk. This is the `SplitText` hazard again — a framework rewriting its children either drops what you put there or keeps it and loses the text node instead.
2. **A clip applies to the element's own decoration.** The reveal clips the target; a bar inside the target gets uncovered along with the text it was supposed to be uncovering.

So the bars live in one static overlay, built once, positioned over the target in the scroll container's own coordinates. The overlay is inside the scrollport so the bars scroll with the content they are drawn over, and it is absolutely positioned so it adds no height to the flex column.

### What is a label, and in what order

**The parse is the identification.** The parser has already decided what every run of text *is* — a status heading, a filled inline-code token, a path, a flag, a placeholder, a link — and the renderer wrote that decision onto the element as a class. The animation reads it back and spends it. It knows nothing about markdown, and it never re-derives what the parser already knows.

The ranking lives in [../../src/lib/reveal-plan.js](../../src/lib/reveal-plan.js) (`labelTier`, `labelGroups`, `waveRank`), pure and checked without a browser: `node src/lib/reveal-plan.check.mjs`.

**Colour decides.** A colour is the parser saying *this run means something specific*, so anything tinted is a label and anything grey is prose for the wave. Tier order is **most saturated first**, because the order the eye receives them in should be the order of how much they matter:

To say that precisely, because it is the thing most likely to be misread as shallow: **these are semantic ranks that colour happens to encode, not colours.** `labelTier` reads class names, and a class name is the parser's verdict about what a run of text *is* — a status, a path, a flag. The colour and the tier are two expressions of one decision that was made upstream of both. Ranking by hue directly would be the shallow version, and it would break the first time a token was tinted for any reason other than meaning.

| Tier | What | Colour |
|---|---|---|
| 0 | Status headings | `--err` / `--ok`, fully saturated |
| 1 | Accent headings, filled inline code | `--accent-text`, on an accent surface |
| 2 | Paths | the complement |
| 3 | Flags, links, timestamps | `--accent-text` |
| 4 | Placeholders | `--accent-text-soft` |

**A bar takes the colour of the status it is uncovering.** `--err` under a `.warn` or `.err` ancestor, `--ok` under an `.ok` one, the accent everywhere else. A green `done` swept by a purple bar says two things at once and only one of them is true. These are the two colours in the app that are not the user's to theme, and that holds for the bar over them as much as for the text.

**A code block's tokens rank with their prose counterparts, not on a scale of their own.** `tok-path` sits with `.inline-code.path`, `tok-link` and `tok-time` with links and timestamps, `tok-flag` and `tok-var` where they always were. A path means the same thing quoted in a sentence and sitting in a stack trace, so it may not arrive on a different beat depending on which it is; the self-check asserts the two are equal rather than trusting the table. Only the paint differs — a token inside a block is tinted and nothing else, since a surface or padding would shift every character after it on that row.

Tiers are `0.2s` apart, every label in a tier sweeps at the same instant. `git diff --no-index [<options>] <path>` therefore lands its flags together, then its placeholders a beat later — the structure of the line made visible, rather than a decoration laid over it.

Two rules hold it together:

- **An empty tier is skipped, never held open.** The beats are contiguous, so the number of beats is the number of *kinds of thing* in the line — which is the information the stagger exists to carry. A line with no paths must not sit through a beat of nothing.
- **Grey is never a label.** `md-heading-3` and `tok-str` are both bright and neither is tinted; both belong to the wave. The default in `labelTier` is `null` for the same reason: a class added anywhere in the renderer must not silently start sweeping a bar over itself.

Past `LABEL_MAX` labels a tier opens without bars. Fifty flags in a `--help` dump is fifty absolutely positioned divs for half a second, and at that density they read as one texture anyway.

### Movement is reserved for information that benefits from attention guidance

The tiers rank meaning, and the reveal spends motion in that order. That is only worth anything while motion is scarce. **If everything meaningful animates, nothing is meaningful** — five bars firing across a build summary is not five pieces of guidance, it is a light show with a ranking nobody can perceive.

`LABEL_MAX` is a **per-tier** ceiling and does not stop five tiers each firing their own full complement. So there is a second cap, on the block:

- Past the block's cap, **the lowest tiers fall through to the wave** rather than the highest ones being dropped. Losing the bar on a placeholder costs nothing; losing it on the result line costs the one thing the reveal was for.
- The result line is tier 0 and it is the last thing to lose its bar. A block that gets exactly one bar gets it there.

The instinct this is written against is the reasonable-sounding one: a token was ranked, so it earned a bar. It did not. **The ranking says which motion to spend first, not that all of it must be spent.** A five-line build summary gets one bar, on the result, and the rest rises in the wave — and that reads as *look here*, which is the whole brief, rather than *look at everything*, which is the failure mode this file exists to prevent.

Same rule, one level up, as **one focal element per action**. It is the same claim about meaning applied inside a block instead of across the screen.

### The character wave

**The wave runs last, after every label tier.** It starts at `(tiers.length + waveRank) * LABEL_STEP` — a beat past the last tier's start, which falls inside that tier's own retreat, so the prose begins as the last bar is clearing its text rather than after a gap. The tiers are a ranking of how much a run of text means and grey prose is the bottom of it: it is the material the tokens sit in, so it arrives after them.

**Elements are ranked the same way runs of text inside them are, and the rank offsets the whole reveal.** `revealRank` in `reveal-plan.js` gives a list row 0, ordinary prose 1, and a code block 2; the reveal starts at `rank * LABEL_STEP`, **labels included**, so a block's flags and paths still sweep in tier order inside its late slot rather than being flattened into it. A row is a named thing the way a label is — one item out of a set, and the set is the shape of the output. Prose is the material the rest sits in. A code block is a quotation, a verbatim lump the prose around it is pointing at, so it lands after the text that introduces it and is the last thing in a block to move.

The grey prose between the labels rises into place character by character — `autoAlpha` and a 7px `y`, 0.3s `power2.out`, 0.012s apart. **This is the one sanctioned per-character stagger in the app**, and the reasons the ban exists do not apply to it: it never runs on streaming output, it is one tween with many targets rather than one tween per character, and it only runs on elements that are on screen.

**The unit drops from a character to a word past `WAVE_MAX`, and the wave itself never disappears.** A code block is hundreds of characters, and the first version fell straight from per-character to a single fade at the cut-off — which is why code blocks had no wave at all. The gesture survives the coarser unit; only the resolution changes. Nothing is split at all past `WAVE_MAX_WORDS`, which is an escape hatch and not a size anything real reaches.

**A line of prose is a reveal unit too, for the same reason a row is.** The action is on a `<span class="md-line">` per line, never on the `<pre>` around them: an element animates once, on the chunk it mounted in, so a paragraph rendered as one element animated when its *first* line landed and every line after that simply appeared. A loop printing a number a second is the case that shows it. The split is `lineParts` in `parse.js`, capped at `LINE_MAX` lines — past that the node is one element again, because a line is a DOM node and a long file is not worth ten thousand of them. The span is `inline-block`: the live line rises with a transform, and a transform does nothing to a non-replaced inline box.

**The row is a list's reveal unit, and it waves like everything else.** The action goes on the `<li>`, not on the `<ul>`. A list grows a row at a time — `ping` adds one a second — and an element animates once, on the chunk it mounted in, so a reveal on the list fired for the first row or two and every row after that appeared with no animation at all. Attaching it per row makes a list follow the same rule as everything else in a block: what arrives is what animates.

A row was briefly exempt from the split and rose as one piece, on the argument that a stagger inside a row crosses the wave of rows arriving. It reads as a row that failed to animate, so the exemption is gone: same gesture, same unit, one rank ahead of prose. Labels inside a row still sweep first. Its cost is per-row splitting on a long listing, which `inView` already bounds to the rows on screen, and `WAVE_MAX` / `WAVE_MAX_WORDS` bound per row as they do everywhere else.

The live and repaint tests are the only remaining reasons not to split, and they are safety rules, not style ones — they mean *this cannot be split without breaking*. Nothing else may be added to them for how it looks; conflating the two is how the wave came off every code block in a running command once already.

Per-row actions are cheaper than the whole-list split they replaced, not more expensive: `inView` culls off screen, so a two-thousand-row listing animates the forty rows on screen instead of splitting the entire `<ul>` because one corner of it was visible.

The stagger is `amount`, not `each`: the wave's total length is capped at 0.6s however many units it turned out to have. At a flat per-unit gap a code block's last unit lands seconds after its first, long past the point where anyone is still watching a wave.

The split is real DOM, so it comes with the obligations any split does, and two of them are specific enough to get wrong:

- **The original text nodes are kept, not their markup.** They are detached and handed back on completion — the same objects, so a reference the framework holds still points at a node that is in the document. This is exactly what `SplitText` gets wrong: restoring from a saved HTML *string* builds new nodes, and every reference the framework had is left pointing at something that will never be on screen again.
- **Characters are grouped into words.** A character span must be `inline-block` for a transform to apply to it at all, and a run of inline-blocks gives the browser a break opportunity between every one of them — so a split element wraps mid-word and re-wraps when it is restored. The word wrapper carries `white-space: pre`, which puts the break opportunities back where the spaces are. Whitespace itself stays as plain text: no ink, nothing to animate.

Text can be nested — a list's text is in its `<li>`s, not in the `<ul>` the reveal is attached to — so every element holding text of its own is split, and labels are never descended into.

Every path that ends a reveal early (interrupt, `clear`, resize, unmount) has to take the split down. That is what `cleanups` is: one teardown per element, held outside the timeline, because a killed timeline's `onComplete` is owed to nobody.

### One hide, before the pass has looked at anything

The reveal hides its element in the action, before the browser's first paint, and the pass a frame later swaps that hide for its own — the per-character `autoAlpha` and the label clips. `visibility` is what the action uses because the pass may decide the element is off screen and simply show it, and `visibility` is the one hide that costs nothing to undo. Dropping it any earlier puts the whole element on screen at full strength for a frame, which is the flash the reveal exists to avoid.


## Flood control — mandatory

Real commands do not emit twenty tidy lines. `npm install` emits thousands, fast.

**Rule: an element that is not on screen is never animated.** `inView` is the whole test — a reveal nobody can watch is cost with no effect, and on a long command it is nearly all of the output. The element is shown outright and its entry is dropped. This is also what makes a flood cheap without a second mechanism: only what fits in the viewport can animate, so the ceiling on concurrent reveals is the screen rather than the command.

**Ask it first, before any preparation.** The test is worth nothing where it originally sat — after the tier walk and after the character split. Preparing a reveal is most of its cost: a DOM walk to rank the labels, then the element's text replaced with one span per character and put back again, all for an element nobody could see. `git --no-pager diff` is almost entirely off-screen elements, and it was slower than a raw terminal by exactly that work. The same applies to every entrance, not only the reveal — a code block's container rise is skipped off screen too. Read the scrollport's rect once per pass, not once per element.

That ceiling replaces the old 40-pending-rows queue cap, which counted rows because the typewriter walked rows. The unit is the element now, and the viewport bounds how many of those can exist at once.

**What is still owed:** a burst that mounts thirty on-screen elements in one frame reveals thirty at once, because nothing staggers *between* elements — the arrival order used to supply that and now only the label tiers within an element do. Unwatched so far; if it reads as a flash rather than a reveal, the fix is a small per-element offset in the pass, not a return to row counting.

Additional guards:

- **Nothing is measured against a moving viewport.** Every decision here is a rect against the scrollport, and all of them are wrong while the view is travelling — an element judged off-screen is shown outright and never gets its reveal back. The pass holds, one frame at a time, until the view has settled.

  **Checking for a scroll tween in flight is not enough, and checking only that misses the common case.** The pass runs from `requestAnimationFrame`; the scroll is started from a `ResizeObserver`, whose callbacks are delivered *after* rAF in the same frame. On the frame a chunk lands, the pass therefore runs before the scroll it should be waiting for exists. So the test is also positional: in "move down" the tail is where the view is headed, so a gap between the tail and the bottom edge means a move is owed whether or not anything is tweening yet. This is why "move down" — the mode whose whole job is moving the view — was the mode whose reveals misfired.

  Held frames are capped. A view that never settles must not be able to turn every animation in the app off silently, and by the time that many frames have passed the backlog is usually past the flood threshold anyway — which reveals instantly and wants no measurement.
- **Leave no per-unit DOM behind.** The character wave's spans and the label bars are the only DOM any reveal creates, and both come down on completion — and on every early exit, which is what `cleanups` is for. One `<span>` per character over a long scrollback is hundreds of thousands of elements.
- **Stop tracking finished elements.** Only the last block can still grow. Anything above it is final, and a map keyed by element otherwise holds one entry per rendered node for the life of the session.
- **A resize is not new content.** Reflow changes an element's row count without changing what it says. Re-baseline every tracked element on resize, or dragging the window edge replays the reveal over output that has been on screen for minutes. Same shape as the height-tween guard above.
- **Kill on interrupt.** Ctrl+C, `clear`, and unmount must `.kill()` every in-flight tween for that block.

## Block chrome

Each command block is a `<section>` with a slightly lighter background than the terminal base and a slightly lighter border than that. Both read off the token layer (see Phase 4) — never hardcode.

- **Entrance:** `autoAlpha: 0, y: 8` → in, 0.25s. Fires once when the block is created, before the output reveal begins.
- **Divider:** drawn at the end of each block, separating it from the next. Reveal with `scaleX: 0` → `1`, `transformOrigin: "left center"`. Never animate `width`.
- **Result line:** the label reveal at tier 0, tinted green or red by exit code. It mounts only when the command finishes, so its reveal *is* the completion pulse — it was a separate 0.3s scale tween once, which was a second gesture invented for the one run of text in a block that most obviously already has one. Success and failure use the same motion; the colour carries the difference, and making failure animate harder would be saying it twice. It also says *what* happened where that is known — `exitLabel` in `parse.js` names the codes that recur and prints the rest as hex, because `exit -1978335212` is the same number as `0x8A150014` and only one of those can be recognised.
- **Border hover:** the pointer-tracked ring, above. Ambient tier — it never responds to an action.

The entrance above is what an **arriving** block gets. A block created by the user submitting a command gets the handoff instead — its border draws and it pops, and that replaces the entrance rather than playing alongside it.

## Nodes that are not text

The reveal measures rendered rows. Three node types from the expansion phases have none, and each gets an explicit rule rather than an accidental one.

- **Embeds** — mermaid diagrams, images, video ([../foundation/phase-9-rich-media.md](../foundation/phase-9-rich-media.md)). An embed is a leaf: it fades in as one unit, `autoAlpha` only, 0.2s, and it holds its slot in the row stagger so the rows after it stay in sequence. Never scale an embed in — a diagram that grows into place reflows everything under it.
- **Folds** — collapsing and expanding a section ([../foundation/phase-8-document-engine.md](../foundation/phase-8-document-engine.md)). This is the one place height genuinely changes, and the rule against animating `height` still holds: animate `scaleY` on a wrapper with `transformOrigin: "top"`, or accept an instant fold. **A fold during an in-flight reveal kills the reveal**, it does not queue behind it.
- **Split view** — showing or hiding the raw pane ([../foundation/phase-10-document-view.md](../foundation/phase-10-document-view.md)) uses the same 0.2s crossfade as the raw/block mode switch. The xterm side itself is still never animated; only the pane's opacity is.

## Reduced motion

Every animation goes through `gsap.matchMedia()`. This is not optional and not a nice-to-have — the character wave in particular is exactly the kind of motion that triggers vestibular symptoms.

```ts
const mm = gsap.matchMedia();

mm.add({
  reduceMotion: "(prefers-reduced-motion: reduce)",
}, (ctx) => {
  const { reduceMotion } = ctx.conditions as { reduceMotion: boolean };
  // reduceMotion → no reveal at all, content appears instantly
});
```

Under reduced motion the reveal is **skipped entirely**, not merely shortened. Content appears. Call `mm.revert()` on unmount. Do not nest `gsap.context()` inside `matchMedia` — it creates one internally.

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

Svelte components must return a cleanup function from `onMount` that kills every timeline, drops every tracked element, and calls `mm.revert()`. A terminal session runs for hours; leaked tweens compound. Killing a reveal means letting it *land* — `progress(1)` before `kill()`, then clear the clip — because a killed tween leaves the element wherever the playhead stopped, and for this animation that is output cut in half.

## Do not

- ❌ Per-character stagger on streaming output. The character wave is the one exception and it is bounded: static text only, on screen only, one tween, capped at `WAVE_MAX`.
- ❌ Animate `width`/`height`/`top`/`left`. Two exceptions, both with a mandatory guard: *Height* and *Width* above.
- ❌ Animate anything inside the raw xterm.js fallback view. That view is a real terminal — it renders at the speed the program writes, with no interception. Only the crossfade into and out of it is animated.
- ❌ Set `will-change` globally. Only on elements actually mid-animation.
- ❌ Pass `overwrite: true`. It kills every tween on the target, not the conflicting one — a hover tween takes out the entrance that was still playing and strands the element half-faded. Use `overwrite: "auto"`, and scope `killTweensOf` to the properties the caller actually owns.
- ❌ Rebuild the children of an element a framework is rendering into. That includes `SplitText` on command output — see the reveal.
- ❌ Ship `GSDevTools`.
- ❌ Move two elements at full amplitude in the same action. One focal, everything else at 40% with no overshoot.
- ❌ Use the elastic bounce on an element that is losing focus, or the discrete settle on one that is gaining it. The two carry meaning.
- ❌ Chain a handoff's beats with `delay:`. One timeline, overlapping positions.
- ❌ Start a content reveal before its container has finished arriving.
- ❌ Leave a container unanimated because it is chrome. Not clipped, not typed — still arrives.
- ❌ Give two elements of the same block different reveals. The block decides, not the chunk boundary.
- ❌ Queue a handoff behind one already in flight. Kill and hard-set.
- ❌ Glitch anything but a panel entrance or a toggle's own label. Never output, never a block, never on a clock.
- ❌ Ship an infinite CSS animation, or any effect that fires without the user acting. Idle CPU is budgeted at literally zero.
- ❌ Use a constant `scale` factor for a gesture on an element whose width varies. Measure the distance, or express it in `dv`.
- ❌ Draw a container's spawn border by clipping the container. Own layer, removed on completion.
- ❌ Reach for `vw`/`vh`/`%` where `dvw`/`dvh` would do.
- ❌ Attach a per-block pointer listener. One delegated listener on the scroll container.
- ❌ Animate `height` without the unobserve/re-observe guard and the resize bail-out.
- ❌ Add a beat that exists only to be charming.

## Open

- **The mark's run on a wrapped or very long command.** The throw is the width of the command text, which on a command that wraps is the width of the last row rather than of the line. Untested against a real long pipeline; it may want a cap.
- **Per-character glitch probability.** 10% with a floor of one character per label is the current rule. Whether the floor should instead be proportional (`max(1, round(len * 0.1))`) needs checking against real toggle labels, which are short — at eight characters, 10% and the floor are the same thing.
- **Does the handoff survive a fast typist?** The kill-and-hard-set rule is correct and untested. Someone submitting three commands in under a second should see three blocks land cleanly, not three interrupted gestures. Verify before this ships, not after.
