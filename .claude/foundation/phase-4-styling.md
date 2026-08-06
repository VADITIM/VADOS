# Phase 4 — Styling (SCSS)

**Status: token layer and accent system landed. One item outstanding — the bundled sans font.**

## Status / Learned

- **The token layer exists** as CSS custom properties on `:global(:root)` in `src/routes/+page.svelte` — not SCSS. SCSS was in the original plan and turned out to buy nothing: the whole value here is *runtime* swappability, which custom properties give and a preprocessor cannot. Adding a build step to compute values that have to stay live at runtime would have been backwards. Revisit only if nesting or mixins earn their keep somewhere real.
- **Fifty-nine hardcoded colors were replaced** across the component. Tokens are named for what they are (`--surface-raised`, `--border-strong`, `--text-ghost`), never for where they are used.
- **Accent tints are derived, not picked.** `--accent-text`, `--accent-text-soft`, `--accent-surface`, `--accent-surface-strong`, and `--accent-border-soft` all come off `--accent` through `color-mix`. They replaced hand-tuned violets (`#a78bfa`, `#c4b5fd`, `#17141f`, `#1c1b23`) that were chosen against indigo and would have looked wrong under the other three accents — exactly the failure this phase predicted. The derived values are close to the originals but not identical; that is the trade, and it is the right one.
- **`--ok` / `--err` / `--neutral` are exempt** and never read `--accent`. A red that shifted with the theme would stop meaning "failed".
- **`token()` / `xtermTheme()` / `applyTokens()`** are the JS side, built as functions from the start per the contract note below. `applyTokens()` currently has one consumer (xterm, which keeps its own theme object and cannot read CSS variables); mermaid joins it in Phase 9.
- **`localStorage` holds the accent**, alongside the font and scroll modes. Phase 6 supersedes all three with the TOML config.
- **Persistence order matters:** the restored accent is written to `:root` at the top of `onMount`, before the terminal is constructed. `xtermTheme()` resolves computed values, so anything reading a token before that write would resolve the indigo default and keep it.

## Still open

- Claude Sans Modern is not on this machine — see the Fonts section below. This is the one thing keeping the phase from closing.

## Why it comes after the renderer

There is nothing to style before blocks exist, and styling a moving target twice is wasted work.

## Original plan

- SCSS over a single token layer of CSS custom properties on `:root`. Everything reads off vars; **no hardcoded colors in component styles.**
- **Accent** is one variable, `--accent`, swapped at runtime. Derive tints and borders with `color-mix()` rather than shipping four hand-tuned palettes.
- **Fixed regardless of accent:** success green, error red, muted grey. Separate vars that never read from `--accent`.
- **Font** is `--font-body`, three-way. Consistent `line-height` across all three so switching does not reflow the scrollback.
- Chrome: dark base, thin rounded borders, generous line spacing — matching the portfolio terminal screenshots.

## Accent palette

| Name | Value |
|---|---|
| Indigo (default) | `#7e55dd` |
| Blue | `#4d7cfe` |
| Yellow | `#f0b429` |
| Orange | `#fb7a2a` |

Each "in its own vibrant style" — they are not mechanical hue rotations of the indigo, so each was picked by eye rather than derived. **Picked, not confirmed:** the three new ones are first proposals and should be looked at on screen against real output before they count as settled. The yellow is the one to check hardest — it is the lightest of the four, so `--accent-text` lands nearly white and the caret is far brighter than under indigo.

They live in `ACCENTS` in `src/routes/+page.svelte`, chosen from swatches in the settings module. Adding a fifth is one row: every tint, border, and hover state derives from the single value.

## Floating surfaces

Panels, overlays, and bars float. Inset on every side, rounded on every corner, lifted with a shadow — never welded to a window edge. Recorded in [../decisions.md](../decisions.md); the practical rules for this phase:

- **Elevation is not optional.** A surface that is inset but flat reads as a rendering gap. Border on all four sides plus a shadow, or it is not floating, it is broken.
- **The entrance has to agree with the geometry.** A lateral slide from the right says "drawer" no matter what the CSS does. Floating surfaces rise into place.
- **Insets are `dv`, not pixels.** They scale with the window; a fixed 16px gap disappears on a large monitor and dominates a small one.
- **No fixed width or height on an overlay, and no fixed minimum.** `clamp(30dvw, <preference>, 88dvw)` — both bounds in viewport units, so the surface takes a larger share of a narrow window and a smaller share of a wide one. A single proportional width is not enough: the contents do not shrink with the window, so a flat `dvw` goes unreadable before it goes small. Cap the height in `dvh` and let the surface scroll its own overflow. Type is the exception — `rem`, so it tracks the reader rather than the window.
- **Nothing in a scroll region may be flex-shrunk.** A flex column shrinks its items below their content by default, so anything with a fixed intrinsic height (the ASCII banner and its divider) gets clipped on a short window instead of scrolling. `flex: none` on those items; the scroll container is what handles the overflow.

## Fonts

**Superseded in practice.** The shipped model is not a font picker but a **scope** rule: two slots, `--font-outside` and `--font-inside`, and a mode is a pair of assignments to them. Adding a mode is a row in `FONT_MODES`, not a new stack.

| Mode | Outside a module | Inside a module |
|---|---|---|
| Mixed *(default)* | mono | sans |
| Mixed Reverse | sans | mono |
| Sans | sans | sans |
| Modern | mono | mono |

Two real fonts sit under those slots:

| Token | Value |
|---|---|
| `--font-mono` | Space Mono, bundled at `src/lib/fonts/` |
| `--font-sans` | **Placeholder** — a system stack standing in for Claude Sans Modern |

**Unconditionally mono, in every mode:** code blocks, inline code, the ASCII banner and its divider, the raw xterm view, and the F3 diagnostic. These are the "except code blocks etc." carve-out, and the reason is alignment rather than taste.

**Still unresolved:** Claude Sans Modern is not present on the development machine — see [../tasks.md](../tasks.md). Until it is bundled, the sans modes render differently on Windows and Arch, which contradicts the cross-platform-parity claim in the README. That makes bundling it a correctness item for this phase, not a polish one.

## The token list is a contract

The variables defined here are not an implementation detail. [phase-11-theme-engine.md](phase-11-theme-engine.md) exposes them to users as a versioned, closed contract, so a token added carelessly here becomes something that cannot be renamed later without breaking every theme.

Two consequences for this phase:

- **Name tokens for what they are, not where they are used.** `--surface-raised`, not `--block-bg`. The block is one consumer of it.
- **One function pushes the resolved tokens everywhere**, including into xterm's theme object — which does not read CSS variables, per the gotcha below. Mermaid later joins the same function ([phase-9-rich-media.md](phase-9-rich-media.md)). Build it as a function from the start, not as a line in the accent-swatch click handler.

## Verify

- Flip `--accent` and `--font-body` in devtools.
- Nothing green / red / grey shifts when the accent changes.
- No layout jump when the font changes.

## Gotchas to watch

- The live `<pre>` container must stay monospace regardless of `--font-body`. ASCII alignment depends on it. Font switching applies to prose, not to raw output.
- xterm.js has its own theme object and does not read CSS vars. Its colors must be set in JS and kept in sync with the token layer when the accent changes.
- `color-mix()` needs the accent in a color space that mixes sanely — check the derived borders do not go muddy on the yellow and orange accents.
