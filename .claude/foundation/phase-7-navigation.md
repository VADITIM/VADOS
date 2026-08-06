# Phase 7 — Navigation & Shortcuts

**Status: not started.** Last phase — each item depends on earlier work.

## Original plan

- **`open <file>`** — resolve the editor from config or `$EDITOR`, shell out to it. A few lines.
- **cwd file panel** — driven off the OSC 7 cwd already parsed in Phase 2; list directories and runnable files.
- **Keyboard navigation between command blocks** — jump to previous/next command, collapse a block.

## Intent

From the original framing: *"a beautifully animated home for terminal rats, where commands or minimalistic GUI offers everything that they would need."*

Navigation is minimal GUI, not a file manager. It shows where you are and what you can run; it does not try to replace `ls`.

## Verify

- `open README.md` launches the configured editor.
- `cd` into a subdirectory — the panel follows.
- Block jump shortcuts work with a long scrollback.

## Gotchas to watch

- `open` is a **custom command intercepted by the app**, not passed to the shell. It needs a general mechanism for app-level commands that never reach the PTY — decide where that interception lives before adding more of them.
- The editor binary needs resolving per platform (`code` on both, but `$EDITOR` conventions differ). Falling back to the OS default handler is `tauri-plugin-opener`, which is already a dependency.
- "Runnable files" is fuzzy — scripts in `package.json`, executables, `.ps1`/`.sh`. Define the rule before implementing, or it becomes a heuristic nobody trusts.

## Open questions

- Does the file panel have a persistent position (sidebar) or is it summoned?
- Does `open` accept globs or only a single path?
