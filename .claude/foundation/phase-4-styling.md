# Phase 4 — Styling (SCSS)

**Status: not started.** Blocked on Phase 3.

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
| Blue | TBD — vibrant, same saturation family |
| Yellow | TBD |
| Orange | TBD |

Each "in its own vibrant style" — they are not mechanical hue rotations of the indigo, so each needs picking by eye.

## Fonts

| Key | Stack |
|---|---|
| `system` | OS default UI stack |
| `mono` | the terminal's standard monospace |
| `claude-sans` | Claude Sans Modern |

**Not yet resolved:** where Claude Sans Modern is sourced from and whether it ships bundled with the app.

## Verify

- Flip `--accent` and `--font-body` in devtools.
- Nothing green / red / grey shifts when the accent changes.
- No layout jump when the font changes.

## Gotchas to watch

- The live `<pre>` container must stay monospace regardless of `--font-body`. ASCII alignment depends on it. Font switching applies to prose, not to raw output.
- xterm.js has its own theme object and does not read CSS vars. Its colors must be set in JS and kept in sync with the token layer when the accent changes.
- `color-mix()` needs the accent in a color space that mixes sanely — check the derived borders do not go muddy on the yellow and orange accents.
