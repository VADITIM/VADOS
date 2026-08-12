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
 * @typedef {import("@xterm/xterm").IBufferLine} IBufferLine
 * @typedef {import("@xterm/xterm").IBufferCell} IBufferCell
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
 * Append the coloured runs of one buffer row to `runs`, in the coordinates of a
 * row whose text starts at `base`.
 *
 * Only runs that say something are recorded. Default-attribute text — nearly
 * all of it — costs one comparison per cell and produces nothing, which is what
 * keeps `tint` returning a bare text node for almost every line.
 *
 * **Cells are counted, characters are indexed.** A run has to line up with the
 * row's *text*, and the two are not the same length: a CJK glyph or an emoji is
 * one character over two cells, and a combining mark is two characters in one.
 * `translateToString` emits the cell's characters, so walking the same
 * characters here is what keeps a colour boundary on the boundary. `len` bounds
 * the walk in character space for the same reason — it is measured against the
 * row's text, so a run can never claim more of it than there is.
 *
 * @param {IBufferLine} line @param {IBufferCell} cell the reused read cell
 * @param {number} base @param {number} len @param {Run[]} runs
 */
export function rowRuns(line, cell, base, len, runs) {
  /** The run being accumulated, still open. */
  let open;
  /** Where the walk has got to in the row's *text*. */
  let ci = 0;
  for (let x = 0; x < line.length && ci < len; x++) {
    if (!line.getCell(x, cell)) break;
    // A cell of width 0 is the second half of a wide glyph. It carries no
    // characters of its own and `translateToString` skips it, so it must not
    // advance the character index — and extending the open run over it is
    // right, where starting a new one would split every wide character in two.
    if (cell.getWidth() === 0) continue;
    // An empty cell is a space in the row's text, so it is still one character.
    const n = cell.getChars().length || 1;
    const at = base + ci;
    ci += n;
    const fgSet = !cell.isFgDefault();
    const bgSet = !cell.isBgDefault();
    const inverse = !!cell.isInverse();
    if (!fgSet && !bgSet && !cell.isBold() && !cell.isDim() && !cell.isItalic() && !cell.isUnderline() && !cell.isStrikethrough() && !inverse) {
      open = undefined;
      continue;
    }
    const fg = fgSet ? (cell.isFgRGB() ? rgbColor(cell.getFgColor()) : paletteColor(cell.getFgColor())) : "";
    const bg = bgSet ? (cell.isBgRGB() ? rgbColor(cell.getBgColor()) : paletteColor(cell.getBgColor())) : "";
    /** @type {Run} */
    const next = {
      at,
      end: at + n,
      // Reverse video is resolved here rather than at paint time: which two
      // values are being swapped is a fact about the cell, and the cell is only
      // in hand now. What the *unset* side falls back to stays a token, so a
      // reverse-video run still follows the theme the way the raw view does.
      fg: inverse ? bg || "var(--surface-base)" : fg,
      bg: inverse ? fg || "var(--text)" : bg,
      bold: !!cell.isBold(),
      dim: !!cell.isDim(),
      italic: !!cell.isItalic(),
      underline: !!cell.isUnderline(),
      strike: !!cell.isStrikethrough(),
    };
    if (
      open &&
      open.end === next.at &&
      open.fg === next.fg &&
      open.bg === next.bg &&
      open.bold === next.bold &&
      open.dim === next.dim &&
      open.italic === next.italic &&
      open.underline === next.underline &&
      open.strike === next.strike
    ) {
      open.end = next.end;
      continue;
    }
    runs.push((open = next));
  }
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
