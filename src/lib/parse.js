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
 *   - a **whole command** is one inline code run, not just its name and not
 *     just the flag out of the middle of it: a known command (see `COMMANDS`),
 *     an optional known subcommand verb, and every argument-shaped token after
 *     them. `git diff --no-index [<options>] <path>` is one thing a reader
 *     recognises, and marking up three fragments of it splits one idea
 *
 *   - inside a code block, three token *shapes* are tinted: CLI flags,
 *     `<placeholder>`s, and quoted strings. Colour only — see `codeSpans`
 *
 * @typedef {"warn" | "ok" | null} Tone
 * @typedef {"link" | "path" | "time" | null} InlineKind
 * @typedef {{ code: boolean, text: string, kind?: InlineKind }} TextPart
 * @typedef {"flag" | "var" | "str" | "link" | "time" | "path" | null} CodeToken
 * @typedef {{ token: CodeToken, text: string }} CodeSpan
 * @typedef {{ kind: "heading", level: 2 | 3, text: string, tone: Tone }
 *          | { kind: "list", items: string[] }
 *          | { kind: "code", text: string, spans: CodeSpan[] }
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

/**
 * A single-line label: a colon with text after it on the same line, e.g.
 * `Usage: run with --foo` or `warning: disk almost full`. Used twice — to find
 * one, and to know where the one before it has to stop.
 */
const LABEL_LINE = /^\s*([^\n:]+:\s+\S.*)$/;
// unified-diff line markers: `diff --git`, `--- a/`, `+++ b/`, `@@ -1,2 +1,2 @@`,
// and the leading +/- on changed lines. None of these are symbol-dense enough
// to trip the density check below on their own.
const DIFF_LINE = /^(diff --git |--- |\+\+\+ |@@ |[+-](?!\+|-))/;
const SYMBOLS = /[{}()[\];:,"=<>|&$`]/g;
/**
 * The rule line under a table's header — `----   -------------   ------ ----`.
 * Two or more dash runs and nothing else, so a single `-----` used as a divider
 * stays a divider and a diff's `--- a/file` stays a diff.
 */
const TABLE_RULE = /^\s*-{2,}(?: +-{2,})+\s*$/;

/** @param {string} line */
function isCodeLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\s{4,}\S/.test(line) || line.startsWith("\t")) return true;
  if (SHELL_PROMPT.test(trimmed) || DIFF_LINE.test(trimmed)) return true;
  const symbols = (trimmed.match(SYMBOLS) || []).length;
  return symbols > 0 && symbols / trimmed.length > 0.15;
}

// Same shape test, applied per-token instead of per-line: URLs, CLI flags,
// paths (unix and Windows), `fn()` calls, `key=value` pairs. Matches never
// cross a line break since none of the character classes include \n.
//
// Order and boundaries are the whole difficulty here, and both were wrong in
// ways that showed:
//
//  - The URL alternative has to come first. The path rule matches from a `/`,
//    so `https://example.com` was tinted from `//example.com` on and the
//    scheme was left as prose. A URL ends on a word-ish character so trailing
//    sentence punctuation stays outside it.
//  - A flag needs a boundary in front of its dash, or the `-click` in
//    `right-click` reads as a short flag. Same for the path rule's `/`, which
//    read the `/OS` in `VAD/OS` as a path.
//  - A bare `--` is the end-of-options marker and is a token in its own right.
//    Requiring a letter after the dashes meant the one in `cargo run --` was
//    the only part of the line left untinted.
/**
 * Commands common enough that a reader recognises them as a command on sight.
 * Curated, not exhaustive, and deliberately excluding anything that is also an
 * ordinary English word (`make`, `find`, `go`, `type`, `echo`, `which`) —
 * those are the ones that turn a sentence in a program's output into a fake
 * command. Adding one is a row here and nothing else.
 *
 * Longer names come before the prefixes they contain (`apt-get` before `apt`),
 * since alternation takes the first match that fits.
 */
