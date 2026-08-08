# Phase 7 — Navigation & Shortcuts

**Status: partly built, unverified on screen.** The focus model, the block jump, the keyboard copy and `open <file>` are in `src/routes/+page.svelte` (`open` itself is `dir::open_path`). The cwd file panel is built too (Ctrl+B). Every item this phase set out is therefore written; none of it is checked. The *Verify* list at the bottom has not been run.

## Original plan

- **`open <file>`** — resolve the editor from config or `$EDITOR`, shell out to it. A few lines.
- **cwd file panel** — driven off the OSC 7 cwd already parsed in Phase 2; list directories and runnable files.
- **Keyboard navigation between command blocks** — jump to previous/next command, collapse a block.

## Intent

From the original framing: *"a beautifully animated home for terminal rats, where commands or minimalistic GUI offers everything that they would need."*

Navigation is minimal GUI, not a file manager. It shows where you are and what you can run; it does not try to replace `ls`.

## Block focus is the real deliverable

"Jump to previous/next command" sounds like a convenience. It is actually the **focus model**, and three later features consume it: fold/unfold ([phase-8-markdown-engine.md](phase-8-markdown-engine.md)), the raw toggle and per-block export ([phase-10-document-view.md](phase-10-document-view.md)), and copy, which currently has no keyboard path at all.

So build exactly one notion of "the focused block" and let everything key off it. Two competing focus states — one for keyboard nav, one for whichever block the pointer is over — is the version of this that quietly breaks every consumer.

## Status / Learned

- **The focus model is `focusedId`, one number, and both input methods write it.** Ctrl+Up / Ctrl+Down step it, a click sets it, Esc clears it, submitting a command clears it (the reader is back at the input bar), and clearing the output clears it. The consumers this exists for — fold ([phase-8-markdown-engine.md](phase-8-markdown-engine.md)), the raw toggle and per-block export ([phase-10-document-view.md](phase-10-document-view.md)) — all read the same number.
- **The hover ring is deliberately not the focus state,** which is the distinction the plan warned about, arrived at from the other side. The ring tracks a pointer, dies when the pointer leaves and never survives a scroll: it says where the mouse is, not what the next key acts on. Two states, but only one is ever read by a feature, and the pointer writes *both* — a right-click copy focuses the block it copied, because a block the user just acted on is the block the next key should act on.
- **Chords, not bare keys.** A bare Up/Down is PSReadLine's history and the suggestion strip's selection, and a terminal that takes either has broken something the user already knows. Ctrl+Shift+C / Ctrl+Shift+M for the two copies, matching every other terminal's copy chord. Both live in xterm's `attachCustomKeyEventHandler` rather than on the window, for the reason the strip's keys do: xterm turns a keydown into bytes from its own listener, so stopping the event bubbling is not enough — it has to be told it was handled.
- **The focus mark is a left rail, not a border colour, and that is structural rather than aesthetic.** The hover ring tweens `border-color` with GSAP, which writes an *inline* style; the moment a pointer has crossed a block, any class-based border rule is outranked for the rest of that block's life. See [../docs/QUIRKS.md](../docs/QUIRKS.md) §18. It is also not animated: focus is a state that lasts, and a state that persists has nothing to animate towards.
- **`open` is the OS default handler, not an editor from config or `$EDITOR`.** The plan said "resolve the editor"; "open" already means "the thing this file opens in" everywhere else on the machine, and `tauri-plugin-opener` was already a dependency. An editor setting is a settings row nobody has asked for; when one is wanted it belongs beside the shell picker in [phase-12-shell-hosting.md](phase-12-shell-hosting.md), where the rest of "which binary" lives.
- **The opener plugin is called from Rust, not from the frontend, and the first attempt failed on exactly this.** Adding `opener:allow-open-path` to the capability file is not enough: the plugin's JS command is additionally guarded by a **path scope**, so the first build answered every `open` with `Not allowed to open path`. That scope is the right design for an app that knows in advance which files it touches and the wrong one for a terminal — the path is a line the user typed at their own prompt, so the only scope that fits is "everything", and a scope of everything is a scope that lies about what it does. `dir::open_path` calls the plugin's Rust API instead, where there is no scope because there is no untrusted caller: reaching it at all means the text came through `open`, which is app code and not command output. The capability keeps `opener:default` (URLs, reveal-in-folder) and nothing more.
- **App-level commands now take arguments, and the split is load-bearing.** `LOCAL_COMMANDS` matches the first word; `LOCAL_ARGS` names the ones allowed to consume the rest of the line. Without that split, PowerShell's `help` — which *is* `Get-Help` — would have had `help git` swallowed by our own help page. This is the general mechanism the gotcha below asked to be decided before more app-level commands are added: name, optional argument, no block, a toast for the whole result surface.
- **The cwd file panel is built, and it is the one surface here that takes width rather than covering.** It was skipped once because Tab on an empty prompt already lists the cwd — which answers a different question. The strip appears because you asked it something and leaves when you stop; a panel is there when you did *not* ask, and that is the whole of "shows where you are". Ctrl+B, on the right, narrowing the scrollback, the input bar and the suggestion strip, with the PTY resized to match. What it cost: the containers have to animate their own width, since the terminal frame never moves and no transform could carry them. That is now the second sanctioned exception in [../docs/ANIMATION.md](../docs/ANIMATION.md), with the two guards it is only allowed under — one tween driving both edges, and the resize observer muted for its duration and run once on landing. See [../decisions.md](../decisions.md).
- **Separately, and smaller:** Tab-completing a *runnable* file offers the path only, where dropping the same file offers the ways to run it. Two surfaces answering the same question differently. Also in [../tasks.md](../tasks.md).

