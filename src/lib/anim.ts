/**
 * The animation values more than one surface uses.
 *
 * Almost every number in this app belongs next to the thing it animates, and
 * the ones that live here are the exceptions: a *shared* value is a statement
 * that two surfaces are the same gesture, and duplicating it is how two
 * surfaces quietly stop being that. Anything used once stays where it is used.
 *
 * The binding ruleset is [.claude/docs/ANIMATION.md](../../.claude/docs/ANIMATION.md).
 */

/**
 * The stuttered entrance, ported from `Classified-Section.vue`. Position drags
 * in on a jitter ease while opacity blinks up on a *different*, stepped one —
 * the two not tracking each other is the entire effect. Retuned from the
 * portfolio's `strength: 2.4, points: 24` over 0.7s: a section entrance there
 * is a destination, a panel here is on the way to something.
 *
 * `randomize: true` so no two openings stutter identically, `clamp: true` so
 * the jitter never overshoots past the resting position.
 *
 * Shared by the settings overlay and the suggestion strip, which is the point:
 * both are chrome answering a gesture the user just made, and they are meant
 * to arrive the same way. Needs `RoughEase` registered — an unregistered ease
 * string silently degrades to `power2.out` rather than erroring, which is the
 * worst possible failure mode for an effect whose whole point is the jitter.
 */
export const GLITCH_IN =
  "rough({ template: power2.out, strength: 1.6, points: 14, taper: out, randomize: true, clamp: true })";
