/**
 * The colour a program gave its own output, mapped onto the text the parser
 * produced.
 *
 * Two halves, and they meet at an offset. The block renderer reads runs of
 * equally-attributed cells out of xterm's buffer; the parser marks every run of
 * text with where it started in that same buffer (`locate` in parse.js). This
 * file is what puts them together — given a run of rendered text and where it
 * came from, which pieces of it were coloured and how.
 *
 * **The program's colour wins.** Where a program said nothing, the parser's
 * shape-derived tint fills in, which is the whole of the block renderer today.
 * Where the program did say something, that is the answer: it knows what its
 * own output means and the heuristics are a stand-in for not having been told.
 *
 * @typedef {{
 *   at: number, end: number,
 *   fg: string, bg: string,
 *   bold: boolean, dim: boolean, italic: boolean, underline: boolean, strike: boolean
 * }} Run
 * @typedef {{ text: string, style: string }} Piece
 */

/** The six levels the 216-colour cube is built from. */
const CUBE = [0, 95, 135, 175, 215, 255];

/**
 * A palette index as a CSS colour.
 *
 * The low sixteen go through tokens rather than literals, so a theme can move
 * them — those are the sixteen a program means when it says "red", and what
 * red *is* belongs to the token layer. The 216-colour cube and the greyscale
 * ramp above it are arithmetic and are the same in every terminal there has
 * ever been, so they are computed.
 *
 * @param {number} i @returns {string}
 */
export function paletteColor(i) {
  if (i < 16) return `var(--ansi-${i})`;
  if (i < 232) {
    const n = i - 16;
    return `rgb(${CUBE[Math.floor(n / 36)]} ${CUBE[Math.floor(n / 6) % 6]} ${CUBE[n % 6]})`;
  }
  const v = 8 + (i - 232) * 10;
  return `rgb(${v} ${v} ${v})`;
}

/** A 24-bit colour as a hex string. @param {number} rgb @returns {string} */
export function rgbColor(rgb) {
  return `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/**
 * A run's CSS. Empty when the run says nothing worth writing, so the common
 * case costs no attribute and no element.
 *
 * Underline and strike go on `text-decoration` together — two declarations for
 * one property means the second wins and a struck underlined word loses its
 * underline.
 *
 * @param {Run} run @returns {string}
 */
export function runStyle(run) {
  const out = [];
  if (run.fg) out.push(`color:${run.fg}`);
  if (run.bg) out.push(`background:${run.bg}`);
  if (run.bold) out.push("font-weight:600");
  // Dim is opacity rather than a dimmer colour: the colour may be the theme's,
  // and a value computed from it here would not move when the theme did.
  if (run.dim) out.push("opacity:0.65");
  if (run.italic) out.push("font-style:italic");
  const line = [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean);
  if (line.length) out.push(`text-decoration:${line.join(" ")}`);
  return out.join(";");
}

/**
 * The index of the first run that could overlap `at`, by bisection.
 *
 * Linear would be fine for one call and this is called once per rendered run of
 * text, against every run in the block — a `--help` dump is thousands of both.
 *
 * @param {Run[]} runs @param {number} at @returns {number}
 */
function firstFrom(runs, at) {
  let lo = 0;
  let hi = runs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (runs[mid].end <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Split `text` into styled pieces, given that it starts at `at` in the buffer
 * the runs were measured against.
 *
 * Returns a single unstyled piece when nothing overlaps, which is the answer
 * for almost every run of text in almost every block — so the caller can render
 * a bare text node and add no element at all.
 *
 * `shift` is how far the block's buffer was moved after the runs were taken:
 * the echoed command line is dropped from the front of a block's text and the
 * runs are not re-indexed for it, because re-indexing every run on every chunk
 * is quadratic over a long command and one subtraction here is not.
 *
 * @param {string} text @param {number | undefined} at @param {Run[]} runs @param {number} [shift]
 * @returns {Piece[]}
 */
export function tint(text, at, runs, shift = 0) {
  const plain = [{ text, style: "" }];
  if (at === undefined || !runs.length || !text) return plain;
  const end = at + text.length;
  /** @type {Piece[]} */
  const pieces = [];
  let cut = at;
  for (let i = firstFrom(runs, at + shift); i < runs.length; i++) {
    const run = runs[i];
    const from = Math.max(at, run.at - shift);
    const to = Math.min(end, run.end - shift);
    if (from >= end) break;
    if (to <= from) continue;
    const style = runStyle(run);
    if (!style) continue;
    if (from > cut) pieces.push({ text: text.slice(cut - at, from - at), style: "" });
    pieces.push({ text: text.slice(from - at, to - at), style });
    cut = to;
  }
  if (!pieces.length) return plain;
  if (cut < end) pieces.push({ text: text.slice(cut - at), style: "" });
  return pieces;
}