export const COMMAND_NAMES = [
  "git", "gh", "npm", "npx", "pnpm", "yarn", "bun", "deno", "node",
  "cargo", "rustup", "rustc", "tauri", "tsc", "eslint", "prettier",
  "vite", "vitest", "jest", "playwright", "svelte-kit",
  "docker-compose", "docker", "kubectl", "helm", "terraform", "ansible",
  "python3", "python", "pip3", "pip", "gradle", "mvn", "dotnet",
  "ssh", "scp", "rsync", "curl", "wget", "tar", "unzip",
  "systemctl", "journalctl", "apt-get", "apt", "pacman", "yay", "paru",
  "brew", "winget", "choco", "scoop", "sudo",
  "chmod", "chown", "grep", "sed", "awk", "mkdir", "rmdir", "diff",
  "powershell", "pwsh", "cmd", "bash", "zsh", "fish",
  "robocopy", "xcopy", "tasklist", "taskkill", "ipconfig", "ifconfig",
  "netstat", "tracert", "cls", "ls", "cd", "rm", "cp", "mv", "ps", "df", "du",
];

const COMMANDS = COMMAND_NAMES.join("|");

/**
 * Subcommand verbs, as a whitelist rather than a list of English words to
 * exclude. This is the one place prose can leak into a command run — "git is
 * not installed", "cmd instead" — and a program's own error text starts with a
 * tool's name constantly, so the leak is not hypothetical.
 *
 * A blacklist was tried first and is the wrong shape: the set of English words
 * that can follow a tool name is open, and every miss reads as a bug. The set
 * of verbs tools actually use for subcommands is small, closed enough, and
 * shared across almost all of them. A subcommand not listed here degrades to
 * the command name alone plus separately-tinted flags — worse, never wrong.
 */
export const SUBCOMMAND_NAMES = [
  "install", "uninstall", "add", "remove", "rm", "update", "upgrade", "sync",
  "run", "exec", "start", "stop", "restart", "build", "rebuild", "test",
  "dev", "serve", "preview", "watch", "check", "lint", "format", "fmt",
  "clippy", "doc", "bench", "clean", "publish", "pack", "link", "unlink",
  "init", "new", "create", "generate", "migrate", "deploy", "release",
  "commit", "push", "pull", "fetch", "clone", "checkout", "switch", "branch",
  "merge", "rebase", "stash", "tag", "diff", "log", "logs", "status", "show",
  "blame", "bisect", "reset", "revert", "restore", "cherry-pick", "worktree",
  "submodule", "config", "remote", "apply", "plan", "destroy", "describe",
  "get", "set", "list", "ls", "search", "info", "why", "audit", "cache",
  "login", "logout", "version", "help", "images", "compose", "ps", "up",
  "down", "exec", "cp", "mv",
];

const SUBCOMMANDS = SUBCOMMAND_NAMES.join("|");

/**
 * A single command argument: a flag, a `<placeholder>`, an `[optional]` group,
 * a path, a `key=value`, or a URL. Everything a usage line is made of and
 * nothing that a sentence is — which is what stops the run below from eating
 * the rest of the line.
 */
