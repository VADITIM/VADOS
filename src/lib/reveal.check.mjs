// Self-check for reveal.js. Plain node, no test framework:
//   node src/lib/reveal.check.mjs
import assert from "node:assert/strict";
import { revealClip, revealStagger } from "./reveal.js";

const ROW = 20; // px per rendered row, for readable expectations below

/**
 * Visible area of the clip, as a fraction of an element `rows` rows tall.
 * The polygons here are simple and axis-aligned, so the shoelace formula over
 * their points is exact — `%` is read as a percentage of the width, `px` as a
 * fraction of the element's height.
 */
function area(clip, rows) {
  const pts = [...clip.matchAll(/(-?[\d.]+)(%|px) (-?[\d.]+)(%|px)/g)].map(
    ([, x, xu, y, yu]) => [
      xu === "%" ? parseFloat(x) / 100 : parseFloat(x),
      yu === "px" ? parseFloat(y) / (rows * ROW) : parseFloat(y) / 100,
    ],
  );
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// A whole-number cursor is the resting clip: exactly that many rows visible,
// everything below hidden. This is the state an element sits in between
// chunks, and it is why text never flashes into view before being typed.
assert.equal(area(revealClip(0, ROW, 20), 4), 0);
assert.equal(area(revealClip(1, ROW, 20), 4), 0.25);
assert.equal(area(revealClip(3, ROW, 20), 4), 0.75);

// A reveal that has run to the end clips nothing — the single most important
// property in this file, because the failure is output nobody can read. The
// caller derives the row height as `scrollHeight / rows` precisely so that the
// last row's bottom edge lands on the element's real bottom edge.
assert.equal(area(revealClip(4, ROW, 20), 4), 1);

// Halfway down a four-row element: two whole rows, and the third half wiped.
assert.equal(area(revealClip(2.5, ROW, 20), 4), 0.5 + 0.5 * 0.25);

// Quantized to the character grid — this is what makes a smooth wipe read as
// typing. Four cells, so a third of the way across a row still shows one cell.
assert.equal(area(revealClip(0.33, ROW, 4), 1), 0.25);
assert.equal(area(revealClip(0.24, ROW, 4), 1), 0);

// Monotonic: the visible area never shrinks as the cursor advances. A reveal
// that goes backwards mid-row reads as a rendering fault.
let last = -1;
for (let cursor = 0; cursor <= 5; cursor += 0.017) {
  const now = area(revealClip(cursor, ROW, 13), 5);
  assert.ok(now >= last - 1e-9, `area fell at cursor ${cursor}: ${now} < ${last}`);
  last = now;
}

// Row bands are pixels, so they line up with real text rows whatever the
// element's total height turns out to be — a percentage band would shift every
// row every time a chunk made the element taller.
assert.ok(revealClip(2, ROW, 20).includes("40px"));
assert.ok(revealClip(2, 13.5, 20).includes("27px"));

// Single-row elements — a heading, a one-line result — are the common case.
assert.equal(area(revealClip(0.5, ROW, 2), 1), 0.5);

// "Stay on top" is the constant reading pace, whatever the backlog.
assert.equal(revealStagger(1, 0.12, 40, false), 0.12);
assert.equal(revealStagger(39, 0.12, 40, false), 0.12);

// "Move down" falls with the backlog and reaches zero exactly where flood
// control takes over, so the two do not fight over the same rows.
assert.equal(revealStagger(0, 0.12, 40, true), 0.12);
assert.equal(revealStagger(20, 0.12, 40, true), 0.06);
assert.equal(revealStagger(40, 0.12, 40, true), 0);
assert.equal(revealStagger(400, 0.12, 40, true), 0);

console.log("reveal.js self-check passed");
