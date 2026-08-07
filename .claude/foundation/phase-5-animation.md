# Phase 5 — GSAP Animation Layer

**Status: the foundational pass is complete and unverified on screen.** Attention tiers, the handoff, the two bounces, the typewriter reveal, both portfolio ports (hover ring and glitch), the result pulse, the divider draw, the mode crossfade, and the exit animations are all implemented. Nothing here has been run against a real window yet — the numbers are the ones the rules specify, not ones anybody has watched. See *Verify* at the bottom; that list is now the whole remaining work of this phase.

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

### Status / Learned — steps 1–3

All three landed in `src/routes/+page.svelte`. Step 4, the reveal, has since landed as well — see *Status / Learned — the reveal* below.

- **The tiers needed one constant and one function, not a system.** `PERIPHERAL = 0.4` and `settle()`. Focal is written literally at each call site — a helper for "use the full number" would be a wrapper around nothing. Ambient needs no helper at all, since it never responds to an action and so has nothing to scale against.
- **`settle()` takes the property, because `scale` was wrong for the input bar.** The retract is horizontal, and a `scale` keyframe writes both axes — the bar would have squashed vertically on its way back. The peak is derived from where the element is returning *from* (`1 + (from - 1) * PERIPHERAL`), so an element coming back from a retract overshoots outward rather than needing a second hand-picked number.
- **The handoff is split across two functions because the block does not exist when the gesture starts.** `startHandoff()` runs inside the Enter branch of `t.onData`, before `openBlock()`, and measures beat 1 against the input bar as the user left it. `blockEnter`, a Svelte action on the block `<section>`, claims the gesture via a `handoffPending` flag when Svelte mounts the node a frame later.
- **The two halves are two timelines, not one, and the first attempt at one timeline is why the animation "sometimes broke".** Adding the block's beats to the input's timeline made the whole gesture depend on the block mounting *before* that timeline finished. A slow frame — PTY spawn, a first parse — pushed the mount past it, the children landed on a timeline whose playhead was already at the end, and they never rendered: the block stayed frozen at its spawn size, small and offset, with streaming output overflowing a box that never grew. Now each half owns a timeline and both are registered in `handoffParts`, so "kill both halves together" stays true without one half's existence depending on the other's clock. Three guards came with it:
  - `killHandoff()` calls `progress(1)` before `kill()` on every part. An interrupted tween that is merely killed leaves the block wherever it happened to be, which is indistinguishable from a broken animation.
  - **A staleness window (`HANDOFF_STALE_MS`, 250ms).** A block mounting later than that gets the plain entrance. The bar has settled and the scroll has moved by then, so flying in from a remembered position would land somewhere wrong — and a plain entrance is always correct.
  - **Beat 2's offset is what is *left* of the 0.09s**, computed from `performance.now() - handoffAt`, not a fresh 0.09. Restarting the count at mount drifted the halves apart by however long the mount took.
