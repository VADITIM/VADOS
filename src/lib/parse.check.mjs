// Self-check for parse.js. Plain node, no test framework:
//   node src/lib/parse.check.mjs
import assert from "node:assert/strict";
import { parse, toMarkdown, codeSpans } from "./parse.js";

// Code nodes carry their token spans. The assertions below are about block
// *structure*, so they build the spans rather than restate them; the spans
// themselves are checked directly further down.
/** @param {string} text */
const code = (text) => ({ kind: "code", text, spans: codeSpans(text) });

// The npm help case both prose rules were written against: "Usage:" has
// several lines under it and becomes a list; "All commands:" has one and
// does not.
const npm = `npm <command>

Usage:

npm install        install all the dependencies in your project
npm install <foo>  add the <foo> dependency to your project

All commands:

    access, adduser, audit, bugs, cache, ci, completion
`;

assert.deepEqual(parse(npm), [
  // The whole command, not the `<command>` out of the middle of it.
  { kind: "text", parts: [{ code: true, text: "npm <command>" }] },
  { kind: "heading", level: 2, text: "Usage", tone: null },
  {
    kind: "list",
    items: [
      "npm install        install all the dependencies in your project",
      "npm install <foo>  add the <foo> dependency to your project",
    ],
  },
  { kind: "heading", level: 2, text: "All commands", tone: null },
  { kind: "text", parts: [{ code: false, text: "    access, adduser, audit, bugs, cache, ci, completion" }] },
]);

// A blank line after the body ends the group — the next paragraph is not
// swept into the list.
assert.deepEqual(parse("Things:\na\nb\n\ntrailing prose"), [
  { kind: "heading", level: 2, text: "Things", tone: null },
  { kind: "list", items: ["a", "b"] },
  { kind: "text", parts: [{ code: false, text: "trailing prose" }] },
]);

// A colon line with nothing under it stays plain text.
assert.deepEqual(parse("Nothing follows:"), [
  { kind: "text", parts: [{ code: false, text: "Nothing follows:" }] },
]);

// Text that merely contains a colon is not a heading.
assert.deepEqual(parse("In Zeile:1 Zeichen:1"), [
  { kind: "text", parts: [{ code: false, text: "In Zeile:1 Zeichen:1" }] },
]);

// Two or more consecutive code-shaped lines (indented, or symbol-dense)
// become a fenced code block — checked before the heading rule, so a JSON
// line ending in `:` never reads as a heading.
const diff = `diff --git a/foo.rs b/foo.rs
--- a/foo.rs
+++ b/foo.rs
@@ -1,2 +1,2 @@
-let x = 1;
+let x = 2;`;
assert.deepEqual(parse(diff), [code(diff)]);

const json = `{
  "name": "vados",
  "private": true
}`;
assert.deepEqual(parse(json), [code(json)]);

// A single code-shaped line isn't worth fencing on its own.
assert.deepEqual(parse("$ echo hi"), [
  { kind: "text", parts: [{ code: false, text: "$ echo hi" }] },
]);

// A colon with more text on the *same* line is a "single-line label". With
// no tone word it's bold prose, not a heading — so inline code still works
// on it (a heading's text does not go through inlineParts).
assert.deepEqual(parse("Usage: run with --foo"), [
  {
    kind: "text",
    bold: true,
    parts: [
      { code: false, text: "Usage: run with " },
      { code: true, text: "--foo" },
    ],
  },
]);

// A label with a warning/error/success word becomes a level-3 heading
// instead, tinted red or green — this is the one case that stays a heading.
assert.deepEqual(parse("Warning: disk almost full"), [
  { kind: "heading", level: 3, text: "Warning: disk almost full", tone: "warn" },
]);
assert.deepEqual(parse("Build succeeded:\nall targets up to date"), [
  { kind: "heading", level: 2, text: "Build succeeded", tone: "ok" },
  { kind: "text", parts: [{ code: false, text: "all targets up to date" }] },
]);

// Inline code: individual flags/paths/fn() tokens inside a prose line get
// wrapped, the surrounding words don't — and a known command takes its whole
// argument run with it rather than leaving the flag backticked on its own in
// the middle of a command nobody marked up.
assert.deepEqual(parse("run npm install --save-dev then check package.json"), [
  {
    kind: "text",
    parts: [
      { code: false, text: "run " },
      { code: true, text: "npm install --save-dev" },
      { code: false, text: " then check package.json" },
    ],
  },
]);

