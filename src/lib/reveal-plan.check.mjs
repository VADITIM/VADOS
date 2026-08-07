// Self-check for reveal-plan.js. Plain node, no test framework:
//   node src/lib/reveal-plan.check.mjs
import assert from "node:assert/strict";
import { labelTier, labelGroups, LABEL_TIERS } from "./reveal-plan.js";

// A status colour is the loudest thing in a block and goes first.
assert.equal(labelTier(["md-heading", "warn"]), 0);
assert.equal(labelTier(["md-heading", "ok"]), 0);

// An accent heading is a label; a level-3 heading is deliberately grey and is
// not. This is the pair most likely to be broken by a careless edit, because
// both carry `md-heading` and only the narrower class tells them apart.
assert.equal(labelTier(["md-heading"]), 1);
assert.equal(labelTier(["md-heading", "md-heading-3"]), null);

// Inline code: the filled accent surface is the loudest token in prose, then
// the complement-tinted path, then the grey-backed timestamp.
assert.equal(labelTier(["inline-code"]), 1);
assert.equal(labelTier(["inline-code", "path"]), 2);
assert.equal(labelTier(["inline-code", "time"]), 3);

// Code-block tokens: what the command is, then what it takes.
assert.equal(labelTier(["tok-flag"]), 3);
assert.equal(labelTier(["tok-var"]), 4);
assert.equal(labelTier(["inline-link"]), 3);

// `tok-str` is bright but untinted, and everything unrecognised is prose. Both
// belong to the wave — the default has to be "not a label", or a class added
// anywhere in the renderer silently starts sweeping a bar over itself.
assert.equal(labelTier(["tok-str"]), null);
assert.equal(labelTier(["block-body"]), null);
assert.equal(labelTier([]), null);

// Every tier the table can produce is inside the count the stagger walks.
for (const classes of [["md-heading", "warn"], ["inline-code"], ["inline-code", "path"], ["tok-flag"], ["tok-var"]]) {
  const tier = labelTier(classes);
  assert.ok(tier !== null && tier >= 0 && tier < LABEL_TIERS, `tier out of range for ${classes}`);
}

const classesOf = (el) => el.split(".");

// Grouping keeps tier order regardless of document order, and drops the tiers
// that are not present — a line with no paths must not sit through a beat of
// nothing between its heading and its flags.
assert.deepEqual(
  labelGroups(["tok-var", "md-heading.warn", "tok-flag", "tok-flag"], classesOf),
  [["md-heading.warn"], ["tok-flag", "tok-flag"], ["tok-var"]],
);

// The user's case: flags land together, placeholders land together one beat
// later, and nothing else claims a beat in between.
assert.deepEqual(
  labelGroups(["tok-flag", "tok-var", "tok-flag"], classesOf),
  [["tok-flag", "tok-flag"], ["tok-var"]],
);

// Nothing colourful at all means no label beats, so the element is pure wave.
assert.deepEqual(labelGroups(["tok-str", "block-body"], classesOf), []);

console.log("reveal-plan.js self-check passed");