- **Scrolling mid-flight used to throw the travel off, and the fix is a `modifiers` function on `y`.** The input bar is fixed to the window; the block lives in the scroll container. `from.y` is measured across that boundary once, so every pixel the container scrolls while the tween runs moves the block's real start point away from the bar — and the block appeared to fly in from nowhere. The modifier re-adds the scroll that has happened since (`scrollEl.scrollTop - scrollTop0`), faded out by the tween's own remaining distance (`y / from.y`, which runs 1 → 0) so it still converges on 0 instead of landing offset. It reads live `scrollTop`, so the anchor scroll and a user's wheel are both covered.
- **`overwrite: true` on the hover border was leaving blocks stranded faded.** GSAP's `true` kills *every* tween on the target, not just the one whose properties conflict — so moving the pointer over a block that was still animating in killed its entrance mid-tween and left it at whatever opacity and scale it had reached. It happens constantly in practice, because the pointer is usually already sitting where the newest block arrives. `overwrite: "auto"` kills only the conflicting property, and the action's `destroy` kill is scoped to `borderColor` for the same reason: an action does not own tweens it did not create. **Treat a bare `overwrite: true` as a bug in this file** — it is a kill of everything, spelled as if it were a kill of one thing.
- **Both entrance paths `clearProps` opacity and visibility as well as transform.** A block is permanent content; an inline `opacity` left on one is a single stray `kill()` away from output nobody can read.
- **Both timelines clear their own transforms on completion.** A leftover identity matrix still makes the element a containing block for anything positioned inside it, and it is not free to leave on a scrollback's worth of sections. `killHandoff()`'s `progress(1)` runs those `onComplete`s, so the kill path cleans up too.
- **`clearBlocks()` kills the gesture.** A pending handoff whose destination is being unmounted would otherwise be claimed by the next block to mount, which is a different command entirely.
- **Beats 2 and 3 are one movement, not two.** Popping the block in place and then travelling read as a thing appearing and then moving. The block now spawns *at the input bar* — offset by the centre delta between the bar's rect and the block's resting rect — at 40% of the bar's width and 90% of its height, and travels up to its slot growing as it goes. The pop is the arrival: the scale is the tween that overshoots (`back.out(2)`, 0.26s) and it finishes last, after the 0.22s `power3.out` travel. The spawn size is a proportion of the source rather than a picked number, which is what carries the size continuity.
- **`blockEnter` carries both entrance shapes and picks between them.** A submitted block continues the handoff and its travel beat *replaces* the plain entrance; a block opened by output arriving on its own gets the `autoAlpha`/`y` entrance. The flag makes the distinction structural rather than something a future call site has to remember.
- **`growUpward`'s `killTweensOf` had to be scoped to `y`.** It fires from a `ResizeObserver` on the input bar, and clearing the input on Enter changes the bar's height in the same frame the retract starts — an unscoped kill took the retract with it. The two now own disjoint properties on the same node (`y` vs `scaleX`), which is the only reason they can coexist.

Still untested against a real window: the `6dvw` retract distance and the `0.6` scale floor are both the guesses `ANIMATION.md` flags as open, and the kill-and-hard-set path (`handoffTl.progress(1).kill()`) has not been run against a fast typist.

## The signature animation

Settled after discussion, full detail in `ANIMATION.md`:

- **Stagger by rendered row at 0.12s** — not per character (an 80-column line would take 4 seconds), and not per logical line (a wrapped line must produce one reveal per visual row).
- `SplitText` with `type: "lines"` handles wrap detection natively. Do not hand-roll with `Range.getClientRects()`.
- **Typewriter look = one tween per row with `ease: steps(n)`**, where `n` is that row's character count, animating a `clipPath` wipe. This reads as genuine character-by-character typing at roughly 1% of the tween count of real per-character animation.
- Applies identically to markdown and plain output — a visible difference between the two would draw attention to the boundary.

### Status / Learned — the reveal

**The mechanism changed, and `ANIMATION.md` changed with it.** `SplitText` is out. It replaces an element's `innerHTML` with one wrapper per row and restores a saved HTML *string* on `revert()`; both detach the text nodes Svelte holds references to. Output elements re-render from the parser on every PTY chunk, so the first reveal of a still-streaming element would have been the last update that element ever received — the block freezing at whatever text it held while the shell went on producing output nobody could see. That is not a tuning problem and no amount of `autoSplit` fixes it. It would also only have shown up on long-running commands, i.e. after shipping.

What replaced it is a `clip-path` staircase written on the element itself: rows above the cursor visible, the cursor's row wiped to a character boundary, rows below clipped. One tween per element instead of one per row, no DOM touched, nothing to revert. The two functions that can be silently wrong — the polygon and the backlog-scaled cadence — live in [`../../src/lib/reveal.js`](../../src/lib/reveal.js) with a browserless self-check: `node src/lib/reveal.check.mjs`. It asserts the properties that matter, chief among them that a finished reveal clips *nothing* (a staircase that ends one character-cell short is a missing character) and that the visible area never shrinks as the cursor advances.

