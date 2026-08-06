# Phase 8 — Markdown Engine

**Status: not started.** Continues [phase-3-block-renderer.md](phase-3-block-renderer.md), which shipped the hand-rolled parser this phase either extends or replaces.

This is the phase that decides whether the project is a prettier terminal or a different one. Everything after it (rich media, export, split view, themes) consumes what this phase produces.

## Scope

1. Decide the renderer: keep extending `src/lib/parse.js` or move to a real markdown parser.
2. Add the classifier — declared / detected / raw — that decides whether a block renders as a document at all.
3. Render incrementally while a command is still running, without re-parsing the whole buffer per chunk.
4. Interactive code blocks: copy, and run.
5. Collapsible sections, with stack traces as the first real case.

## The renderer decision

`src/lib/parse.js` currently implements six rules by hand (see the open question in [../tasks.md](../tasks.md)). The reason it exists is not that markdown parsers are unavailable — it is that it emits **structured nodes**, which Svelte renders as escaped text, so command output can never be interpreted as markup. That property is non-negotiable ([../decisions.md](../decisions.md)).

Requirements on any replacement:

- Emits an **AST**, not an HTML string. `marked` and `markdown-it` both hand back HTML by default; both can be driven token-first, and that is the only acceptable mode. `mdast` via `remark` is AST-native and the better structural fit.
- **Incremental or cheap enough to look incremental.** See the streaming section below.
- Bundle cost is real — this ships in a desktop app that is competing on memory.

`parse.js` does something no general parser will: it reads **shape**, not markdown syntax. `npm`'s `Usage:` line is not markdown and never will be, but it is a heading, and the whole value proposition is that plain command output becomes structured. A general markdown parser handles the case where a program *emits* markdown. It does nothing for the case where a program emits ordinary text that happens to have shape.

**Likely answer, to be confirmed by building it:** both. A real parser for the declared-markdown path (an LLM's output, a `--format=md` flag), and the shape parser for the detected path. They produce the same node types, so downstream code sees one AST either way. Committing to only one of them is the thing to avoid.

## The classifier

Three ways a block ends up rendering as a document, in priority order:

**Declared.** The program says so. Cheapest and most reliable. Two mechanisms:
- An **OSC sequence** wrapping the output, in the OSC 133 spirit — one private-use marker for "the following is markdown". Programs opt in with an `echo`. Costs nothing when unused, and degrades to invisible in other terminals.
- An **env var** VAD/OS exports into the shell (`VADOS=1` plus a version), so a program can detect the terminal and choose its own output format. This is how `NO_COLOR` and `TERM_PROGRAM` are already used; it is the path that gets third-party tools to cooperate without a spec nobody reads.

**Detected.** The output looks like a document with high confidence. The bar is deliberately high — a false positive silently corrupts what the user asked to see, and a false negative costs nothing but plainness. Signals worth trusting: a fenced code block with a language tag, an ATX heading run, a pipe table with an alignment row. Signals not worth trusting alone: a single `*`, a leading `-`, a line ending in `:`.

**Raw.** Default. Everything else.

The classifier is one function with one test file. Every misfire reported becomes a case in it.

## Streaming

Re-parsing the whole buffer on every 8 KB read is the naive version and it is O(n²) over a long command. Two constraints from [../docs/PERFORMANCE.md](../docs/PERFORMANCE.md): the parse must not sit in the keystroke path, and a fast producer must not be able to make the UI fall behind.

Approach:

- **Parse only from the last stable boundary.** A blank line at the end of the already-parsed region is a safe restart point for a line-based parser; nothing before it can be changed by bytes arriving after it. Fenced code is the exception — an unterminated fence swallows everything after it, so the boundary must be *before* an open fence, not inside one.
- **Coalesce.** Parse on a frame budget, not per chunk. The stream can deliver twenty chunks in one frame; that is one parse.
- **Classify once, on the first meaningful chunk, and stay decided.** A block that starts rendering as markdown must not flip to raw mid-output — reflowing an entire block under the reader is worse than being wrong about it.

Existing open question in [../tasks.md](../tasks.md) — incremental versus on-complete — is resolved by the above **only if** the boundary logic holds under fenced code. If it does not, on-complete rendering with a raw live view until then is the correct fallback, and it is what the live `<pre>` container already does.

## Interactive code blocks

A fenced code block gains two affordances:

- **Copy.** Copies the code, not the fence, not the language tag, not the block chrome. Straightforward; the clipboard path already exists (right-click copy, `src/routes/+page.svelte`).
- **Run.** Writes the code to the PTY as if typed.

Run is where the care goes. Rules:

- **Never auto-run. Never one-click-run without confirmation.** Command output is untrusted input; a block rendered from `cat README.md` of a cloned repo is attacker-controlled. A code block that runs on click is a remote code execution primitive with a nice animation.
- **The confirmation shows the exact text that will be sent**, including trailing newline, and it is the text, not a summary of it.
- **Multi-line code does not become multiple commands silently.** Sending a newline runs a line. Either send one line at a time with explicit confirmation per line, or refuse multi-line and offer copy instead. Prefer refusing.
- Language tags that are obviously not shell (`python`, `json`, `rust`) get copy only. Run is offered for shell-shaped fences and nothing else.

## Collapsible sections

Folding is the first thing that makes long output better rather than prettier.

- **Any heading node folds**, taking its body with it. Uniform rule, no special cases.
- **Stack traces fold by default**, collapsed to the first frame plus a count. This is the case that pays for the feature: a Node or Python traceback is thirty lines of which two matter.
- Detecting a stack trace is per-runtime pattern matching (`at Foo (file:line)`, `File "x", line N`, `thread 'main' panicked at`, PowerShell's `+ CategoryInfo` / `+ FullyQualifiedErrorId`). Start with the runtimes actually in use; do not build a framework for it.
- Fold state is per block and does not survive a session. Persisting it needs a session store that does not exist yet, and nobody has asked for one.
- **Folding must not fight the reveal animation.** A block folding while its typewriter reveal is in flight has to kill the tween, not queue behind it — [../docs/ANIMATION.md](../docs/ANIMATION.md) cleanup rules apply.

## Verify

- `git diff` renders raw. No asterisk, underscore, or `#` in a diff is ever treated as markup.
- `ls` renders raw.
- A file of real markdown printed with `cat` renders as a document.
- A program emitting the declaration marker renders as a document regardless of content shape.
- A 5000-line stream stays interactive while parsing; keystroke latency holds the budget in [../docs/PERFORMANCE.md](../docs/PERFORMANCE.md).
- Toggling a rendered block back to raw produces the exact original bytes, character for character.
- A code block containing `rm -rf ~` cannot be executed without a confirmation showing that text.

## Gotchas to watch

- **ANSI and markdown collide.** Output can be both coloured and structured. The AST needs to carry inline colour spans, or colour is dropped on the markdown path — and dropping it silently is a regression from a plain terminal.
- **The shape parser's false positives are the whole risk.** Every rule that fires on plain output is a bug report waiting to happen. Prefer a rule that misses to a rule that overreaches.
- **Do not let the classifier depend on the shell.** A PowerShell error record and a bash stderr line are both "an error"; the classifier must not grow a per-shell branch. If it needs one, the detector is matching the wrong thing.
- **Fold state and virtualization interact.** When scrollback virtualization lands, a folded block that scrolls out and back must come back folded.