## Verify

- Ctrl+Up from the prompt selects the newest block; repeated presses walk back up the scrollback and the view follows, each block's head landing at the same height a new block's does.
- Ctrl+Down walks back and, past the newest block, deselects and returns the view to the tail.
- A click selects the block clicked, and the rail appears on it. Hovering a *different* block does not move the rail.
- Right-click a block: it is copied and it becomes the selected one.
- With a block selected, Ctrl+Shift+C copies its output and Ctrl+Shift+M copies it as markdown. With none selected, both say so rather than doing nothing.
- Esc with a block selected deselects it and does **not** open the settings panel; Esc again opens the panel.
- `clear` with a block selected leaves nothing selected.
- `open README.md` opens it. `open .` opens the folder. `open "a file with spaces.md"` works. `open` alone says it needs a path. A path that does not exist reports the failure rather than doing nothing.
- `help git` still reaches PowerShell and prints its help, not ours. Bare `help` is still ours.
- In raw mode (`vim`), Ctrl+Up and Ctrl+Shift+C reach the program.

## Gotchas to watch

- `open` is a **custom command intercepted by the app**, not passed to the shell. It needs a general mechanism for app-level commands that never reach the PTY — decide where that interception lives before adding more of them.
- The editor binary needs resolving per platform (`code` on both, but `$EDITOR` conventions differ). Falling back to the OS default handler is `tauri-plugin-opener`, which is already a dependency.
- "Runnable files" is fuzzy — scripts in `package.json`, executables, `.ps1`/`.sh`. Define the rule before implementing, or it becomes a heuristic nobody trusts.

## Open questions

- ~~Does the file panel have a persistent position (sidebar) or is it summoned?~~ **Summoned, on Ctrl+B.** A persistent sidebar takes width from every block for the whole session, and this is a terminal, not a file manager. Ctrl+B costs readline's backward-char — the left arrow with extra steps, and the cheapest binding in the set to lose. Raw mode keeps it, so tmux's prefix is untouched.
- **Does the panel want a selection of its own?** It has none today: it is a tree of buttons, a click on a folder opens it, and a click on a file summons the run-options strip. The moment it grows keyboard navigation it has to answer to the one-selection rule in [../decisions.md](../decisions.md) rather than growing a second notion of "the one I mean".
- Does `open` accept globs or only a single path? **A single path today**, and the argument is unquoted rather than shell-parsed: one surrounding pair of quotes comes off, anything else is left alone. A glob would need expanding by somebody, and the only honest expander is the shell — which a local command by definition never reaches.
