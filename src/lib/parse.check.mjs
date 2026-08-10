// Self-check for parse.js. Plain node, no test framework:
//   node src/lib/parse.check.mjs
import assert from "node:assert/strict";
import {
  parse,
  isMarkdown,
  parseMarkdown,
  runHint,
  exitLabel,
  lineParts,
  toMarkdown,
  codeSpans,
} from "./parse.js";

// Code nodes carry their token spans. The assertions below are about block
// *structure*, so they build the spans rather than restate them; the spans
// themselves are checked directly further down.
/** @param {string} text */
const code = (text) => ({ kind: "code", text, spans: codeSpans(text) });

// The npm help case both prose rules were written against. A body under a
// heading is a list at any length — including one line, which used to stay
// prose. That length test was a rule about a finished body applied to a body
// still arriving, and it made `ping` build and destroy a node per reply.
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
  { kind: "list", items: ["access, adduser, audit, bugs, cache, ci, completion"] },
]);

// The reason it is a list at one line: growing a section must never change the
// kind of a node that is already on screen.
assert.equal(parse("Replies:\na")[1].kind, parse("Replies:\na\nb")[1].kind);

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
  { kind: "list", items: ["all targets up to date"] },
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
    "- access, adduser, audit, bugs, cache, ci, completion",
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

// ── a column table is one node ──────────────────────────────────────────────

// `Get-ChildItem`, and the reason this rule exists: `-a----` is a dash followed
// by a letter, which is a diff's deleted line, so the file rows fenced
// themselves while the `d-----` rows above them stayed prose. One table, two
// renderings, in the command people run most.
const listing = parse(
  [
    "Mode                 LastWriteTime         Length Name",
    "----                 -------------         ------ ----",
    "d-----        09.08.2026     19:50                .claude",
    "-a----        06.08.2026     17:06            414 .gitignore",
  ].join("\n"),
);
assert.equal(listing.length, 1);
assert.equal(listing[0].kind, "code");
// The header comes back out of the paragraph it had already joined.
assert.ok(listing[0].text.startsWith("Mode "));
assert.ok(listing[0].text.endsWith(".gitignore"));

// A blank line ends the table, and what follows is read normally again.
const after = parse(["a   b", "--- ---", "1   2", "", "Total: 2 files"].join("\n"));
assert.equal(after.length, 2);
assert.equal(after[0].kind, "code");
assert.equal(after[0].text, "a   b\n--- ---\n1   2");
assert.deepEqual(after[1], { kind: "text", parts: [{ code: false, text: "Total: 2 files" }] });

// One dash run is a divider, not a rule line — nothing above it is swallowed.
assert.deepEqual(
  parse(["some prose", "--------", "more prose"].join("\n")).map((n) => n.kind),
  ["text"],
);
// A diff's own `--- a/file` header has text on the line and stays a diff.
assert.equal(parse(["--- a/x.js", "+++ b/x.js", "@@ -1 +1 @@"].join("\n"))[0].kind, "code");

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

// Links, timestamps and paths inside a block, from the same shapes prose uses.
// A stack trace and a log line are where most of them actually occur.
assert.deepEqual(codeSpans("  at ./src/lib/parse.js line 12"), [
  { token: null, text: "  at " },
  { token: "path", text: "./src/lib/parse.js" },
  { token: null, text: " line 12" },
]);
// Same rule as in prose: a slash after a word character is not a path opening,
// which is what keeps `a/x.js` in a diff header and `and/or` out of it.
assert.deepEqual(codeSpans("src/lib/parse.js"), [{ token: null, text: "src/lib/parse.js" }]);
assert.deepEqual(codeSpans("12:30:01 ready"), [
  { token: "time", text: "12:30:01" },
  { token: null, text: " ready" },
]);
// A URL is matched whole: its `//` must not be cut out as a path, nor its port
// as a time.
assert.deepEqual(codeSpans("Local: http://localhost:5173/app"), [
  { token: null, text: "Local: " },
  { token: "link", text: "http://localhost:5173/app" },
]);
// A diff's `a/`-prefixed names are not paths — the slash follows a word
// character — so a diff header stays one untinted run apart from its flag.
assert.deepEqual(codeSpans("diff --git a/x.js b/x.js"), [
  { token: null, text: "diff " },
  { token: "flag", text: "--git" },
  { token: null, text: " a/x.js b/x.js" },
]);

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

// Consecutive labels are separate nodes. `git` emits one `warning:` line per
// file, and a run of them used to collapse into a single level-3 heading whose
// text carried the newlines — one node, so one label reveal over a box as tall
// as the run, which read on screen as no animation at all. A continuation line
// is the tail of a sentence and never has a label's own shape, so a line that
// does is the next label rather than more of this one.
const warnings = [
  "warning: in the working copy of 'a.md', LF will be replaced by CRLF",
  "warning: in the working copy of 'b.md', LF will be replaced by CRLF",
  "warning: in the working copy of 'c.md', LF will be replaced by CRLF",
].join("\n");
const warned = parse(warnings);
assert.equal(warned.length, 3);
assert.ok(warned.every((n) => n.kind === "heading" && n.level === 3 && n.tone === "warn"));
assert.ok(warned.every((n) => !n.text.includes("\n")));