// The case this rule exists for: `git diff`'s own usage line. The command, its
// subcommand, its flag and its placeholders are one thing a reader recognises,
// and backticking `--no-index` out of the middle of it splits one idea in
// three. The `usage:` label carries no tone, so it stays bold prose.
assert.deepEqual(
  parse("usage: git diff --no-index [<options>] <path> <path> [<pathspec>...]"),
  [
    {
      kind: "text",
      bold: true,
      parts: [
        { code: false, text: "usage: " },
        { code: true, text: "git diff --no-index [<options>] <path> <path> [<pathspec>...]" },
      ],
    },
  ],
);

// A command with nothing after it is still a command.
assert.deepEqual(parse("try cmd instead"), [
  {
    kind: "text",
    parts: [
      { code: false, text: "try " },
      { code: true, text: "cmd" },
      { code: false, text: " instead" },
    ],
  },
]);

// ...but a tool's name at the start of a sentence is a sentence. The bare
// subcommand slot is the only place prose can leak into a command run, and it
// is the one thing about this rule that can be embarrassingly wrong.
assert.deepEqual(parse("git is not installed on this machine"), [
  {
    kind: "text",
    parts: [
      { code: true, text: "git" },
      { code: false, text: " is not installed on this machine" },
    ],
  },
]);

// A command name inside a longer word is not a command. `gitignore` and
// `npmrc` show up constantly in real output.
assert.deepEqual(parse("edit gitignore"), [
  { kind: "text", parts: [{ code: false, text: "edit gitignore" }] },
]);

// A path argument comes along; the path rule does not get to claim it first.
assert.deepEqual(parse("ran git add src/lib ok"), [
  {
    kind: "text",
    parts: [
      { code: false, text: "ran " },
      { code: true, text: "git add src/lib" },
      { code: false, text: " ok" },
    ],
  },
]);

// Line breaks bound a command run. `\s` would have let one swallow the start
// of the next line, filing text under the wrong node.
// (`commit` is a subcommand verb, and on the same line it would have been
// taken — the newline is the only thing stopping it.)
assert.deepEqual(parse("run git\ncommit the change"), [
  {
    kind: "text",
    parts: [
      { code: false, text: "run " },
      { code: true, text: "git" },
      { code: false, text: "\ncommit the change" },
    ],
  },
]);

// A URL is one token, scheme included. The path rule would otherwise start it
// at the `//`, and a trailing full stop belongs to the sentence, not the link.
assert.deepEqual(parse("see https://svelte.dev/e/a11y_no_static for why."), [
  {
    kind: "text",
    parts: [
      { code: false, text: "see " },
      { code: true, text: "https://svelte.dev/e/a11y_no_static", kind: "link" },
      { code: false, text: " for why." },
    ],
  },
]);

// A URL with a port and a path keeps both, and a `+` in a filename does not
// end the path it belongs to.
assert.deepEqual(parse("hmr update /src/routes/+page.svelte"), [
  {
    kind: "text",
    parts: [
      { code: false, text: "hmr update " },
      { code: true, text: "/src/routes/+page.svelte", kind: "path" },
    ],
  },
]);
assert.deepEqual(parse("Local: http://localhost:1420/ ready"), [
  {
    kind: "text",
    bold: true,
    parts: [
      { code: false, text: "Local: " },
      { code: true, text: "http://localhost:1420/", kind: "link" },
      { code: false, text: " ready" },
    ],
  },
]);

// A timestamp is its own kind, and a port number inside a URL is not one.
assert.deepEqual(parse("22:55:33 hmr update done"), [
  {
    kind: "text",
    parts: [
      { code: true, text: "22:55:33", kind: "time" },
      { code: false, text: " hmr update done" },
    ],
  },
]);

// The end-of-options marker is a token; a hyphen inside a word is not a flag,
// and a slash inside a word is not a path.
assert.deepEqual(parse("run cargo -- on VAD/OS with a right-click"), [
  {
    kind: "text",
    parts: [
      { code: false, text: "run " },
      // The end-of-options marker is an argument like any other, so the
      // command takes it rather than leaving it stranded on its own.
      { code: true, text: "cargo --" },
      { code: false, text: " on VAD/OS with a right-click" },
    ],
  },
]);

// toMarkdown round-trips into real markdown syntax — this is what
// shift+right-click copies.
assert.equal(
  toMarkdown(parse(npm)),
  [
    "`npm <command>`",
    "## Usage",
    "- npm install        install all the dependencies in your project\n- npm install <foo>  add the <foo> dependency to your project",
    "## All commands",
    "    access, adduser, audit, bugs, cache, ci, completion",
  ].join("\n\n"),
);

