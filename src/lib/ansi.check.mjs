// Self-check for ansi.js. Plain node, no test framework:
//   node src/lib/ansi.check.mjs
import assert from "node:assert/strict";
import { paletteColor, rgbColor, rowRuns, runStyle, tint } from "./ansi.js";

/** @param {Partial<import("./ansi.js").Run>} over */
const run = (over) => ({
  at: 0,
  end: 0,
  fg: "",
  bg: "",
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strike: false,
  ...over,
});

/** Every piece concatenated is the text that went in — nothing lost, nothing doubled. */
const joined = (pieces) => pieces.map((p) => p.text).join("");

// ── colours ─────────────────────────────────────────────────────────────────

// The low sixteen are themeable, everything above them is arithmetic.
assert.equal(paletteColor(0), "var(--ansi-0)");
assert.equal(paletteColor(15), "var(--ansi-15)");
// The cube's corners: 16 is its black, 231 its white, 196 pure red.
assert.equal(paletteColor(16), "rgb(0 0 0)");
assert.equal(paletteColor(231), "rgb(255 255 255)");
assert.equal(paletteColor(196), "rgb(255 0 0)");
// The greyscale ramp runs from near-black to near-white, and is grey the whole
// way — a channel that drifted would be the arithmetic being wrong.
assert.equal(paletteColor(232), "rgb(8 8 8)");
assert.equal(paletteColor(255), "rgb(238 238 238)");

assert.equal(rgbColor(0xff8000), "#ff8000");
// Leading zeroes have to survive, or a dark colour comes out as a short string
// that is not a colour at all.
assert.equal(rgbColor(0x0000ff), "#0000ff");
assert.equal(rgbColor(0), "#000000");

// ── style ───────────────────────────────────────────────────────────────────

// A run that says nothing writes nothing, which is what lets the common case
// render as a bare text node.
assert.equal(runStyle(run({})), "");
assert.equal(runStyle(run({ fg: "#f00" })), "color:#f00");
// Underline and strike share one property. Two declarations would mean the
// second silently won.
assert.equal(runStyle(run({ underline: true, strike: true })), "text-decoration:underline line-through");

// ── tint ────────────────────────────────────────────────────────────────────

// No runs, no offset, or no text: one plain piece, every time.
assert.deepEqual(tint("hello", 0, []), [{ text: "hello", style: "" }]);
assert.deepEqual(tint("hello", undefined, [run({ at: 0, end: 5, fg: "#f00" })]), [{ text: "hello", style: "" }]);

// A run covering the middle splits into three, in order, losing nothing.
{
  const pieces = tint("abcdef", 0, [run({ at: 2, end: 4, fg: "#f00" })]);
  assert.equal(joined(pieces), "abcdef");
  assert.deepEqual(
    pieces.map((p) => p.text),
    ["ab", "cd", "ef"],
  );
  assert.equal(pieces[1].style, "color:#f00");
  assert.equal(pieces[0].style, "");
}

// The text is a slice out of the middle of the buffer, and the run is given in
// buffer coordinates — this is the case that is wrong if the offsets are
// treated as local to the text.
{
  const pieces = tint("cdef", 2, [run({ at: 4, end: 6, fg: "#0f0" })]);
  assert.equal(joined(pieces), "cdef");
  assert.deepEqual(
    pieces.map((p) => p.text),
    ["cd", "ef"],
  );
  assert.equal(pieces[1].style, "color:#0f0");
}

// A run that starts before the text and ends inside it is clipped at both ends
// rather than being skipped or over-reaching.
{
  const pieces = tint("cdef", 2, [run({ at: 0, end: 4, fg: "#00f" })]);
  assert.deepEqual(
    pieces.map((p) => p.text),
    ["cd", "ef"],
  );
  assert.equal(pieces[0].style, "color:#00f");
}

// Runs entirely before or after the text contribute nothing at all.
assert.deepEqual(tint("cdef", 2, [run({ at: 0, end: 2, fg: "#f00" })]), [{ text: "cdef", style: "" }]);
assert.deepEqual(tint("cdef", 2, [run({ at: 6, end: 9, fg: "#f00" })]), [{ text: "cdef", style: "" }]);

// `shift` moves the runs, not the text: the block's buffer had its command line
// dropped off the front and the runs were never re-indexed for it.
{
  const pieces = tint("abcdef", 0, [run({ at: 12, end: 14, fg: "#f00" })], 10);
  assert.deepEqual(
    pieces.map((p) => p.text),
    ["ab", "cd", "ef"],
  );
  assert.equal(pieces[1].style, "color:#f00");
}

// Several runs across one line, adjacent and separated, stay in order and stay
// whole. The bisection is what this is really checking.
{
  const runs = [
    run({ at: 0, end: 2, fg: "#100" }),
    run({ at: 2, end: 4, fg: "#200" }),
    run({ at: 6, end: 8, fg: "#300" }),
  ];
  const pieces = tint("abcdefgh", 0, runs);
  assert.equal(joined(pieces), "abcdefgh");
  assert.deepEqual(
    pieces.map((p) => [p.text, p.style]),
    [
      ["ab", "color:#100"],
      ["cd", "color:#200"],
      ["ef", ""],
      ["gh", "color:#300"],
    ],
  );
}

