# Phase 9 — Rich Media

**Status: not started.** Blocked on [phase-8-markdown-engine.md](phase-8-markdown-engine.md) — every item here is an AST node type, so there has to be an AST first.

Mermaid diagrams, images, and video rendered inline in a command block.

## The rule that makes this tractable

**An embed is a leaf.** It fills a block-level slot at the block's width, it does not align to the character grid, and it has no rows.

Terminals that tried grid alignment for images ended up with Sixel, the Kitty graphics protocol, and iTerm2's — three incompatible answers, all shaped by the constraint of drawing into a character cell. VAD/OS renders to DOM. The constraint does not apply, so do not inherit its compromises. Settled in [../decisions.md](../decisions.md).

Consequences that fall out of it:

- The typewriter reveal measures rendered rows. An embed has none, so it fades in as a unit instead. This is the "not every node is text" case [../docs/ANIMATION.md](../docs/ANIMATION.md) has to account for.
- The raw view of a block containing an embed shows the original text — the markdown link, the mermaid source. Toggling to raw is not lossy, because the source is what was always there.
- Export gets embeds for free: markdown export writes the original link or fence, HTML embeds the asset, PDF rasterises it. See [phase-10-document-view.md](phase-10-document-view.md).

## Mermaid

A ```` ```mermaid ```` fence renders as a diagram.

- Mermaid is a **large** dependency. Load it lazily on the first mermaid fence in a session, not at startup. A terminal that pays for a diagram library at boot has failed [../docs/PERFORMANCE.md](../docs/PERFORMANCE.md) before it draws anything.
- Mermaid renders to SVG. Inline it; do not use its HTML labels mode, which injects markup and is exactly the surface [../decisions.md](../decisions.md) forbids reopening.
- **A syntax error must show the source, not a broken diagram.** Mermaid throws on bad input. Catch, fall back to a plain code block, and say why in one line.
- Diagrams re-render on theme change. Mermaid's theming is its own config object and does not read CSS variables — same problem as xterm's theme object in [phase-4-styling.md](phase-4-styling.md), and it gets the same answer: one place that pushes the token layer into both.

## Images

Two sources, and they are not the same feature:

**Markdown image links** — `![alt](path)` in rendered output. Local paths resolve against the block's cwd (available from OSC 7 since Phase 2). Remote URLs are the interesting case: fetching one means the terminal makes a network request because a command printed a string. That is a tracking pixel with extra steps. **Remote images are not fetched by default**; render a placeholder with the URL and a click to load.

**Terminal graphics protocols** — Sixel, Kitty, iTerm2 inline images. These arrive as escape sequences in the byte stream from tools that already emit them. Supporting them is a compatibility feature, not a design feature, and it belongs in the raw path: decode in the live `<pre>` container, not in the markdown renderer. Worth doing only if a tool the project actually uses needs it. Nothing does yet — **deferred until something does**.

Constraints for both:

- Local file reads go through a Tauri command with an explicit scope. The webview must not get filesystem access to make an image work.
- Cap decoded pixel dimensions. A command printing a link to a 20000×20000 PNG must not take the app down.
- An image that fails to load renders as its alt text plus the path. Never a broken-image icon.

## Video

Same node type as an image, different element. Genuinely rare in terminal output — the honest use is a link to a screen recording in CI output or a local `.mp4` in the cwd.

- **Never autoplay.** Poster frame, click to play.
- Remote video follows the same no-fetch-by-default rule as remote images, and more strongly.
- **Do not build a player.** `<video controls>` is the whole feature. If it needs more than that, it needed a real video player and the terminal was the wrong place for it.

## Verify

- A mermaid fence renders; a broken mermaid fence renders as code with a one-line reason.
- Startup bundle does not include mermaid until a diagram appears.
- A local `![](./shot.png)` in a rendered block displays, resolved against that block's cwd.
- A remote image URL does **not** hit the network until clicked. Confirm with the network panel, not by reading the code.
- Toggling an embed-carrying block to raw shows the original source text.
- The reveal animation does not stall on a block containing an embed.
- Theme switch re-renders an existing mermaid diagram in the new colours.

## Gotchas to watch

- **Layout shift.** An image whose dimensions are unknown until it loads reflows everything below it, which in a scroll feed means the reader's position jumps. Reserve space from intrinsic dimensions, or render at a fixed aspect until loaded. The `overflow-anchor: none` fix already in `.scroll` (see [../tasks.md](../tasks.md)) stops the browser from compensating, so this has to be handled deliberately.
- **Memory.** Decoded images are not small and blocks are retained for the session. This is the same unbounded-scrollback problem as everything else, and it arrives sooner here. Coordinate with the virtualization work rather than adding a second cap.
- **Mermaid's SVG carries its own `<style>`.** Scope it, or a diagram restyles the app.