const COMMAND_ARG = [
  /--?[\w-]+(?:\[[\w-]+\])?[\w-]*(?:=\S+)?/,
  /<[^<>\s]+>/,
  /\[[^\][\s]*\]/,
  /https?:\/\/\S*[\w/#=&-]/,
  /(?:[~.]{0,2}\/[\w./+-]+)/,
  // A bare relative path — `src/lib`, `docs/api.md`. Only inside a command run,
  // never as a token on its own: the general path rule refuses these on purpose
  // (it would read the `/OS` in `VAD/OS` as a path), and the only reason it is
  // safe here is that everything in this list is already an argument to a
  // command that has been matched.
  /[\w.-]+\/[\w./+-]*/,
  /[A-Za-z]:\\[\w\\.-]+/,
  /\w+=[\w./-]+/,
]
  .map((r) => r.source)
  .join("|");

// A whole command, not just its name. `git diff --no-index [<options>] <path>`
// is one thing a reader recognises, and backticking only the `--no-index` out
// of the middle of it splits one idea into three.
//
// The shape: a known command name, then at most one known subcommand verb,
// then any run of argument-shaped tokens.
//
// `[ \t]` and never `\s`, here and in every rule in this file: `\s` matches a
// newline, and a token that crosses a line break lands in the wrong node.
//
// ponytail: a curated list, not detection. Reading `PATH` or asking the shell
// what is executable would cover every command instead of eighty of them, and
// costs a round trip per render to tell `git` from `gti`.
const COMMAND_RUN = new RegExp(
  String.raw`(?<![\w-])(?:${COMMANDS})(?![\w-])` +
    String.raw`(?:[ \t]+(?:${SUBCOMMANDS})(?![\w-]))?` +
    String.raw`(?:[ \t]+(?:${COMMAND_ARG}))*`,
);

// The three shapes that mean the same thing wherever they appear — in a
// sentence, in a fenced block, in a diff. Written once and spent by both
// `CODE_TOKEN` (prose) and `CODE_SPAN` (inside a block), because a path that
// reads as a path in one and as nothing in the other is the parser
// contradicting itself.
const LINK = /https?:\/\/\S*[\w/#=&-]/.source;
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\b/.source;
// `+` is in the class because SvelteKit's route files are named `+page`,
// `+layout` — without it a path stopped one character short of the filename it
// was pointing at. The Windows arm is second so a drive letter is not read as
// the tail of something else.
const PATH = /(?<!\w)(?:~|\.{1,2})?\/[\w./+-]+|[A-Za-z]:\\[\w\\.-]+/.source;

const CODE_TOKEN = new RegExp(
  [
    // Text that already marks itself as code. A pair of backticks is the one
    // piece of markdown this parser reads in plain output, and it is read for a
    // defensive reason rather than a decorative one: without it the rules below
    // ran *inside* an already-backticked run and produced nested markers —
    // `` `path::`app_config_dir()`` `` — which is neither what the source said
    // nor valid anything. A pair is required, and it may not cross a line, so a
    // stray backtick in output cannot swallow the rest of a paragraph.
    // The backticks are consumed with the match; `inlineParts` hands back only
    // what was between them.
    /`[^`\n]+`/.source,
    // Then: a command run absorbs its own flags and paths, so they are never
    // matched out from under it by the per-token rules below.
    COMMAND_RUN.source,
    LINK,
    // Clock time, the shape every dev server and logger stamps its lines with.
    // Ahead of the path rule so `12:30` never reads as anything else, and after
    // the URL rule so a port number stays part of its URL.
    TIME,
    /(?<![\w-])--(?![\w-])/.source,
    /(?<![\w-])--?[A-Za-z][\w-]*/.source,
    PATH,
    /\b[A-Za-z_]\w*\(\)/.source,
    /\b\w+=[\w./-]+\b/.source,
  ].join("|"),
  "g",
);

/**
 * Which of the shapes above a match turned out to be. Read back off the matched
 * text rather than from a named capture group: the alternatives are written to
 * be read as a list, and naming seven groups to use three costs more than these
 * three tests. Anything else is inline code with no further meaning attached.
 *
 * @param {string} text @returns {InlineKind}
 */
function inlineKind(text) {
  if (/^https?:\/\//.test(text)) return "link";
  if (/^\d{1,2}:\d{2}/.test(text)) return "time";
  if (/^(?:[~.]{0,2}\/|[A-Za-z]:\\)/.test(text)) return "path";
  return null;
}

/**
 * @param {string} text
 * @param {RegExp} [re] Which shapes count as code. Defaults to the shape
 *   heuristics; markdown passes its own, much narrower, set.
 * @returns {TextPart[]}
 */
function inlineParts(text, re = CODE_TOKEN) {
  /** @type {TextPart[]} */
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
    // The key is left off entirely for a plain code token rather than set to
    // null: every part is compared structurally in the self-check, and a key
    // that is present-but-empty is noise in every one of those expectations.
    // A backticked run keeps its contents and loses its markers: the backticks
    // were the source saying "this is code", and the chip the renderer draws
    // says the same thing without them.
    const token = m[0].startsWith("`") ? m[0].slice(1, -1) : m[0];
    const kind = inlineKind(token);
    parts.push(kind ? { code: true, text: token, kind } : { code: true, text: token });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts.length ? parts : [{ code: false, text }];
}

// Token shapes inside a code block. Shape, not language — same principle as
// `isCodeLine`: this never decides what language a block is, only which runs of
// characters read as a flag, a placeholder, or a quoted string. Those three
// carry the same meaning in `git diff --help`, a shell script, and a Rust
// error, which is why they are worth tinting and keywords are not.
//
//  - flag: `-p`, `--patch`, `--[no-]color`. A **single** dash takes exactly
//    one letter and nothing word-like after it, which is what short flags
//    actually look like (`-p`, `-U`, `-z`) and what keeps a removed diff line
//    (`-let x = 1;`) from reading as one — the case the self-check caught.
//    A double dash takes a long name. Bracket groups are only absorbed when
//    they hold word characters, so `--stat[=<width>]` yields the flag
//    `--stat` and leaves `<width>` to be matched as a placeholder in its own
//    right.
//  - var: `<n>`, `<path>`, `<param1>`. No whitespace inside, so a stray `<`
//    in prose cannot swallow the rest of a line.
//  - str: single or double quoted, non-greedy, never crossing a line break.
//  - link, time, path: the same three shapes prose gets, from the same sources.
//    A block is where most of them actually occur — a stack trace is paths, a
//    log is timestamps — and leaving them flat there meant the one place the
//    reader is scanning for a filename was the one place it was not marked.
//
// Order is precedence: a URL absorbs the `//` and the colon that the path and
// time rules would otherwise cut it apart at, so it goes first.
const CODE_SPAN = new RegExp(
  [
    `(?<link>${LINK})`,
    `(?<time>${TIME})`,
    /(?<flag>(?<![\w-])(?:--(?:\[[\w-]+\])?[A-Za-z][\w-]*(?:\[[\w-]+\][\w-]*)*|-[A-Za-z](?![\w-])))/.source,
    /(?<var><[^<>\s]+>)/.source,
    /(?<str>'[^'\n]*'|"[^"\n]*")/.source,
    `(?<path>${PATH})`,
  ].join("|"),
  "g",
);

/** Longest code block that still gets its tokens tinted. See `codeSpans`. */
const CODE_SPAN_MAX = 20000;

/**
 * Split a code block into tinted and untinted runs.
 *
 * Returns spans rather than a marked-up string, for the same reason the rest of
 * this file does: the renderer builds real DOM from them and never re-parses
 * anything. Concatenating every `text` reproduces the input exactly, which is
 * what keeps the block's raw bytes recoverable.
 *
 * @param {string} text
 * @returns {CodeSpan[]}
 */
export function codeSpans(text) {
  // ponytail: past this, the block is one untinted span.
  //
  // Tinting is per token, and a token is a DOM element — a whole-repo `git
  // diff` is one code node of several hundred kilobytes, which is tens of
  // thousands of elements for colour on flags nobody is reading at that
  // length. The block still renders, still scrolls, still copies; it is only
  // uncoloured. Raise this the day a real virtualised renderer lands and the
  // element count stops being paid all at once.
  if (text.length > CODE_SPAN_MAX) return [{ token: null, text }];
  /** @type {CodeSpan[]} */
  const spans = [];
  let last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    if (m.index > last) spans.push({ token: null, text: text.slice(last, m.index) });
    // Exactly one alternative can have matched, so the group that is defined is
    // the kind. Read by name rather than by a chain of ternaries so adding a
    // shape to `CODE_SPAN` is one line there and none here.
    const groups = /** @type {Record<string, string | undefined>} */ (m.groups ?? {});
    const token = /** @type {CodeToken} */ (
      Object.keys(groups).find((name) => groups[name] !== undefined) ?? null
    );
    spans.push({ token, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ token: null, text: text.slice(last) });
  return spans.length ? spans : [{ token: null, text }];
}

// ---------------------------------------------------------------------------
// Real markdown.
//
// Everything above this line is *guessing* — it reads structure out of the
// shape of shell output, because shell output carries no structure of its own.
// A markdown file does. Running the guesser over it is strictly worse than
// reading what it says: `Note: see below` becomes a heading the author never
// wrote, `right-click` becomes a CLI flag, and a fence the author *did* write
// gets re-derived from symbol density instead of being read.
//
// So when the source is genuinely markdown, none of the heuristics run. The
// syntax is the evidence and it is taken at face value.

/** A `.md`-ish path, ending at whitespace or a quote/punctuation boundary. */
const MD_FILE = /\.(?:md|markdown|mdx)(?=$|["'\s:,)\]])/i;
/**
 * A command that prints a file rather than operating on one. Required in
 * addition to the path: `git diff README.md` names a `.md` file and its output
 * is a diff, not markdown.
 */
const MD_READER = /(?:^|[|;&]\s*)\s*(?:cat|bat|type|head|tail|more|less|glow|mdcat|Get-Content|gc)\b/i;

const ATX = /^ {0,3}(#{1,6})[ \t]+(\S.*?)[ \t]*#*$/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const MD_BULLET = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;

/**
 * Is this really markdown?
 *
 * Two kinds of evidence, both deliberately hard to trip by accident:
 *
 *  - the command printed a `.md` file — the strongest signal there is, and the
 *    reason it also has to be a *reader* command is that naming a file is not
 *    the same as printing one;
 *  - the text itself clears a high bar: a closed fence, or two ATX headings of
 *    which at least one is `##` or deeper. Bare `#` alone is not enough — a
 *    shell script or Dockerfile is nothing but `# comment` lines, and every one
 *    of them would otherwise read as a level-1 heading.
 *
 * @param {string} buffer
 * @param {string} [command] The command line that produced it.
 */
export function isMarkdown(buffer, command = "") {
  if (MD_FILE.test(command) && MD_READER.test(command)) return true;
  let fences = 0;
  let headings = 0;
  let deep = false;
  for (const line of buffer.split("\n")) {
    if (FENCE.test(line)) fences++;
    const h = ATX.exec(line);
    if (h) {
      headings++;
      if (h[1].length > 1) deep = true;
    }
  }
  return fences >= 2 || (headings >= 2 && deep);
}

/**
 * Markdown's own inline code: a backtick pair, and nothing else. None of the
 * flag/path/command shapes above apply here — in markdown, code is code because
 * the author said so.
 */
const MD_INLINE = /`[^`\n]+`|https?:\/\/\S*[\w/#=&-]/g;

/**
 * Reads markdown as written. Same nodes as `parse`, so the renderer, the
 * clipboard and the export path do not know which one produced them.
 *
 * ponytail: block constructs only — headings, fences, lists, paragraphs.
 * Emphasis, tables, and `[label](url)` stay literal text, because `Node` has no
 * part shape that carries them. Add them to `Node` first if they matter.
 *
 * @param {string} buffer
 * @returns {Node[]}
 */
export function parseMarkdown(buffer) {
  const lines = buffer.split("\n");
  /** @type {Node[]} */
  const nodes = [];
  /** @type {string[]} */
  let para = [];

  const flush = () => {
    const text = para.join("\n").trim();
    if (text) nodes.push({ kind: "text", parts: inlineParts(text, MD_INLINE) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE.test(line)) {
      flush();
      // Closed by its own marker, or by the end of the buffer — a fence still
      // streaming in is a fence, and refusing to render it until its closer
      // arrives would make a `cat` of a long file flicker between two layouts.
      const marker = line.trim().slice(0, 3);
      /** @type {string[]} */
      const body = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(marker)) body.push(lines[j++]);
      const text = body.join("\n");
      if (text) nodes.push({ kind: "code", text, spans: codeSpans(text) });
      i = j;
      continue;
    }

    const h = ATX.exec(line);
    if (h) {
      flush();
      // `Node` has two heading levels and markdown has six. `#`/`##` are the
      // document's sections; anything deeper is a label within one.
      nodes.push({
        kind: "heading",
        level: h[1].length <= 2 ? 2 : 3,
        text: h[2],
        tone: tone(h[2]),
      });
      continue;
    }

    if (MD_BULLET.test(line)) {
      flush();
      /** @type {string[]} */
      const items = [];
      let j = i;
      for (let m; j < lines.length && (m = MD_BULLET.exec(lines[j])); j++) items.push(m[1].trim());
      nodes.push({ kind: "list", items });
      i = j - 1;
      continue;
    }

    if (line.trim() === "") flush();
    else para.push(line);
  }

  flush();
  return nodes;
}

/**
 * @param {string} buffer
 * @param {string} [command] The command line that produced this output. Only
 *   used as evidence that the output is a markdown file being printed.
 * @returns {Node[]}
 */
export function parse(buffer, command = "") {
  if (isMarkdown(buffer, command)) return parseMarkdown(buffer);
  return parseShellOutput(buffer);
}

/** @param {string} buffer @returns {Node[]} */
function parseShellOutput(buffer) {
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

    // A column table is one thing, and every rule below it would have taken it
    // for several. `Get-ChildItem` is the case that showed it: a mode string
    // like `-a----` is a `-` followed by a letter, which is exactly a diff's
    // deleted line, so the file rows became a fenced diff while the directory
    // rows above them — `d-----`, not diff-shaped — stayed prose with their
    // timestamps tinted. One listing, rendered two ways, in the command people
    // run most.
    //
    // The rule line is the evidence and it is hard to trip by accident: two or
    // more runs of dashes with nothing else on the line. Everything under it up
    // to a blank line is the table, and the header directly above it comes back
    // out of the paragraph it had already been added to.
    if (TABLE_RULE.test(line)) {
      /** @type {string[]} */
      const rows = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") rows.push(lines[j++]);
      if (rows.length) {
        const header = plain.length && plain[plain.length - 1].trim() ? plain.pop() : null;
        flush();
        const text = [...(header === null ? [] : [header]), line, ...rows].join("\n");
        nodes.push({ kind: "code", text, spans: codeSpans(text) });
        i = j - 1;
        continue;
      }
    }

    if (isCodeLine(line)) {
      let j = i;
      /** @type {string[]} */
      const codeLines = [];
      // An indented non-blank line inside a run is a wrapped continuation of
      // the line above (PowerShell hard-wraps its error records mid-word), so
      // it keeps the run alive instead of splitting it in two. Trailing
      // continuations that no code line follows are given back.
      let lastCode = -1;
      while (
        j < lines.length &&
        (isCodeLine(lines[j]) ||
          (codeLines.length > 0 && /^\s+\S/.test(lines[j])) ||
          // A blank line inside a **diff** does not end it. A diff's context
          // line for a blank source line is a single space, so a hunk has blank
          // rows in the middle of it — and without this the hunk header and its
          // body became two separate fences with the diff's own text stranded as
          // prose between them.
          //
          // Restricted to diffs, and to diff lines on *both* sides, because the
          // general form of this rule is wrong: `npm --help` opens with a usage
          // line, a blank line, then `Usage:`, and bridging that swallowed a
          // heading and a list into one code block. The self-check caught it,
          // which is the entire reason that case is in there.
          (codeLines.length > 0 &&
            lines[j].trim() === "" &&
            DIFF_LINE.test(codeLines[codeLines.length - 1]) &&
            DIFF_LINE.test(lines[j + 1] ?? "")))
      ) {
        if (isCodeLine(lines[j])) lastCode = codeLines.length;
        codeLines.push(lines[j++]);
      }
      codeLines.length = lastCode + 1;
      if (codeLines.length > 1) {
        flush();
        const codeText = codeLines.join("\n");
        nodes.push({ kind: "code", text: codeText, spans: codeSpans(codeText) });
        i += codeLines.length - 1;
        continue;
      }
      // A single code-shaped line isn't worth a fence on its own — falls
      // through to plain/heading handling below, same as any other line.
      // (Load-bearing: `Usage:` is symbol-dense enough to land here, and
      // still has to reach the heading rule.)
    }

    // y/n prompt: question mark followed by a (y/n)-style hint, e.g.
    // "Overwrite file? (y/N)" or "Continue? [Y/n]:". No colon required, so it
    // has to be checked before the label/heading rules below, which key off
    // colons and would otherwise swallow it as plain prose.
    const ynPrompt = /^\s*(.+\?\s*[[(][YyNn]\/[YyNn][\])]:?)\s*$/.exec(line);
    if (ynPrompt) {
      flush();
      nodes.push({ kind: "text", parts: inlineParts(ynPrompt[1]), bold: true });
      continue;
    }

    // Single-line label: colon followed by more text on the *same* line, e.g.
    // "Usage: run with --foo" or "Warning: disk almost full". Mutually
    // exclusive with the section-header regex below by construction — that
    // one requires the colon to be the last non-space character.
    // `plain.length === 0` is the paragraph test: a label is only a label when
    // it *starts* one. Mid-run it is just a line that happens to contain a
    // colon, and treating it as a label split one continuous run into two
    // nodes — which renders as a paragraph break that the output never had, and
    // exports as a blank line the source never had.
    const label = plain.length === 0 ? LABEL_LINE.exec(line) : null;
    if (label) {
      flush();
      // The label runs to the end of its paragraph, not the end of its
      // physical line — PowerShell hard-wraps a single error record across
      // several lines, and only bolding the first one splits it visually. A
      // blank line or a code-shaped line ends it.
      //
      // So does another label. A continuation line is the *tail* of a sentence
      // and does not start one, so a line with a label's own shape is a new
      // label rather than more of this one. Without that test, `git`'s twelve
      // `warning: …` lines became a single twelve-row level-3 heading: one
      // node, one tone, one label reveal sweeping a box twelve rows tall, which
      // is why it read as having no animation at all. Twelve warnings are
      // twelve things, and the renderer can only stagger what the parser
      // separates.
      const rest = [];
      let k = i + 1;
      while (
        k < lines.length &&
        lines[k].trim() !== "" &&
        !isCodeLine(lines[k]) &&
        !LABEL_LINE.test(lines[k])
      )
        rest.push(lines[k++]);
      i = k - 1;
      const text = [label[1], ...rest].join("\n").trim();
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
    // A body is a list at any length, including one.
    //
    // It used to be prose until it had two lines, and that was a rule about how
    // a finished body looks, applied to a body that is still arriving. `ping`
    // prints a heading and then one reply per second: the first reply rendered
    // as prose, the second turned the pair into a list, and the prose node was
    // destroyed to build it — an entry appearing and vanishing on screen every
    // time the section grew. A rule whose answer depends on how much has
    // arrived so far cannot be used on live output.
    nodes.push({ kind: "list", items: body.map((l) => l.trim()) });
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
      // A link goes out as a markdown autolink, not backticked: backticks would
      // make it the one token that renders as a link on screen and as dead code
      // in the file the user pasted it into.
      const text = n.parts
        .map((p) => (p.kind === "link" ? `<${p.text}>` : p.code ? `\`${p.text}\`` : p.text))
        .join("");
      return n.bold ? `**${text}**` : text;
    })
    .join("\n\n");
}

