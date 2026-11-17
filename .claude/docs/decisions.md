# Decisions

## 2026-11-13 — A scrolling page, not rooms behind a cut

V/AS module 11 says a V/AS app is places swapped behind a cut and not a scroll-driven page. The brief
for this project asks for heavy inspiration from noth.in, which is a scrolling page, so scroll is the
project's own rule here. What was kept from V/AS: text is revealed once and never re-revealed, the
accent belongs to the room and changes at the room boundary, reveals use the bar sweep and the mask
lift, edges are cut and never faded. Rejected: a section state machine with a curtain between screens,
as in PORTFOLIO25.

## 2026-11-13 — Mechanics taken from noth.in

The count-up loader, the full-width wordmark at the top and bottom, the liquid cursor trail in the
hero, the media card that shrinks and docks while a statement lights up word by word, the section word
whose letters scatter across the top bar while its section scrolls, the heading set as letters spread
over the full width, the row list. Each is rebuilt in V/AS terms; none of its type, colour or imagery
is used.

## 2026-11-13 — ScrollSmoother for smooth scroll

GSAP's own smoother keeps the stack at GSAP only. Rejected: Lenis, a second motion dependency.
Consequence: nothing inside the wrapper can use `position: sticky`; pins go through ScrollTrigger.

## 2026-11-13 — Scrubbed motion uses no ease

A scrubbed tween follows the scroll position frame by frame, so the hand is the ease. This is the
gesture rule (animation §14) applied to the wheel, and the reason `ease: 'none'` appears on scrubbed
tweens although §10 forbids linear on played ones.

## 2026-11-13 — No blanket radius

V/AS applies the squircle to every element and opts text out. Here full-bleed sections and slabs would
round at the viewport edge, so the token is applied to boxes one by one. The token is unchanged.

## 2026-11-13 — Display face falls back to Audiowide

Wosker is not redistributable and is not on this machine. The display stack is `Wosker, Audiowide,
Mono`, the same fallback VAD/OS Files documents. The faces in the V/AS `fonts/` folder have no role
assigned yet and were not used.

## 2026-11-13 — Product accents

Shell blue, Terminal violet, Bubble yellow, Gallery crimson, Files amber, Notes green, VAD/OS cyan
(the custom slot). Terminal is violet because its screenshots are. Projects use hot pink from the
secondary list.

## 2026-11-13 — Demonstrations

A product with real media shows it (Terminal, Files, Bubble). A product without media gets a live demo
of one mechanic: Shell the liquid edge, Gallery the stack group, Notes the ink canvas. The private
VAD/OS dashboard has neither and shows copy only.

## 2026-11-13 — Chakra Petch and JetBrains Mono replace Audiowide and Space Mono

Chakra Petch's cut corners match the squircle-and-terminal look better than Audiowide's rounded forms.
JetBrains Mono has even glyph widths and a tighter line, so the hero ASCII banner holds its grid.
Both are OFL. The hero shows `heroBanner.txt` (the V/AS `banner.txt`) instead of a typed wordmark.
The Projects section is removed: the page shows VAD/OS products only.

## 2026-11-17 — The hero changes scene on a gesture, not on scroll distance

The hero was pinned for 1.2 screens and scrubbed. The scrub smoothing sat on top of the smoother's,
so the head and foot trailed the wheel by about two seconds. Once the premise had played, the rest of the
pin was dead scroll. Scrolling back up paused the page and threw it to the top. Now `sceneGate` reads the
first downward wheel, swipe or key at the top of the page as intent, swallows it, and plays the whole
change as one timeline: head and foot cut out, the banner docks, the premise types. The next fresh
gesture scrolls the page. A fresh upward gesture at the top plays the scene back. A gesture counts as
fresh after a `GESTURE_GAP_MILLISECONDS` pause in the wheel stream, so trackpad momentum never
carries through a scene change. A fresh opposite gesture during a change reverses it at once. Leaving the
top any other way (a link, the navigator) plays the premise scene without blocking. Rejected: a
shorter pin with played tweens on enter and leave, which still leaves scroll distance where nothing
happens.

## 2026-11-17 — The root scale follows width and height

`rem` is the only unit components size by, so the root font size is the one place scale is decided.
Landscape took the width alone, so a wide, short window (a laptop with a tall toolbar, a phone on its
side) kept a large scale and its rooms overflowed. It now takes the smaller of the width curve and a
height curve, from 12px to 28px, and the 28px ceiling lets 4K screens keep growing. Portrait was a
fixed 16px, which left tablets with phone-sized type; it now grows from 15px to 22px with the width.
Device pixel ratio is not used: CSS pixels already account for it.