- **The overlap is the one thing genuinely lost.** The table's numbers are a 0.18s wipe every 0.12s, so rows are in flight together; one cursor cannot be on two rows at once. Each row's wipe is one stagger interval instead, and the last row keeps its full 0.18s (`(rows - 1) * stagger + 0.18`), so a one-row reveal is exactly the tween the table specifies.
- **Row counts come from height ÷ line box, which is why `.block` now sets an explicit `line-height: 1.5`.** `normal` resolves per font and some browsers report the keyword back verbatim — the cadence would have drifted with the font mode and been unmeasurable from JS.
- **A resize is not new content.** Reflow changes an element's row count without changing what it says, so without a re-baseline, dragging the window edge replayed the reveal over output that had been on screen for minutes. Same shape as the height-tween resize guard.
- **The map of tracked elements drains itself.** Only the last block can grow; anything above it is final and is dropped from tracking on the next pass. Without that it is one entry per rendered node for the life of the session.
- **The reveal is *held* during a handoff, not skipped.** Content revealing inside a container that is still moving is unreadable. Every path out of the gesture — landing, going stale, being killed — has to release the hold, because leaving it set is the one bug in this region that stops output appearing at all.
- **The clip is permanent, and clearing it between chunks was the first version's bug.** Output appeared at full strength, vanished, and then typed itself in — because Svelte writes the new text and the reveal pass does not run until the next frame. The element now stays clipped at its last revealed row for as long as it can still grow, so the next chunk's rows are hidden the frame they land, and the first hide happens in the action (which runs during Svelte's mount flush, ahead of the first paint) rather than in the pass.
- **The reveal never targets an element carrying chrome.** A code block's box, background and border are already there and stay there; only the text inside types. The fenced block and the pinned command line therefore have an inner text element (`.code-text`, `.head-text`) that the reveal owns, and the chrome stays out of it.
- **The row band is the element's real height divided by its row count, not its `line-height`.** They agree for uniform text. Where they do not, dividing the real height is the only thing that guarantees the last row's bottom edge lands on the element's bottom edge — and since the resting clip sits exactly there, a band a pixel short would hide the final row for good.

### Status / Learned — the ports and the rest

- **The hover ring is delegated, and that is what made `will-change` free.** One `pointermove` on the scroll container resolves the block with `closest()`; the `.hot` class carries `will-change: opacity` on the hovered block only, so the "set it on enter, drop it on leave" rule needs no JS at all. The block's rect is cached on entry and invalidated on scroll and resize — a `getBoundingClientRect` per pointer event is a forced synchronous layout per pointer event.
- **The glitch's RGB split is a class, not a tween.** `text-shadow` interpolates as a string, so a stepped ease over it is a snap wearing an animation's clothes. The motion is the stepped `x`; the split is what it steps through.
- **The character flicker is only safe because the labels are static.** It rebuilds the element's children — the same hazard that ruled `SplitText` out of the reveal. `FONT_MODES` / `SCROLL_MODES` labels are written once at mount and never updated, so nothing is holding a reference that matters. This must never be pointed at output.
- **`RoughEase` has to be registered.** It is an ease, not a tween property, so an unregistered `rough(...)` does not throw — GSAP falls back to the template ease and the jitter silently vanishes.
- **The mode crossfade is a CSS transition, deliberately.** `ANIMATION.md` bans CSS *keyframe* animations for stateful things; this is one property with two states driven by a class the template already toggles, exactly like the hover ring's own fade. A tween would have needed a reactive effect and would have fought the stylesheet for ownership of `opacity`.
- **`clear` now animates its blocks out and the tween owns the unmount.** Truncating `blocks` in the handler animates nodes Svelte has already torn out — which looks identical to having no exit animation, which is what it had.

## Not every node is a row

The reveal measures rendered rows, and the expansion phases introduce content that has none: embeds, folds, and the split-view pane. Each has an explicit rule in the *Nodes that are not text* section of [`../docs/ANIMATION.md`](../docs/ANIMATION.md). Build the reveal so an embedded, row-less node can hold its slot in the stagger — retrofitting that into a row-index loop is the kind of rework this phase ordering exists to avoid.

## Non-negotiable guards

- **Flood control.** `npm install` emits thousands of lines. Queue cap ~40 rows; past that, instant reveal. At 0.12s/row a 40-row backlog is already ~5s behind reality.
- **Revert splits after reveal.** `SplitText` creates one element per row; an hours-long session would accumulate tens of thousands.
- **Kill on interrupt.** Ctrl+C, `clear`, and unmount must kill in-flight tweens.
- **Never animate inside the raw xterm view.** Only the crossfade into and out of it.

## Input caret

**The caret is a cursor at the prompt and a status light while a command runs.** Those are two states and it had only been built for the first. While `!atPrompt` it sits at the start, visible, not blinking, and it does not *travel* there — the trip back is the tail of an edit the user is no longer making. Two things it took:

- The `$effect` returns before tweening when `!atPrompt`. The `gsap.set(caretEl, { x: 0 })` above it has already run, so the landing is hard rather than animated.
- `input = ""` on Enter now clears `cursorCol` with it. The caret is positioned by slicing `input` at `cursorCol`, so clearing one without the other left it standing where the command used to end.

**The caret parking a prompt-width from the start — after `clear` and after several other commands — was not an animation bug at all.** The input mirror computes `cursorCol` by subtracting whatever `PS_PROMPT` stripped from the row. When the strip does not match, it subtracts nothing, `cursorCol` comes out carrying the prompt's own width, and `input = typed.padEnd(cursorCol, " ")` fills the bar with that many spaces. The mirror now bails when the strip matched nothing and keeps the last good state, since mirroring a row the prompt is not on is never right. This is the general `PS_PROMPT` fragility in [../tasks.md](../tasks.md) showing up somewhere new, not a separate bug.

The caret sits in flow between the two halves of the mirrored input and follows the shell's cursor by FLIP: measure where layout put it, tween it back from where it was, transform only. Three things it took to make that read right, all of them cheap to reintroduce by accident.

- **It must not shift the text it marks**, so it has a negative margin cancelling its own advance width. That puts it past the end of its content box at the end of a line, where the box's clip cuts it in half — the box reserves padding for it, and for the `back.out` overshoot on both sides.
- **Duration scales with distance.** A fixed 0.22s is most of a held Backspace's repeat interval, so every tween was killed a fifth of the way in and the caret visibly trailed the text.
- **The distance is clamped**, because it is only meaningful within one row. A deleted word can unwrap the line and move the caret up, which measures horizontally as most of the bar's width and starts the tween outside the visible box.

## Verify

Nothing below has been done. This is the phase's remaining work.

- Run a command producing 500+ lines; profile for dropped frames.
- Watch a slow streaming command (a build, a long `git log`): rows reveal as they arrive, and the block does **not** freeze at the first chunk. That freeze is the specific failure the `SplitText` decision above avoids, so it is the one to look for hardest.
- Resize the window mid-command and after one: no reveal replays over text that is already on screen.
- `clear` with a screenful of blocks: they leave, they do not blink out.
- Hold Backspace through a wrapped command: the caret keeps up with the deletion rather than finishing after it, and stays on screen when the line unwraps.
- Animation must not queue up behind a fast-scrolling stream.
- Toggle `prefers-reduced-motion` — reveal, handoff, and glitch are skipped entirely, not merely shortened. The hover ring stays.
- Submit three commands inside a second: three blocks land clean, no interrupted gestures left mid-flight.
- Cover the focal element in a screen recording and step through it. The remaining motion must not read as the subject.
- Hover across fifty blocks with devtools open: one `mousemove` listener total, and no `will-change` left on a block the pointer has left.

## Ported from the portfolio

Both are specified in [`../docs/ANIMATION.md`](../docs/ANIMATION.md) and both are now implemented in `src/routes/+page.svelte`.

- **Hover ring** (`Module.vue`) — pointer-tracked radial gradient masked to the border ring via `mask-composite`, plus a separate border-colour lift. **Three changes forced by scale:** one delegated listener instead of one per block, writes only to the hovered element, and no permanent `will-change`. The portfolio has ten modules on screen; this has a scrollback.
- **Glitch** (`Classified-Section.vue`) — `rough()` jitter on transform against a `steps(3)` opacity blink, the two deliberately not tracking each other. **Retuned:** roughly two-thirds strength over half the duration, because a section entrance there is a destination and a panel here is on the way to something. The per-character flicker is one-shot, not the portfolio's infinite CSS animation — that would violate the zero-idle-CPU budget outright.
