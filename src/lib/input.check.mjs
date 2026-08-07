// Self-check for input.js. Plain node, no test framework:
//   node src/lib/input.check.mjs
import assert from "node:assert/strict";
import {
  completionRequest,
  completions,
  quotePath,
  resolveDir,
  runOptions,
  segments,
  step,
  tokenAt,
} from "./input.js";

// ── quoting ────────────────────────────────────────────────────────────────
// A path with nothing to escape is left alone: quoting everything makes the
// mirrored line unreadable for the common case.
assert.equal(quotePath("C:\\src\\a.ps1", true), '"C:\\src\\a.ps1"'); // backslash forces quotes
assert.equal(quotePath("script.sh", false), "script.sh");
assert.equal(quotePath("my script.sh", false), '"my script.sh"');
// PowerShell doubles the quote and backticks `$`; POSIX backslashes both, and
// must never backslash-escape a Windows separator.
assert.equal(quotePath('a"b c', true), '"a""b c"');
assert.equal(quotePath("a$b c", true), '"a`$b c"');
assert.equal(quotePath("a$b c", false), '"a\\$b c"');

// ── dropped-file run options ───────────────────────────────────────────────
const ps1 = runOptions("C:\\src\\deploy.ps1", true);
assert.equal(ps1[0].text, '& "C:\\src\\deploy.ps1"');
assert.equal(ps1[0].hint, "run");
// Every option is text for the prompt — nothing here is a shell invocation on
// its own, which is the whole safety property of the menu.
assert.ok(ps1.every((o) => typeof o.text === "string" && o.text.length));
// The bare path is always offered, so a drop can still be just an argument.
assert.ok(ps1.some((o) => o.hint === "path only" && o.text === '"C:\\src\\deploy.ps1"'));

// The call operator is PowerShell's and must not leak onto POSIX.
assert.ok(!runOptions("/home/v/run.sh", false).some((o) => o.text.startsWith("& ")));
// The exec-bit two-step is POSIX-only for the same reason, in reverse.
const sh = runOptions("/home/v/run.sh", false);
assert.equal(sh[0].text, "bash /home/v/run.sh");
assert.ok(sh.some((o) => o.text === "chmod +x /home/v/run.sh && /home/v/run.sh"));
assert.ok(!runOptions("C:\\a.bat", true).some((o) => o.text.startsWith("chmod")));

// An unknown extension on Windows still gets one run form; on POSIX the
// chmod line covers it, so no `&` is invented.
assert.ok(runOptions("C:\\notes.txt", true).some((o) => o.text === '& "C:\\notes.txt"'));

// ── the token under the cursor ─────────────────────────────────────────────
assert.deepEqual(tokenAt("git ch", 6), { start: 4, token: "ch" });
// The cursor mid-line completes what is behind it, not the whole line.
assert.deepEqual(tokenAt("git checkout", 6), { start: 4, token: "ch" });
// An empty word is a legitimate request: list everything.
assert.deepEqual(tokenAt("git ", 4), { start: 4, token: "" });
// A quoted run is one word. Without this, completing a path a previous drop
// quoted replaces from the space *inside* the quotes and mangles it.
assert.deepEqual(tokenAt('cat "my fi', 10), { start: 4, token: '"my fi' });

// ── which directory a half-typed path asks for ─────────────────────────────
assert.deepEqual(completionRequest("pa"), { dir: "", base: "pa" });
assert.deepEqual(completionRequest("src/pa"), { dir: "src/", base: "pa" });
assert.deepEqual(completionRequest("src\\lib\\pa"), { dir: "src\\lib\\", base: "pa" });
// The opening quote belongs to the shell syntax, not to the name being matched.
assert.deepEqual(completionRequest('"my fi'), { dir: "", base: "my fi" });

assert.equal(resolveDir("C:\\src\\VADOS", ""), "C:\\src\\VADOS");
assert.equal(resolveDir("C:\\src\\VADOS", "lib\\"), "C:\\src\\VADOS\\lib\\");
assert.equal(resolveDir("/home/v", "lib/"), "/home/v/lib/");
// Absolute stays absolute — joining it onto the cwd is how a completion ends
// up reading a directory that does not exist.
assert.equal(resolveDir("/home/v", "/etc/"), "/etc/");
assert.equal(resolveDir("C:\\src", "D:\\tmp\\"), "D:\\tmp\\");

// ── completions ────────────────────────────────────────────────────────────
const entries = [
  { name: "README.md", dir: false },
  { name: "routes", dir: true },
  { name: "run me.sh", dir: false },
  { name: "src", dir: true },
];
const all = completions(entries, "r", "", false);
// Directories first, then alphabetical — a completion is usually on the way
// somewhere, and the match set is filtered case-insensitively.
assert.deepEqual(all.map((c) => c.text), ["routes/", "README.md", '"run me.sh"']);
assert.deepEqual(all.map((c) => c.hint), ["dir", "file", "file"]);
// The directory prefix is carried through, or accepting a completion would
// throw away the part of the path the user already typed.
assert.equal(completions(entries, "s", "src/", false)[0].text, "src/src/");
// Quoted, because a Windows separator is one of the characters that forces
// quoting — and a trailing `\` inside PowerShell's double quotes is literal,
// so the next Tab can strip the quote and carry on into the directory.
assert.equal(completions(entries, "s", "src\\", true)[0].text, '"src\\src\\"');
assert.deepEqual(completions(entries, "zz", "", false), []);

// ── selection wrapping ─────────────────────────────────────────────────────
assert.equal(step(0, -1, 3), 2);
assert.equal(step(2, 1, 3), 0);
assert.equal(step(0, 1, 0), 0); // an empty menu has no selection to move

// ── selected text segmentation ─────────────────────────────────────────────
// No selection is one plain run; an empty string is no runs at all, so the
// template never emits an empty span.
assert.deepEqual(segments("git status", 0, 0, 0), [{ text: "git status", sel: false }]);
assert.deepEqual(segments("", 0, 0, 0), []);
// A range inside the run splits into three.
assert.deepEqual(segments("git status", 0, 4, 10), [
  { text: "git ", sel: false },
  { text: "status", sel: true },
]);
// The caret splits the line into two runs at `cursorCol`, and each is
// segmented against the same absolute range — the halves must not both claim
// the same columns, or the selection paints twice as wide as it is.
assert.deepEqual(segments("git ", 0, 2, 8), [
  { text: "gi", sel: false },
  { text: "t ", sel: true },
]);
assert.deepEqual(segments("status", 4, 2, 8), [
  { text: "stat", sel: true },
  { text: "us", sel: false },
]);
// A range entirely past the run contributes nothing to it.
assert.deepEqual(segments("git", 0, 8, 12), [{ text: "git", sel: false }]);

console.log("input.check.mjs OK");
