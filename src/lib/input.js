/**
 * Everything the docked input bar computes that is not DOM.
 *
 * Two features live here because they are the same computation wearing two
 * hats: a dropped file and a pressed Tab both end as *a list of texts, one of
 * which will be spliced into the shell's line editor*. The suggestion strip
 * above the bar renders that list and knows nothing about where it came from.
 *
 * Pure on purpose — no Svelte, no Tauri, no DOM — so it can be checked without
 * a browser: `node src/lib/input.check.mjs`.
 */

/**
 * A path, safe to hand to a shell as one argument.
 *
 * ponytail: the quoting style is picked from the path's own shape when the
 * caller does not know better, because the PTY does not report which shell is
 * on the other end. A Windows-shaped path gets PowerShell's rules, everything
 * else gets POSIX's. Wrong only for a POSIX-style shell on Windows (git-bash)
 * handed a `C:\` path — swap this for the real shell identity when the shell
 * registry from phase 12 exists.
 *
 * @param {string} path
 * @param {boolean} [windows] PowerShell's quoting rules rather than POSIX's.
 * @returns {string}
 */
export function quotePath(path, windows = /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\")) {
  if (!/[\s"'`$\\&|;<>()]/.test(path)) return path;
  // In PowerShell a backslash is literal inside quotes and a doubled quote is
  // the escape; in POSIX shells the backslash is the escape and would eat the
  // path separators if applied to a Windows path.
  return windows
    ? `"${path.replace(/"/g, '""').replace(/([$`])/g, "`$1")}"`
    : `"${path.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * The inverse of `quotePath`, for a path the app itself has to act on rather
 * than hand to a shell — `open <file>` is the only caller today.
 *
 * Deliberately not a shell word parser: it undoes one surrounding pair of
 * quotes and the doubled-quote escape inside it, which is what a drop or a Tab
 * completion produces and what a person types around a path with a space. A
 * line with quoting anywhere other than the ends is a sentence for the shell,
 * not a path for us.
 *
 * @param {string} text
 * @returns {string}
 */
export function unquote(text) {
  const trimmed = text.trim();
  const quote = trimmed[0];
  if ((quote !== '"' && quote !== "'") || trimmed.length < 2 || trimmed.at(-1) !== quote) {
    return trimmed;
  }
  return trimmed.slice(1, -1).replaceAll(quote + quote, quote);
}

/**
 * How a file of a given extension is run. Values are command prefixes; the
 * quoted path is appended to each. Curated rather than detected for the same
 * reason `parse.js` curates its command list: reading PATH would cover every
 * interpreter on the machine at a round trip per drop, to answer a question
 * that twenty rows answer for free.
 *
 * @type {Record<string, string[]>}
 */
const RUNNERS = {
  ps1: ["& ", "powershell -ExecutionPolicy Bypass -File "],
  bat: ["& "],
  cmd: ["& "],
  exe: ["& "],
  msi: ["& "],
  sh: ["bash ", "sh "],
  bash: ["bash "],
  zsh: ["zsh "],
  fish: ["fish "],
  py: ["python ", "python3 "],
  js: ["node "],
  mjs: ["node "],
  cjs: ["node "],
  rb: ["ruby "],
  pl: ["perl "],
  lua: ["lua "],
  php: ["php "],
};

/**
 * One line the suggestion strip can offer: the text that goes at the prompt,
 * and a word saying what it is.
 *
 * `start` is the column the text replaces *from*, for the cases where that is
 * not the token under the cursor — a whole-line history match replaces from
 * column 0. Absent means "the strip's own start", which is what every
 * token-shaped suggestion in this file wants.
 *
 * @typedef {{ text: string, hint: string, start?: number }} Suggestion
 */

/**
 * The label under a run option — the interpreter, not the whole prefix.
 *
 * @param {string} prefix
 * @returns {string}
 */
function runnerHint(prefix) {
  const head = prefix.trim().split(/\s+/)[0];
  return head === "&" ? "run" : head;
}

/**
 * @param {string} path
 * @returns {string} Lowercased, without the dot; `""` when there is none.
 */
export function extensionOf(path) {
  return (/\.([^.\\/]+)$/.exec(path) ?? ["", ""])[1].toLowerCase();
}

/**
 * What a dropped file may become, most likely first.
 *
 * Nothing here runs anything: every entry is *text placed at the prompt*. A
 * drop is an argument and what to do with it is still the user's sentence to
 * finish — accepting an option writes the line, Enter is still theirs to press.
 *
 * @param {string} path
 * @param {boolean} windows
 * @returns {Suggestion[]}
 */
export function runOptions(path, windows) {
  const quoted = quotePath(path, windows);
  /** @type {Suggestion[]} */
  const out = [];
  for (const prefix of RUNNERS[extensionOf(path)] ?? []) {
    // `& ` is PowerShell's call operator and means nothing to a POSIX shell.
    if (prefix === "& " && !windows) continue;
    out.push({ text: prefix + quoted, hint: runnerHint(prefix) });
  }
  if (windows && !out.length) out.push({ text: `& ${quoted}`, hint: "run" });
  // The everyday `chmod +x ./script.sh && ./script.sh` two-step, collapsed to
  // one selection. Windows has no exec bit, so this half is POSIX-only.
  if (!windows) out.push({ text: `chmod +x ${quoted} && ${quoted}`, hint: "chmod +x, run" });
  out.push({ text: quoted, hint: "path only" });
  out.push({ text: `cd ${quoted}`, hint: "cd" });
  return out;
}

/**
 * The word the cursor is standing in, and the column it starts at. A quoted
 * run is one word even though it contains spaces — otherwise completing a path
 * that was quoted by a previous drop replaces half of it.
 *
 * @param {string} text
 * @param {number} col
 * @returns {{ start: number, token: string }}
 */
export function tokenAt(text, col) {
  const head = text.slice(0, Math.max(0, Math.min(col, text.length)));
  let start = 0;
  let quote = "";
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") start = i + 1;
  }
  return { start, token: head.slice(start) };
}

/**
 * Split a half-typed path into the directory to list and the prefix to filter
 * by. `src/pa` lists `src` and filters on `pa`; `pa` lists the cwd.
 *
 * @param {string} token
 * @returns {{ dir: string, base: string }}
 */
export function completionRequest(token) {
  const bare = token.replace(/^["']/, "");
  const cut = Math.max(bare.lastIndexOf("/"), bare.lastIndexOf("\\"));
  return cut === -1
    ? { dir: "", base: bare }
    : { dir: bare.slice(0, cut + 1), base: bare.slice(cut + 1) };
}

/**
 * The directory a completion request actually reads.
 *
 * ponytail: `~` is passed through untouched rather than expanded — the home
 * directory is the shell's idea, not ours, and the listing simply comes back
 * empty. Expand it when the shell registry knows whose home it is.
 *
 * @param {string} cwd
 * @param {string} dir  The directory part of a half-typed path.
 * @returns {string}
 */
export function resolveDir(cwd, dir) {
  if (!dir) return cwd;
  if (/^([A-Za-z]:[\\/]|[\\/]|~)/.test(dir)) return dir;
  const windows = /^[A-Za-z]:[\\/]/.test(cwd);
  return cwd.replace(/[\\/]+$/, "") + (windows ? "\\" : "/") + dir;
}

/**
 * Directory entries filtered to what the half-typed token could still become.
 * Directories first — a completion is usually on the way somewhere.
 *
 * @param {{ name: string, dir: boolean }[]} entries
 * @param {string} base    What the user has typed of the name.
 * @param {string} dir     The directory part, carried through untouched.
 * @param {boolean} windows
 * @returns {Suggestion[]}
 */
export function completions(entries, base, dir, windows) {
  const lower = base.toLowerCase();
  const sep = windows ? "\\" : "/";
  // `..` is not in any listing and is the one directory everybody needs. Its
  // absence is why "how do I go up a folder" had no answer on screen: the only
  // way up was to already know `cd ..`. Added here rather than in `list_dir`,
  // because it is not a fact about the directory — it is a completion.
  return [{ name: "..", dir: true }, ...entries]
    .filter((entry) => entry.name.toLowerCase().startsWith(lower))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
    .map((entry) => ({
      // A trailing separator on a directory is what lets the next Tab carry on
      // into it without the user typing the slash themselves.
      text: quotePath(dir + entry.name + (entry.dir ? sep : ""), windows),
      hint: entry.dir ? "dir" : "file",
    }));
}

/**
 * Suggestions for the word being typed that come from a *list*, not from the
 * filesystem — the strip's other three sources, ranked most personal first:
 *
 *  1. **What you ran before**, whole line, newest first. The strongest signal
 *     there is: a thing this user typed at this prompt. It replaces from column
 *     0, which is why `start` exists on a `Suggestion` at all.
 *  2. **A command name**, while the first word is still being typed. This is
 *     what makes the strip exist in a fresh session, which history alone cannot
 *     — a new window has nothing to remember.
 *  3. **A subcommand verb**, on the second word of a known command.
 *
 * Paths are not here; they are `completions`, because they need a directory
 * listing and these do not. Between them they cover every position in a command
 * line, which is the thing two earlier versions of this got wrong by covering
 * only the positions the data happened to fit.
 *
 * The curated lists come from `parse.js`, which already had to know what a
 * command looks like in order to render one. Reading `PATH` instead would cover
 * every binary on the machine — see the `ponytail:` note there for why it does
 * not.
 *
 * @param {string} text     The whole typed line.
 * @param {number} col      Cursor column.
 * @param {string[]} history  Newest first.
 * @param {string[]} commands
 * @param {string[]} subcommands
 * @returns {Suggestion[]}
 */
export function wordSuggestions(text, col, history, commands, subcommands) {
  if (!text) return [];
  /** @type {Suggestion[]} */
  const lines = history
    .filter((h) => h.length > text.length && h.startsWith(text))
    .map((h) => ({ text: h, hint: "history", start: 0 }));

  const { start, token } = tokenAt(text, col);
  const space = text.indexOf(" ");
  // A trailing space is not "typing the next word" — there is no prefix to
  // complete yet, and offering the first name in a list at that point is a
  // guess rather than a completion.
  if (!token) return lines;

  let pool = /** @type {string[]} */ ([]);
  let hint = "";
  if (space === -1) {
    pool = commands;
    hint = "command";
  } else if (start === space + 1 && commands.includes(text.slice(0, space))) {
    pool = subcommands;
    hint = "verb";
  }

  const lower = token.toLowerCase();
  const seen = new Set();
  /** @type {Suggestion[]} */
  const words = [];
  for (const name of pool) {
    if (name.length <= token.length || !name.toLowerCase().startsWith(lower)) continue;
    // The subcommand list has honest duplicates — `exec`, `cp`, `ls` are each in
    // it twice because they group differently for different tools. One strip
    // entry each.
    if (seen.has(name)) continue;
    seen.add(name);
    words.push({ text: name, hint, start });
  }
  // The plain-word route, first word only: a command found by what it does
  // rather than by how it is spelled. After the name matches, because someone
  // typing `l` most likely means the name they already know.
  const byWord = space === -1 ? wordMatches(token, start) : [];
  const already = new Set(words.map((w) => w.text));
  return [...lines, ...words, ...byWord.filter((w) => !already.has(w.text))];
}

/**
 * A cwd short enough to sit in the input bar, keeping the end that says where
 * you are.
 *
 * The last three segments are the ones that carry the answer — a project, a
 * folder in it, the folder in that. Everything above them is replaced by one
 * dot each, so the depth is still on screen even though the names are not:
 * `C:/Users/vadim/source/VADOS/src/lib` becomes `..../VADOS/src/lib`.
 *
 * Only past `max`, and only when there is something to elide. A short path is
 * shown whole — the point is to stop a deep path pushing the command it is
 * standing next to off the bar, not to hide paths.
 *
 * @param {string} path
 * @param {number} [max] Length past which shortening applies.
 * @returns {string}
 */
export function shortCwd(path, max = 30) {
  if (path.length <= max) return path;
  // Kept, not normalised: the separator the shell reported is the one the user
  // would type, and rewriting it would make the bar disagree with the line.
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep);
  const KEEP = 3;
  if (parts.length <= KEEP) return path;
  return ".".repeat(parts.length - KEEP) + sep + parts.slice(-KEEP).join(sep);
}

/**
 * The plain word for a command whose name is an abbreviation, so the strip can
 * be searched with the word and still write the command.
 *
 * **Typing the word runs the command**, and that is a deliberate exception to
 * everything else here: the word is swapped for the command as the line is sent,
 * so the block records `ls` and the history remembers `ls`. Submitting `list`
 * and being told there is no such command is what the words exist to prevent,
 * and a strip nobody Tabbed through is not an answer to it. The swap is a single
 * word at the head of the line, it is visible in the block the moment it runs,
 * and `WORD_ONLY` below is where it stops.
 *
 * Only names that are genuinely abbreviations are here. `mkdir` and `unzip` say
 * what they do; a second name for them would be noise in the strip. Nothing
 * platform-specific either — `sudo` has no meaning on Windows and offering it
 * there is worse than not knowing the word.
 *
 * @type {Record<string, string[]>}
 */
export const COMMAND_WORDS = {
  ls: ["list"],
  rm: ["remove", "delete"],
  cp: ["copy"],
  mv: ["move", "rename"],
  cd: ["goto"],
  ps: ["processes"],
  df: ["disk", "free"],
  du: ["size"],
  grep: ["search", "find"],
  sed: ["replace"],
  chmod: ["permissions"],
  chown: ["owner"],
  tar: ["archive", "extract"],
  curl: ["download", "request"],
  cls: ["clear"],
  taskkill: ["kill"],
  netstat: ["ports"],
  tracert: ["trace"],
  diff: ["compare"],
};

/**
 * The word-to-command pairs, flattened once at module load rather than per
 * keystroke. Order follows the table, so the more literal word of a pair
 * ("remove" before "delete") is the one a shared prefix finds first.
 *
 * @type {{ word: string, command: string }[]}
 */
const WORD_PAIRS = Object.entries(COMMAND_WORDS).flatMap(([command, words]) =>
  words.map((word) => ({ word, command })),
);

/**
 * Words that are commands somewhere in their own right, and are therefore never
 * swapped for anything — the strip may still offer the short name beside them.
 *
 * `copy`, `move`, `rename`, `kill` and `clear` are PowerShell aliases and shell
 * builtins; `find` is a real program on both Windows and Linux, and means
 * something else on each. Rewriting a word that already runs is the one way this
 * feature could take a working line away from someone, so the rule is not "is it
 * likely to exist" but "has it ever been a command" — and when in doubt, a new
 * word goes in here rather than out of the table.
 */
const WORD_ONLY = new Set(["copy", "move", "rename", "kill", "clear", "find"]);

/**
 * The line as it will actually be sent, when its first word is a plain word for
 * a command. Empty when there is nothing to swap, which is the common case.
 *
 * Exact match only: `remove` is the word, `remo` is half of one and belongs to
 * the strip. Everything after the first word is carried through untouched — the
 * arguments are the user's and are not ours to read.
 *
 * @param {string} line The line as mirrored from the shell.
 * @returns {string}
 */
export function wordCommand(line) {
  const match = /^(\s*)(\S+)/.exec(line);
  if (!match) return "";
  const word = match[2].toLowerCase();
  if (WORD_ONLY.has(word)) return "";
  const pair = WORD_PAIRS.find((p) => p.word === word);
  if (!pair) return "";
  return match[1] + pair.command + line.slice(match[0].length);
}

/**
 * Commands found by their plain word rather than their name, for the first word
 * of a line.
 *
 * The suggestion carries the *command* as its text and the *word* as its hint,
 * which is the way round that teaches: the strip shows `rm` labelled "remove",
 * so the name is what lands on the line and what is read back next time.
 *
 * @param {string} token  What has been typed of the word.
 * @param {number} start  Column the token starts at.
 * @returns {Suggestion[]}
 */
function wordMatches(token, start) {
  const lower = token.toLowerCase();
  /** @type {Suggestion[]} */
  const out = [];
  const seen = new Set();
  for (const { word, command } of WORD_PAIRS) {
    // Already typed the command itself — there is nothing to find.
    if (command === lower || !word.startsWith(lower) || seen.has(command)) continue;
    seen.add(command);
    out.push({ text: command, hint: word, start });
  }
  return out;
}

/**
 * Move a selection by `delta`, wrapping at both ends.
 *
 * @param {number} index
 * @param {number} delta
 * @param {number} length
 * @returns {number}
 */
export function step(index, delta, length) {
  return length ? (((index + delta) % length) + length) % length : 0;
}

/**
 * Split a run of the mirrored input into selected and unselected pieces.
 *
 * `offset` is the column `text` starts at, so the caret's two halves can be
 * segmented independently against one absolute `[from, to)` range — the caret
 * sits between them and must not be swallowed by a span that crosses it.
 *
 * @param {string} text
 * @param {number} offset  Column `text` starts at within the whole input.
 * @param {number} from
 * @param {number} to
 * @returns {{ text: string, sel: boolean }[]}
 */
export function segments(text, offset, from, to) {
  if (to <= from) return text ? [{ text, sel: false }] : [];
  /** @param {number} n */
  const clamp = (n) => Math.min(Math.max(n - offset, 0), text.length);
  const a = clamp(from);
  const b = clamp(to);
  /** @type {{ text: string, sel: boolean }[]} */
  const out = [];
  if (a > 0) out.push({ text: text.slice(0, a), sel: false });
  if (b > a) out.push({ text: text.slice(a, b), sel: true });
  if (b < text.length) out.push({ text: text.slice(b), sel: false });
  return out;
}