assert.equal(toMarkdown(parse(diff)), "```\n" + diff + "\n```");

assert.equal(
  toMarkdown(parse("check --verbose now")),
  "check `--verbose` now",
);

assert.equal(toMarkdown(parse("Usage: run with --foo")), "**Usage: run with `--foo`**");

// A PowerShell error record: the `+` carets and the indented `+ CategoryInfo`
// columns stay one code block, including the hard-wrapped `   n` continuation
// in the middle of it, and none of the ` : ` columns read as a label.
const ps = `+ fsd
+ ~~~
    + CategoryInfo          : ObjectNotFound: (fsd:String) [], CommandNotFoundExceptio
   n
    + FullyQualifiedErrorId : CommandNotFoundException`;
assert.deepEqual(parse(ps), [code(ps)]);

// A trailing indented continuation with no code line after it is not swallowed.
assert.deepEqual(parse("+ a\n+ b\n   tail"), [
  code("+ a\n+ b"),
  { kind: "text", parts: [{ code: false, text: "   tail" }] },
]);

// A label's bold covers the whole hard-wrapped paragraph, not just the first
// physical line; the code-shaped `+ fsd` below ends it.
assert.deepEqual(parse("fsd : Die Benennung\nwurde nicht erkannt\n+ fsd\n+ ~~~"), [
  {
    kind: "text",
    bold: true,
    parts: [{ code: false, text: "fsd : Die Benennung\nwurde nicht erkannt" }],
  },
  code("+ fsd\n+ ~~~"),
]);

// A y/n prompt (no colon) becomes bold prose so it stands out, same as a label.
// The `/N` is left alone: a slash directly after a word character is part of
// that word, not a path — the same boundary that keeps `VAD/OS` whole.
assert.deepEqual(parse("Overwrite file? (y/N)"), [
  {
    kind: "text",
    bold: true,
    parts: [{ code: false, text: "Overwrite file? (y/N)" }],
  },
]);
assert.deepEqual(parse("Continue? [Y/n]:"), [
  {
    kind: "text",
    bold: true,
    parts: [
      { code: false, text: "Continue? [Y/n]:" },
    ],
  },
]);

// ── code block token spans ──────────────────────────────────────────────────

// The `git diff --help` line the feature was asked for: the flag, the two
// placeholders, and the untinted text between them.
assert.deepEqual(codeSpans("    -U, --unified[=<n>]   generate diffs with <n> lines context"), [
  { token: null, text: "    " },
  { token: "flag", text: "-U" },
  { token: null, text: ", " },
  { token: "flag", text: "--unified" },
  { token: null, text: "[=" },
  { token: "var", text: "<n>" },
  { token: null, text: "]   generate diffs with " },
  { token: "var", text: "<n>" },
  { token: null, text: " lines context" },
]);

// A bracket group inside a flag name is part of the flag; one introducing a
// value is not, so `--stat[=<width>]` leaves `<width>` to match on its own.
assert.deepEqual(codeSpans("--[no-]color[=<when>] show colored diff"), [
  { token: "flag", text: "--[no-]color" },
  { token: null, text: "[=" },
  { token: "var", text: "<when>" },
  { token: null, text: "] show colored diff" },
]);

assert.deepEqual(codeSpans("synonym for '-p --raw'"), [
  { token: null, text: "synonym for " },
  { token: "str", text: "'-p --raw'" },
]);

// The dashes must be followed by a letter, so a diff's hunk header and its
// removed lines are not littered with false flags. `--git` is a real one.
assert.deepEqual(codeSpans("@@ -1,2 +1,2 @@"), [{ token: null, text: "@@ -1,2 +1,2 @@" }]);
assert.deepEqual(codeSpans("-let x = 1;"), [{ token: null, text: "-let x = 1;" }]);

// The invariant that keeps a block's raw bytes recoverable: concatenating
// every span reproduces the input exactly, tinted or not.
for (const sample of [diff, json, ps, npm, "plain prose with no tokens at all"]) {
  assert.equal(
    codeSpans(sample)
      .map((s) => s.text)
      .join(""),
    sample,
  );
}

// Spans are a render concern only — `copy as markdown` still emits the raw
// text inside a fence, because markdown code fences carry no inline markup.
assert.equal(toMarkdown(parse(diff)), "```\n" + diff + "\n```");

console.log("parse.js ok");