/**
 * ponytail: past this many lines a text node is rendered as one element again.
 * A line is a DOM element and an entry in the reveal's registry, and a `cat` of
 * a long file is one text node — the cap keeps that from becoming ten thousand
 * of each for an animation nobody is watching at that length.
 */
const LINE_MAX = 400;

/**
 * A text node's parts, regrouped one array per line.
 *
 * **The line is what arrives, so the line has to be what animates.** An element
 * animates once, on the chunk it mounted in; a whole paragraph rendered as one
 * element therefore animates when its *first* line lands and every line after
 * that appears with nothing. That is the same fault the reveal had on `<ul>`
 * (QUIRKS.md §20) in its other form: streaming plain output — a loop printing a
 * number a second — grows one element instead of adding new ones.
 *
 * Newlines are dropped from the parts and belong to the caller, which puts them
 * back between the groups: the text is inside a `<pre>`, so the break has to be
 * a real character and not a margin.
 *
 * Past `max` lines the whole node comes back as a single group, which is the
 * one-element rendering this replaced — see `LINE_MAX`.
 *
 * @param {TextPart[]} parts
 * @param {number} [max]
 * @returns {TextPart[][]}
 */
export function lineParts(parts, max = LINE_MAX) {
  /** @type {TextPart[][]} */
  const lines = [[]];
  for (const part of parts) {
    const pieces = part.text.split("\n");
    for (let i = 0; i < pieces.length; i++) {
      if (i) lines.push([]);
      // An empty piece is the line break itself — the break is carried by the
      // new group, so there is nothing to add to it.
      if (pieces[i]) lines[lines.length - 1].push({ ...part, text: pieces[i] });
    }
  }
  return lines.length > max ? [parts] : lines;
}