// The case that rule must not break: a hard-wrapped error record is still one
// label, because its continuation lines do not look like labels themselves.
const wrapped = parse("error: something went wrong\n  while reading the file\n  and then gave up");
assert.equal(wrapped.length, 1);
assert.equal(wrapped[0].kind, "heading");
assert.ok(wrapped[0].text.includes("gave up"));

// A command run absorbs its own flags: `diff --git a/x b/x` is one thing a
// reader recognises, and backticking the `--git` out of the middle of it split
// one idea into three. `diff` had to join `COMMANDS` for that.
assert.deepEqual(parse("diff --git a/one.md b/one.md")[0].parts, [
  { code: true, text: "diff --git a/one.md b/one.md" },
]);

// Text that already marks itself as code is not marked again. Without the
// backtick rule the inline scanner ran *inside* the backticks and emitted
// nested markers — neither what the source said nor valid anything.
assert.deepEqual(parse("via Tauri's `path::app_config_dir()` today")[0].parts, [
  { code: false, text: "via Tauri's " },
  { code: true, text: "path::app_config_dir()" },
  { code: false, text: " today" },
]);
// The markers are consumed, never rendered as text.
for (const part of parse("a `b` c")[0].parts) assert.ok(!part.text.includes("`"));
// A pair is required and it may not cross a line, so one stray backtick in
// output cannot swallow the rest of the paragraph.
assert.deepEqual(parse("one ` two")[0].parts, [{ code: false, text: "one ` two" }]);

// A diff's context line for a blank source line is a single space, so a hunk
// has blank rows inside it. They must not end the fence — that is what split a
// hunk into two code blocks with the diff's own text stranded as prose between.
const hunk = ["@@ -1,3 +1,3 @@", "+added line", "", "+another added line"].join("\n");
assert.equal(parse(hunk).length, 1);
assert.equal(parse(hunk)[0].kind, "code");
// ...and the bridging is diff-only. The general form of the rule is wrong: it
// swallowed `npm --help`'s heading and list into one code block, which the npm
// fixture at the top of this file is the real guard against.
assert.equal(parse("one -x\n\ntwo -y").filter((n) => n.kind === "code").length, 0);

// The running hint reads the pager's own prompt first — that is evidence, and
// it works for a pager this could never have a list for.
assert.match(runHint("some diff\n:"), /^q quits/);
assert.match(runHint("some diff\n(END)"), /^q quits/);
assert.match(runHint("--More--"), /^q quits/);
assert.match(runHint("compiling\n  building [===>   ]"), /ctrl\+c/);
// A colon that is part of a line is not a pager prompt.
assert.match(runHint("note: something happened"), /ctrl\+c/);
// The prompt wins over the command: it is a reading, not a guess.
assert.match(runHint("some diff\n:", "git diff"), /space pages/);
// A command known to page says so even when nothing recognisable was drawn —
// the reported case, where `ctrl+c stops` was the one thing that would not work.
assert.match(runHint("diff --git a/x b/x", "git diff"), /^q quits the pager/);
assert.match(runHint("x", "git log --oneline"), /^q quits the pager/);
assert.match(runHint("x", "man ls"), /^q quits the pager/);
assert.match(runHint("x", "cat big.txt | less"), /^q quits the pager/);
// Told not to page, so it does not.
assert.match(runHint("diff --git a/x b/x", "git --no-pager diff"), /^running/);
assert.match(runHint("x", "git -P log"), /^running/);
// Not every git command pages, and nothing else here is a pager.
assert.match(runHint("x", "git status"), /^running/);
assert.match(runHint("x", "npm ls"), /^running/);
// `--less` is a flag, not the pager, and `blameless` is not `blame`.
assert.match(runHint("x", "cargo build --lessons"), /^running/);
assert.match(runHint("x", "git commit -m blameless"), /^running/);
// The subcommand is read in its own position, so a paged word inside a message
// or a filename is not one. `git -c core.pager=x log` still is.
assert.match(runHint("x", 'git commit -m "log the thing"'), /^running/);
assert.match(runHint("x", "git -c color.ui=always log"), /^q quits the pager/);

