# Quirks

**"Reveals never play and counts stay at 00, but only in the Claude browser pane."** A hidden pane
throttles `requestAnimationFrame` to about two frames a second, so GSAP barely ticks. Check in Chrome.

**"`scrollIntoView` and anchor jumps do nothing."** ScrollSmoother fixes the wrapper and moves the
content with a transform. Use `scrollToTarget` from `scrollEngine.ts`. Keyboard focus is brought into
view by the `focusin` listener there.

**"A sticky element does not stick."** Same cause. Pin it with ScrollTrigger (`pin: true`).

**"The wordmark is the wrong width after a resize while scrolled."** `fitText` measures `offsetWidth`,
not the bounding box, because the hero title is scaled by a tween.

**"Vite warns that `/fonts/Wosker.otf` did not resolve."** Expected until the file is dropped into
`public/fonts/`. The stack falls back to Chakra Petch.

**"A second click during the accent wipe leaves the bar half way."** The whole timeline has to be
killed, not only the tweens on the bar: `wipeTimeline?.kill()` in `System-Section.vue`.

**"A prop holding a template ref is null inside a queued scroll setup."** The setup queue runs in the
same flush as the mount, before the parent re-renders. Read the element's `parentElement` instead.
