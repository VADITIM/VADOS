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
 * @typedef {"flag" | "var" | "str" | null} CodeToken
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
const COMMANDS = [
  "git", "gh", "npm", "npx", "pnpm", "yarn", "bun", "deno", "node",
  "cargo", "rustup", "rustc", "tauri", "tsc", "eslint", "prettier",
  "vite", "vitest", "jest", "playwright", "svelte-kit",
  "docker-compose", "docker", "kubectl", "helm", "terraform", "ansible",
  "python3", "python", "pip3", "pip", "gradle", "mvn", "dotnet",
  "ssh", "scp", "rsync", "curl", "wget", "tar", "unzip",
  "systemctl", "journalctl", "apt-get", "apt", "pacman", "yay", "paru",
  "brew", "winget", "choco", "scoop", "sudo",
  "chmod", "chown", "grep", "sed", "awk", "mkdir", "rmdir",
  "powershell", "pwsh", "cmd", "bash", "zsh", "fish",
  "robocopy", "xcopy", "tasklist", "taskkill", "ipconfig", "ifconfig",
  "netstat", "tracert", "cls", "ls", "cd", "rm", "cp", "mv", "ps", "df", "du",
].join("|");

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
const SUBCOMMANDS = [
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
].join("|");

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

const CODE_TOKEN = new RegExp(
  [
    // First: a command run absorbs its own flags and paths, so they are never
    // matched out from under it by the per-token rules below.
    COMMAND_RUN,
    /https?:\/\/\S*[\w/#=&-]/,
    // Clock time, the shape every dev server and logger stamps its lines with.
    // Ahead of the path rule so `12:30` never reads as anything else, and after
    // the URL rule so a port number stays part of its URL.
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/,
    /(?<![\w-])--(?![\w-])/,
    /(?<![\w-])--?[A-Za-z][\w-]*/,
    // `+` is in the class because SvelteKit's route files are named `+page`,
    // `+layout` — without it a path stopped one character short of the filename
    // it was pointing at.
    /(?<!\w)(?:~|\.{1,2})?\/[\w./+-]+/,
    /[A-Za-z]:\\[\w\\.-]+/,
    /\b[A-Za-z_]\w*\(\)/,
    /\b\w+=[\w./-]+\b/,
  ]
    .map((r) => r.source)
    .join("|"),
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

/** @param {string} text @returns {TextPart[]} */
function inlineParts(text) {
  /** @type {TextPart[]} */
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(CODE_TOKEN)) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
    // The key is left off entirely for a plain code token rather than set to
    // null: every part is compared structurally in the self-check, and a key
    // that is present-but-empty is noise in every one of those expectations.
    const kind = inlineKind(m[0]);
    parts.push(kind ? { code: true, text: m[0], kind } : { code: true, text: m[0] });
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
const CODE_SPAN = new RegExp(
  [
    /(?<flag>(?<![\w-])(?:--(?:\[[\w-]+\])?[A-Za-z][\w-]*(?:\[[\w-]+\][\w-]*)*|-[A-Za-z](?![\w-])))/.source,
    /(?<var><[^<>\s]+>)/.source,
    /(?<str>'[^'\n]*'|"[^"\n]*")/.source,
  ].join("|"),
  "g",
);

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
  /** @type {CodeSpan[]} */
  const spans = [];
  let last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    if (m.index > last) spans.push({ token: null, text: text.slice(last, m.index) });
    const groups = /** @type {Record<string, string | undefined>} */ (m.groups ?? {});
    const token = /** @type {CodeToken} */ (
      groups.flag ? "flag" : groups.var ? "var" : groups.str ? "str" : null
    );
    spans.push({ token, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ token: null, text: text.slice(last) });
  return spans.length ? spans : [{ token: null, text }];
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
      // An indented non-blank line inside a run is a wrapped continuation of
      // the line above (PowerShell hard-wraps its error records mid-word), so
      // it keeps the run alive instead of splitting it in two. Trailing
      // continuations that no code line follows are given back.
      let lastCode = -1;
      while (
        j < lines.length &&
        (isCodeLine(lines[j]) || (codeLines.length > 0 && /^\s+\S/.test(lines[j])))
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
    const label = plain.length === 0 ? /^\s*([^\n:]+:\s+\S.*)$/.exec(line) : null;
    if (label) {
      flush();
      // The label runs to the end of its paragraph, not the end of its
      // physical line — PowerShell hard-wraps a single error record across
      // several lines, and only bolding the first one splits it visually. A
      // blank line or a code-shaped line ends it.
      const rest = [];
      let k = i + 1;
      while (k < lines.length && lines[k].trim() !== "" && !isCodeLine(lines[k])) rest.push(lines[k++]);
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
