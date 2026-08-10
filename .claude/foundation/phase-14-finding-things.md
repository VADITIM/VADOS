# Phase 14 — Finding Things

**Status: not started.** Search wants [phase-13-command-as-event.md](phase-13-command-as-event.md)'s metadata before it can filter; the registry and the palette depend on nothing.

Two features and one piece of plumbing that they, `/help` and every existing keybinding all share.

## Scope

1. One command registry.
2. The palette.
3. Session search.

## One command registry

Every binding today is hardcoded across two handlers — `onAppKey` on the window, and the xterm key handler — and `HELP_NODES` is a hand-maintained list beside them. [../../CLAUDE.md](../../CLAUDE.md) makes keeping those in sync mandatory, which is the right instruction and the wrong mechanism: it is a rule enforced by discipline over three places that have no structural relationship to each other.

One table in `src/lib/commands.ts`:

```
{ id, label, keys, run, when }
```

feeding three consumers:

- **The two key handlers**, as a lookup rather than a chain of conditionals. `when` is what replaces the `mode === "raw"` and `wantsKeyboard` guards that currently open both handlers.
- **`HELP_NODES`**, generated from the table — so a binding with no help line becomes impossible rather than forbidden.
- **The palette.**

This follows the pattern [../../src/lib/settings.ts](../../src/lib/settings.ts) already sets, and the split is the same one: **the tables are data in `lib/`, the DOM work stays in the page.** A command's `run` closes over page state, so the table is constructed in the page from a data list, not exported fully-formed — the same shape `settings.ts` uses, where the data says what the settings are and the page knows how to apply one.

**What this does not become:** a keymap the user edits. That is a config surface, a merge strategy and a conflict UI, and nobody has asked for one. The registry is for us.

## The palette

`Ctrl+Shift+P`. A filtered list over the registry.

VAD/OS has more functionality than a conventional terminal and exactly one place to discover it, which is `/help`. `/help` answers *"what can this do"* and answers it well. It does not answer *"do the thing I am thinking of"*, and a palette is the second question. Neither replaces the other, and the registry means they cannot disagree.

The suggestion strip is already a list with a selection, arrow handling and an accept path. **Reuse its interaction rules** rather than growing a second selection model — that is the same reasoning as one `focusedId` for block selection, and the failure mode is identical.

The one rule that does not carry over: *"an automatic strip never takes Enter"* is about a strip that is up for most of every line. The palette is summoned, so it owns Enter, the same exemption a drop-summoned strip already has.

## Session search

`Ctrl+F` over the session.

Because blocks have boundaries, a hit **scrolls to and focuses the block**, not a line. That is the thing a conventional terminal structurally cannot do, and it is most of the value here — a hit in the middle of a 2000-line build is useless without knowing which command produced it.

Search is the third consumer of the focus model, after copy and H1's raw toggle. `focusBlock` and `moveFocus` already exist.

Scope, in order of what to build first:

- **Plain substring across `block.buffer`.** Everything else is an addition to this.
- **Then filters** — `exit:1`, `cwd:`, `cmd:` — which become possible once Phase 13 stores the metadata and are pointless before it.
- **Not an index**, until a session with 10,000 blocks is measured to need one. A linear scan over strings already in memory is fast enough to be worth proving inadequate before replacing.

WebView2's native find is currently suppressed, because F3 is the debug overlay. That suppression stays; this is what replaces what it took away.

## Verify

- `node src/lib/commands.check.mjs` asserts the two invariants worth asserting: every command has a help line, and no two commands claim the same chord under the same `when`.
- `/help` lists every binding, and it was not edited by hand to do so.
- The palette opens, filters, runs a command, and closes with Esc — falling into the existing Esc order, innermost first.
- `Ctrl+F` finds a string in a block scrolled far out of view, and the view lands on that block's head.
- Search with the cwd panel open does not fight the band tween.
- A search that matches nothing says so rather than doing nothing.

## Gotchas to watch

- **The registry is a refactor of live keybindings**, which is the category of change that silently drops one. The self-check covers the table; only running the app covers the handlers.
- **Esc now has one more thing to close.** The order in [../decisions.md](../decisions.md) is innermost-first and the palette belongs near the front of it. Getting that wrong makes Esc close the wrong surface, which is worse than it sounds because the user cannot see the stack.
- **Search must not take the keyboard from the shell.** Ctrl+F is readline's forward-char, and this spends it in block mode. That is a cost, recorded next to Ctrl+A and Ctrl+B in `tasks.md`, not a free key.
- **A palette entry that runs a shell command is a code block with a nicer name.** The same confirmation rules apply; prefer entries that act on the terminal rather than entries that type.