/**
 * A pager invoked by name, at the start of the line or after a pipe. `man` and
 * `bat` are here because they *are* a pager as far as the keyboard is
 * concerned, whatever they run underneath.
 */
const PAGER_CMD = /(?:^|[|;&]\s*)\s*(?:less|more|most|man|bat)\b/i;
/**
 * `git` subcommands that page by default. Not exhaustive and does not need to
 * be: a missing one falls back to the honest generic hint, and a wrong one is
 * still true about `ctrl+c`.
 */
const GIT_PAGED =
  /^\s*git\s+(?:-\S+\s+|\S+=\S+\s+)*(?:diff|log|show|blame|reflog|branch|tag|help)\b/i;
/** The two ways to tell `git` not to page, both of which settle it. */
const GIT_NO_PAGER = /--no-pager|\s-P(?=\s|$)/;

/**
 * What to tell the reader about the command that is still running, shown where
 * the result line goes once it finishes.
 *
 * **The program's own prompt is the strong evidence and is read first.** `less`
 * parks on `:` or `(END)`, `more` on `--More--`; a pager that is waiting has
 * drawn the thing it is waiting with, and that is true however it was invoked —
 * including piped into from something this could never have a list for.
 *
 * **The command line is the weak second signal, and it is here because the
 * first one missed the commonest case.** `git diff` was reported showing
 * `ctrl+c stops` while `less` had the keyboard, which is the exact advice that
 * does not work: `less` ignores an interrupt and only answers `q`. Whatever the
 * pager drew there, it did not reach this function, so a command that is
 * *known* to page now says so on its own. Ranked below the prompt because it is
 * a guess about a program's behaviour rather than a reading of it, and worded
 * to stay true if the guess is wrong — `ctrl+c` is still named.
 *
 * The fallback is the one thing that is true of every running command.
 *
 * @param {string} buffer The block's raw text so far.
 * @param {string} [command] The command line that produced it.
 * @returns {string}
 */