// The bisection must not skip a run that starts before `at` — the search is for
// the first run whose *end* is past it, not the first whose start is.
{
  const runs = [run({ at: 0, end: 100, fg: "#f00" }), run({ at: 100, end: 200, fg: "#0f0" })];
  assert.equal(tint("x", 50, runs)[0].style, "color:#f00");
}

// A run with no visible attributes does not split the text around it.
assert.deepEqual(tint("abcdef", 0, [run({ at: 2, end: 4 })]), [{ text: "abcdef", style: "" }]);

// ── rowRuns ─────────────────────────────────────────────────────────────────

/**
 * A fake buffer line, written the way xterm's own would be read.
 *
 * Each spec is one *cell*: the characters it holds, its width (2 for the first
 * half of a wide glyph, 0 for the second), and a colour index or nothing. This
 * is the whole of the surface `rowRuns` uses, and building it by hand is what
 * makes the cell-versus-character question checkable without a terminal.
 *
 * @param {{ chars?: string, width?: number, fg?: number }[]} cells
 */
const line = (cells) => ({
  length: cells.length,
  getCell(x, out) {
    const c = cells[x];
    if (!c) return undefined;
    Object.assign(out, {
      _chars: c.chars ?? " ",
      _width: c.width ?? 1,
      _fg: c.fg,
    });
    return out;
  },
});

/** The reused read cell, standing in for xterm's. */
const cell = {
  getChars: () => cell._chars,
  getWidth: () => cell._width,
  isFgDefault: () => cell._fg === undefined,
  isFgRGB: () => false,
  getFgColor: () => cell._fg,
  isBgDefault: () => true,
  isBgRGB: () => false,
  getBgColor: () => 0,
  isBold: () => false,
  isDim: () => false,
  isItalic: () => false,
  isUnderline: () => false,
  isStrikethrough: () => false,
  isInverse: () => false,
};

/** @param {{ chars?: string, width?: number, fg?: number }[]} cells */
const runsOf = (cells, base = 0, len = 100) => {
  const out = [];
  rowRuns(line(cells), cell, base, len, out);
  return out;
};

const red = { fg: 1 };

// Plain text produces nothing at all — the case that has to stay free.
assert.deepEqual(runsOf([{ chars: "a" }, { chars: "b" }]), []);

// Adjacent cells of equal attributes coalesce into one run; a gap ends it.
assert.deepEqual(
  runsOf([{ chars: "a", ...red }, { chars: "b", ...red }, { chars: "c" }, { chars: "d", ...red }]).map((r) => [r.at, r.end]),
  [
    [0, 2],
    [3, 4],
  ],
);

// `base` is the row's offset into the block's text, not a column.
assert.deepEqual(runsOf([{ chars: "a", ...red }], 10).map((r) => [r.at, r.end]), [[10, 11]]);

// A wide glyph is one character over two cells. The run must cover one
// character, and everything after it must be indexed as if it were — this is
// the drift that put a colour boundary a character out on a CJK row.
{
  const runs = runsOf([{ chars: "日", width: 2, ...red }, { width: 0 }, { chars: "x", ...red }]);
  assert.deepEqual(
    runs.map((r) => [r.at, r.end]),
    [[0, 2]],
  );
  // And the same row's text is exactly two characters long, so the run ends
  // where the text does rather than a cell past it.
  assert.equal("日x".length, runs[0].end);
}

// The cell after a wide glyph, uncoloured, leaves the colour on the glyph only.
assert.deepEqual(
  runsOf([{ chars: "日", width: 2, ...red }, { width: 0 }, { chars: "x" }]).map((r) => [r.at, r.end]),
  [[0, 1]],
);

// A combining mark is the opposite case: two characters in one cell.
assert.deepEqual(
  runsOf([{ chars: "é", ...red }, { chars: "x", ...red }]).map((r) => [r.at, r.end]),
  [[0, 3]],
);

// An emoji is one cell, two code units, two cells wide — both corrections at
// once, and the surrogate pair is what `out.length` counts.
assert.deepEqual(
  runsOf([{ chars: "😀", width: 2, ...red }, { width: 0 }, { chars: "!", ...red }]).map((r) => [r.at, r.end]),
  [[0, 3]],
);

// `len` bounds the walk in character space: `translateToString` trims the row's
// trailing blanks, so a run may never reach past the text that survived.
assert.deepEqual(
  runsOf([{ chars: "a", ...red }, { chars: "b", ...red }, { chars: "c", ...red }], 0, 2).map((r) => [r.at, r.end]),
  [[0, 2]],
);

console.log("ansi.js ok");
