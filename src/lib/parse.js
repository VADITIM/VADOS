/**
 * Turns raw command output into structured nodes for the block renderer.
 *
 * Rendered as real DOM, not as a markdown string. Command output is arbitrary
 * text — converting it to markup and parsing it back is exactly the injection
 * surface Phase 3 flagged, and Svelte escapes text nodes for free.
 *
 * Rules, deliberately narrow (see .claude/docs/tasks.md for the rest):
 *   - 2+ consecutive code-shaped lines (see `isCodeLine`) become a fenced
 *     code block — checked first, so a JSON blob's `"key": "value"` line
 *     never gets mistaken for a heading
 *   - a line ending in `:` with nothing after it is a **level-2** heading;
 *     the lines under it are its body, terminated by a blank line (one blank
 *     line directly after the heading is allowed, because `npm` puts one
 *     there); a body of 2+ lines becomes a list, a single line stays prose
 *   - a line with a colon **and text after it on the same line**
 *     (`Usage: run with --foo`, `Warning: disk almost full`) is a
 *     "single-line label". If its text carries a tone (warning/error/success
 *     word — see `tone`), it becomes a **level-3 heading**, whole line, no
 *     separate body. If it doesn't, it becomes **bold prose** instead — a
 *     heading with no color signal reads like a label, not a section, and
 *     bold prose still goes through `inlineParts` so `--flags` inside it
 *     still get backticked, which a heading's plain text does not
 *   - inside prose, individual code-shaped tokens (flags, paths, `fn()`,
 *     `key=value`) become inline code — same shape test as the block rule,
 *     just applied per-token instead of per-line
 *
 * @typedef {"warn" | "ok" | null} Tone
 * @typedef {{ code: boolean, text: string }} TextPart
 * @typedef {{ kind: "heading", level: 2 | 3, text: string, tone: Tone }
 *          | { kind: "list", items: string[] }
 *          | { kind: "code", text: string }
 *          | { kind: "text", parts: TextPart[], bold?: boolean }} Node
 */

const WARN_WORD = /\b(warning|error|fail(?:ed|ure)?|fatal)\b/i;
const OK_WORD = /\b(success(?:ful)?|succeeded|done|passed|ok)\b/i;

/** @param {string} text @returns {Tone} */
function tone(text) {
  if (WARN_WORD.test(text)) return "warn";
  if (OK_WORD.test(text)) return "ok";
  return null;
}

// Shape, not language: this never tries to know *what* language a block is,
// only whether a line reads as code rather than prose. Cheap and already
// right for diffs, stack traces, JSON, `tree` output.
const SHELL_PROMPT = /^[$>]\s/;
// unified-diff line markers: `diff --git`, `--- a/`, `+++ b/`, `@@ -1,2 +1,2 @@`,
// and the leading +/- on changed lines. None of these are symbol-dense enough
// to trip the density check below on their own.
const DIFF_LINE = /^(diff --git |--- |\+\+\+ |@@ |[+-](?!\+|-))/;
const SYMBOLS = /[{}()[\];:,"=<>|&$`]/g;

/** @param {string} line */
function isCodeLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\s{4,}\S/.test(line) || line.startsWith("\t")) return true;
  if (SHELL_PROMPT.test(trimmed) || DIFF_LINE.test(trimmed)) return true;
  const symbols = (trimmed.match(SYMBOLS) || []).length;
  return symbols > 0 && symbols / trimmed.length > 0.15;
}

// Same shape test, applied per-token instead of per-line: CLI flags, paths
// (unix and Windows), `fn()` calls, `key=value` pairs. Matches never cross a
// line break since none of the character classes include \n.
const CODE_TOKEN =
  /(--?[A-Za-z][\w-]*|(?:~|\.{1,2})?\/[\w./-]+|[A-Za-z]:\\[\w\\.-]+|\b[A-Za-z_]\w*\(\)|\b\w+=[\w./-]+\b)/g;

/** @param {string} text @returns {TextPart[]} */
function inlineParts(text) {
  /** @type {TextPart[]} */
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(CODE_TOKEN)) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
    parts.push({ code: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts.length ? parts : [{ code: false, text }];
}

/**
 * @param {string} buffer
 * @returns {Node[]}
 */
export function parse(buffer) {
  const lines = buffer.split("\n");
  /** @type {Node[]} */
  const nodes = [];
  /** @type {string[]} */
  let plain = [];

  const flush = () => {
    // Strip blank lines around the segment, but never leading indentation on
    // a content line — ASCII art and column alignment depend on it.
    const text = plain.join("\n").replace(/^\n+|\s+$/g, "");
    if (text) nodes.push({ kind: "text", parts: inlineParts(text) });
    plain = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isCodeLine(line)) {
      let j = i;
      /** @type {string[]} */
      const codeLines = [];
      while (j < lines.length && isCodeLine(lines[j])) codeLines.push(lines[j++]);
      if (codeLines.length > 1) {
        flush();
        nodes.push({ kind: "code", text: codeLines.join("\n") });
        i = j - 1;
        continue;
      }
      // A single code-shaped line isn't worth a fence on its own — falls
      // through to plain/heading handling below, same as any other line.
    }

    // Single-line label: colon followed by more text on the *same* line, e.g.
    // "Usage: run with --foo" or "Warning: disk almost full". Mutually
    // exclusive with the section-header regex below by construction — that
    // one requires the colon to be the last non-space character.
    const label = /^\s*([^\n:]+:\s+\S.*)$/.exec(line);
    if (label) {
      flush();
      const text = label[1].trim();
      const t = tone(text);
      if (t) {
        nodes.push({ kind: "heading", level: 3, text, tone: t });
      } else {
        nodes.push({ kind: "text", parts: inlineParts(text), bold: true });
      }
      continue;
    }

    if (!/^\s*\S.*:\s*$/.test(line)) {
      plain.push(line);
      continue;
    }

    let j = i + 1;
    if (lines[j]?.trim() === "") j++;
    /** @type {string[]} */
    const body = [];
    while (j < lines.length && lines[j].trim() !== "") body.push(lines[j++]);

    // A colon line with nothing under it is just a line that ends in a colon.
    if (body.length === 0) {
      plain.push(line);
      continue;
    }

    flush();
    const headingText = line.trim().replace(/:$/, "");
    nodes.push({ kind: "heading", level: 2, text: headingText, tone: tone(headingText) });
    if (body.length > 1) {
      nodes.push({ kind: "list", items: body.map((l) => l.trim()) });
    } else {
      nodes.push({ kind: "text", parts: inlineParts(body[0]) });
    }
    i = j - 1;
  }

  flush();
  return nodes;
}

/**
 * Renders parsed nodes back out as real markdown syntax, for "copy as .md".
 * @param {Node[]} nodes
 * @returns {string}
 */
export function toMarkdown(nodes) {
  return nodes
    .map((n) => {
      if (n.kind === "heading") return `${"#".repeat(n.level)} ${n.text}`;
      if (n.kind === "list") return n.items.map((i) => `- ${i}`).join("\n");
      if (n.kind === "code") return `\`\`\`\n${n.text}\n\`\`\``;
      const text = n.parts.map((p) => (p.code ? `\`${p.text}\`` : p.text)).join("");
      return n.bold ? `**${text}**` : text;
    })
    .join("\n\n");
}
