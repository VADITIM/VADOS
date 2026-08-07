/**
 * Geometry for the typewriter reveal (Phase 5, .claude/docs/ANIMATION.md).
 *
 * The reveal is a `clip-path` staircase written on the text element itself
 * rather than a `SplitText` line split: rows above the cursor are fully
 * visible, the cursor's own row is wiped to a character boundary, and rows
 * below it are clipped away. See the "Typewriter reveal" region in
 * `src/routes/+page.svelte` for why the DOM is deliberately left alone.
 *
 * The clip is **persistent**, not something applied for the duration of a
 * tween. An element that can still grow keeps a resting clip cutting it off
 * below the last revealed row, so text arriving in the next chunk is already
 * hidden the frame it lands — clearing the clip between chunks is what made
 * output flash into view and then type itself in.
 *
 * The vertical axis is in pixels and the horizontal in percent, on purpose:
 * rows are a physical height that must line up with real text rows, while the
 * wipe is a fraction of whatever width the element happens to have.
 *
 * Both functions are pure so they can be checked without a browser:
 * `node src/lib/reveal.check.mjs`.
 */

/**
 * The clip for a reveal at `cursor`, which doubles as the resting clip when
 * `cursor` is a whole number of revealed rows.
 *
 * @param {number} cursor  Row cursor. The integer part is the row being wiped;
 *                         the fraction is how far across it is. A whole number
 *                         reveals exactly that many rows and hides the rest.
 * @param {number} row     Height of one rendered row, in px.
 * @param {number} cells   Character cells across the element — what the wipe
 *                         quantizes to. This is the `steps(n)` of
 *                         ANIMATION.md's per-row tween, moved onto the cursor.
 * @returns {string} A `polygon(...)` value for `clip-path`.
 */
export function revealClip(cursor, row, cells) {
  const line = Math.max(0, Math.floor(cursor));
  const x = (Math.floor(Math.max(0, cursor - line) * cells) / cells) * 100;
  const top = line * row;
  const bottom = (line + 1) * row;
  // Every coordinate carries its unit, including the zeroes. A bare `0` is
  // legal CSS and unreadable to anything parsing this back — including the
  // self-check, which is the only thing that ever proves the shape is right.
  return `polygon(0% 0px, 100% 0px, 100% ${top}px, ${x}% ${top}px, ${x}% ${bottom}px, 0% ${bottom}px)`;
}

/**
 * Row cadence for a batch of pending rows.
 *
 * In "stay on top" this is the constant reading pace. In "move down" the view
 * is at the tail specifically to be current, so a reveal paced for reading
 * makes it permanently behind — there the cadence falls with the backlog and
 * converges on instant, reaching zero exactly where flood control takes over.
 *
 * @param {number} pending  Rows waiting to be revealed.
 * @param {number} base     The reading-paced interval (0.096s).
 * @param {number} flood    The flood-control threshold, where this hits zero.
 * @param {boolean} chase   True in "move down".
 */
export function revealStagger(pending, base, flood, chase) {
  if (!chase) return base;
  return base * Math.max(0, 1 - pending / flood);
}