export function runHint(buffer, command = "") {
  const lines = buffer.split("\n");
  let tail = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "") {
      tail = lines[i].trim();
      break;
    }
  }
  // `:` on its own is `less` waiting, and `:` followed by nothing but the
  // cursor is the same row mid-keystroke. `(END)` is `less` at the bottom of
  // the file, which is where a reader is most likely to be looking for the way
  // out — it is the state that produces "how do I get my prompt back".
  if (tail === ":" || /^\(END\)$/i.test(tail) || /^--More--/.test(tail)) {
    return "q quits · space pages · / searches";
  }
  if (PAGER_CMD.test(command) || (GIT_PAGED.test(command) && !GIT_NO_PAGER.test(command))) {
    return "q quits the pager · ctrl+c stops";
  }
  return "running · ctrl+c stops";
}

/**
 * What a non-zero exit code meant, where anyone knows.
 *
 * Two numbering schemes reach this line and neither is readable raw. A shell
 * reports a killed process as `128 + signal`, and Windows reports a crashed one
 * as an NTSTATUS — a 32-bit value that arrives through PowerShell as a *signed*
 * integer, which is where `exit -1978335212` comes from. It is the same number
 * as `0x8A150014` and only one of those two forms can be looked up or
 * recognised.
 *
 * So: a name when the code is one of the handful that actually recur, hex
 * whenever the value is not a plain small number, and the raw value always
 * present in one form or the other. Nothing is invented — an unknown code says
 * only what it is, because a wrong guess about why a program died is worse than
 * no guess.
 *
 * @param {number} code
 * @returns {string}
 */
