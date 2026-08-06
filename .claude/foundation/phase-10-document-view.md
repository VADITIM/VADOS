# Phase 10 — Document View: Split, Toggle, Export

**Status: not started.** Blocked on [phase-8-markdown-engine.md](phase-8-markdown-engine.md).

The two features that make the rendered view trustworthy rather than merely nicer: you can always see what was actually printed, and you can always get it out of the app.

## Raw toggle

The load-bearing one. A rendered block flips to its raw bytes and back with one keystroke.

- **Per block, not per session.** Global raw mode is the fallback, not the primary control — the useful case is "this one block rendered wrong", not "turn the product off".
- The toggle is on the block's own chrome and on a keybind for the focused block (Phase 7 owns block focus).
- **A block that fails to classify correctly is a bug report.** Wire the toggle to a way of capturing that: at minimum, `copy as raw` gives a reporter the exact input. A one-key "this rendered wrong" that copies input plus classifier verdict is worth more than any amount of parser tuning done blind.
- Cost: the raw snapshot is retained for the block's life. Already settled in [../decisions.md](../decisions.md); it counts against the scrollback budget in [../docs/PERFORMANCE.md](../docs/PERFORMANCE.md).

## Split view

Rendered on one side, raw terminal on the other, both live.

Be honest about what this is: **a debugging and demo feature**, not a daily driver. Nobody reads two copies of the same output all day. It earns its place by proving the renderer is not lying, and by making the difference visible in a screenshot — which is most of how anyone will first encounter the idea.

- The raw side is the **existing xterm instance**, which already processes every byte in both modes (see [../architecture.md](../architecture.md)). Making it visible is a layout change, not a new renderer. This is the reason the feature is cheap; if it starts needing a second parse of the stream, it has gone wrong.
- Vertical split only. Terminal output is tall and narrow; a horizontal split gives both sides nothing.
- Toggle, not a persistent mode, and off by default.
- **PTY size follows the visible xterm pane, not the window.** Getting this wrong wraps every line at the wrong column, and it will not be obvious in a screenshot — it shows up as mysterious reflow in the block view.
- **Not multi-tab, and not a step toward it.** Two panes over one PTY. The rejection of tabs and panes in [../decisions.md](../decisions.md) stands; this shares one session and adds no session management.

## Export

Markdown, HTML, and PDF, at two scopes: one block, or the session.

**All three come off the AST**, not the DOM ([../decisions.md](../decisions.md)). A DOM print path drags app chrome into the output and breaks whenever the styling changes.

| Target | Path | Notes |
|---|---|---|
| Markdown | `toMarkdown(ast)` — already exists, drives shift+right-click copy | Extend it as node types are added. It is already the second consumer of the AST; export makes it the third. |
| HTML | Same walk, HTML sink, styles inlined from the token layer | Standalone file, no external assets. Embeds inlined as data URIs. |
| PDF | HTML → print | Do not add a PDF library. Render the HTML in a hidden webview and print it to file. One dependency less, and the HTML path is already tested by the HTML target. |

Details that matter:

- **Export includes the command and the exit code**, not just the output. A block without its command is a fragment nobody can act on.
- Session export is blocks in order with a header carrying date, shell, and cwd.
- **Raw blocks export as fenced code.** They were never a document; do not pretend.
- ANSI colour is dropped on export to markdown and kept on export to HTML. Say so in the UI rather than surprising someone.
- **No export path may re-parse rendered HTML.** Markup in, markup out, injection back on the table.

## Verify

- Toggle a rendered block to raw and back; the raw text matches the original bytes exactly.
- Split view: type in the block view, output appears on both sides, and neither side lags the other.
- Resize with split view open — line wrapping in the raw pane matches the pane, not the window.
- Export a block to markdown; re-render it with any markdown viewer and it matches the on-screen structure.
- Export a block containing a mermaid diagram to HTML; the diagram is present and the file opens with no network access.
- Export to PDF, open it, and confirm no app chrome appears.
- Export a session with 500 blocks and confirm it does not block the UI thread.

## Gotchas to watch

- **The file-save dialog is a Tauri plugin that is not yet a dependency.** `tauri-plugin-dialog` and `tauri-plugin-fs`, both with scoped capabilities. Do not widen the capability set beyond the chosen path.
- **A long session export is a lot of string building.** Do it off the UI thread, or chunk it. Same budget applies as anywhere else.
- **PDF pagination will break code blocks across pages.** `break-inside: avoid` on block sections; expect to tune it once against a real long output.
- Split view and the settings overlay both compete for stacking context. Phase 6's overlay must sit above both panes, not inside one.