// A text node is rendered one element per line, because a line is what arrives
// and an element animates once, on the chunk it mounted in.
assert.deepEqual(
  lineParts([{ code: false, text: "one\ntwo" }]),
  [[{ code: false, text: "one" }], [{ code: false, text: "two" }]],
);
// A part that ends at a line break does not drag an empty part onto the next
// line, and the break itself carries no part at all.
assert.deepEqual(
  lineParts([{ code: false, text: "a\n" }, { code: true, text: "--flag" }]),
  [[{ code: false, text: "a" }], [{ code: true, text: "--flag" }]],
);
// A blank line is an empty group — the newline between groups is the caller's.
assert.deepEqual(lineParts([{ code: false, text: "a\n\nb" }]), [
  [{ code: false, text: "a" }],
  [],
  [{ code: false, text: "b" }],
]);
// Every part's own flags survive the split; only its text is cut.
assert.deepEqual(lineParts([{ code: true, text: "x\ny", kind: "path" }]), [
  [{ code: true, text: "x", kind: "path" }],
  [{ code: true, text: "y", kind: "path" }],
]);
// Past the cap the node comes back whole — one element, as before, because a
// line is a DOM element and a long file is not worth ten thousand of them.
const many = [{ code: false, text: Array.from({ length: 40 }, (_, i) => `${i}`).join("\n") }];
assert.deepEqual(lineParts(many, 10), [many]);
assert.equal(lineParts(many, 100).length, 40);

// An exit code says what happened where that is known, and is at least
// *readable* where it is not.
assert.equal(exitLabel(0), "done");
assert.equal(exitLabel(1), "exit 1 · failed");
assert.equal(exitLabel(127), "exit 127 · command not found");
assert.equal(exitLabel(130), "exit 130 · stopped (ctrl+c)");
// A plain small code stays decimal — that is the form a script tests against.
assert.equal(exitLabel(42), "exit 42");
// The case that started this: PowerShell hands back an NTSTATUS as a signed
// integer, and only the unsigned hex form can be recognised or looked up.
assert.equal(exitLabel(-1978335212), "exit 0x8a150014");
assert.equal(exitLabel(-1073741819), "exit 0xc0000005 · crashed (access violation)");
// The same value arriving unsigned must read identically.
assert.equal(exitLabel(3221225477), exitLabel(-1073741819));
assert.equal(exitLabel(-1073741510), "exit 0xc000013a · stopped (ctrl+c)");

// A very long code block is one untinted span. Each tinted token is a DOM
// element, and a whole-repo diff is tens of thousands of them for colour nobody
// reads at that length. Concatenation still reproduces the input exactly, which
// is the property the raw-bytes rule depends on.
const huge = ("--flag <var> 'str' plain\n").repeat(2000);
assert.deepEqual(codeSpans(huge), [{ token: null, text: huge }]);
assert.equal(codeSpans(huge).map((s) => s.text).join(""), huge);

// --- real markdown ---------------------------------------------------------

// Evidence, both kinds. Printing a `.md` file is the strong signal; naming one
// is not, which is why the reader command is also required — `git diff` on a
// markdown file emits a diff.
assert.ok(isMarkdown("", "cat README.md"));
assert.ok(isMarkdown("", "Get-Content .claude/tasks.md"));
assert.ok(!isMarkdown("plain", "git diff README.md"));
assert.ok(!isMarkdown("plain", "cat main.rs"));
// A closed fence, or two ATX headings with one of them nested.
assert.ok(isMarkdown("```\ncode\n```"));
assert.ok(isMarkdown("# Title\n\n## Section\n"));
// A `#`-comment file is not markdown, however many comments it has. This is the
// case that makes the bare-`#` bar too low to use on its own.
assert.ok(!isMarkdown("# install deps\nnpm install\n# build it\nnpm run build\n"));

// Read as written: no heuristic runs, so nothing is invented and nothing the
// author wrote is re-derived.
const md = ["# Title", "", "Some prose with `code` in it.", "", "- one", "- two", "", "```js", "let x = 1;", "```"].join("\n");
assert.deepEqual(parse(md, "cat notes.md"), [
  { kind: "heading", level: 2, text: "Title", tone: null },
  {
    kind: "text",
    parts: [
      { code: false, text: "Some prose with " },
      { code: true, text: "code" },
      { code: false, text: " in it." },
    ],
  },
  { kind: "list", items: ["one", "two"] },
  { kind: "code", text: "let x = 1;", spans: codeSpans("let x = 1;") },
]);

// Deeper headings collapse to level 3 — `Node` has two levels and markdown has
// six, and `#`/`##` are the document's sections.
assert.equal(parseMarkdown("### Deep")[0].level, 3);

// The heuristics are genuinely off in this mode. In shell output `right-click`
// reads as a short flag and `VAD/OS` as a path; in a markdown file they are
// prose the author typed.
assert.deepEqual(parse("## H\n\n# H2\n\nright-click in VAD/OS")[2].parts, [
  { code: false, text: "right-click in VAD/OS" },
]);

// A fence still streaming in is a fence. Waiting for its closer would make a
// `cat` of a long file flip between two layouts mid-render.
assert.equal(parse("```\nhalf a block", "cat a.md")[0].kind, "code");

console.log("parse.js ok");