export function exitLabel(code) {
  if (code === 0) return "done";
  // NTSTATUS and HRESULT values have the high bit set, so they arrive negative.
  // Read back as unsigned, which is the form they are documented and searched
  // in.
  const unsigned = code >>> 0;
  const known = EXIT_MEANINGS[unsigned];
  // A plain small number is already the thing a shell script would test against
  // — `if ($LASTEXITCODE -eq 1)` — so it stays decimal. Anything wider is a
  // status word and reads as hex or not at all.
  const shown = code > 0 && code <= 255 ? `${code}` : `0x${unsigned.toString(16)}`;
  return known ? `exit ${shown} · ${known}` : `exit ${shown}`;
}

/**
 * The codes worth naming, keyed unsigned. Curated rather than exhaustive: these
 * are the ones that come back from ordinary use — a command that was
 * interrupted, one that crashed, one that was never there.
 *
 * `128 + n` is the POSIX convention for "killed by signal n" and PowerShell's
 * native commands inherit it on Linux; the `0xC…` values are the Windows
 * equivalents of the same events.
 */
const EXIT_MEANINGS = /** @type {Record<number, string>} */ ({
  1: "failed",
  126: "not executable",
  127: "command not found",
  129: "hung up",
  130: "stopped (ctrl+c)",
  131: "quit",
  137: "killed",
  139: "crashed (segfault)",
  143: "terminated",
  0xc0000005: "crashed (access violation)",
  0xc000001d: "crashed (illegal instruction)",
  0xc000008e: "crashed (divide by zero)",
  0xc0000135: "missing DLL",
  0xc0000142: "DLL init failed",
  0xc000013a: "stopped (ctrl+c)",
  0xc0000374: "crashed (heap corruption)",
  0xc00000fd: "crashed (stack overflow)",
  0xc0000409: "crashed (stack buffer overrun)",
});
