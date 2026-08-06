# Phase 11 — Theme Engine

**Status: not started.** Blocked on [phase-4-styling.md](phase-4-styling.md), which defines the token layer this exposes, and [phase-6-config.md](phase-6-config.md), which owns the config file and the watcher.

Phase 4 ships four curated accents. This phase decides whether anything beyond that is user-reachable, and if so, how.

## The tension

[../decisions.md](../decisions.md) rejects a plugin system: settings are a fixed, curated GUI, not an extension surface. A theme engine is, structurally, a plugin system for CSS. Both cannot be true as stated.

The reconciliation, and the thing to hold to: **a theme is data, not code.** A theme file is a list of token values. It cannot add selectors, cannot ship JavaScript, cannot restyle a component the app did not expose. That is a settings file with more entries, not an extension point, and it is compatible with the rejection above.

Obsidian is the reference for the *experience* — swap a file, the app looks different, no restart. It is not the reference for the *mechanism*: Obsidian themes are arbitrary CSS, which is why an Obsidian theme breaks on Obsidian updates. Do not sign up for that.

## Design

- **A theme is a TOML file of token values.** Same format and same directory as the config ([phase-6-config.md](phase-6-config.md)) — `%APPDATA%\vados\themes\` / `~/.config/vados/themes/`.
- **The token list is a fixed, versioned contract.** An unknown key is ignored with a warning, not applied. A missing key falls back to the default theme's value, so a partial theme is valid and a two-line theme works.
- Applied by setting CSS custom properties on `:root`. This is the mechanism Phase 4 already builds; the theme engine adds nothing to the render path.
- **Built-in themes are the same file format**, shipped as resources. If the built-ins need a mechanism a user theme cannot use, the contract is wrong.
- Hot reload rides the `notify` watcher Phase 6 already runs. No second watcher.

## The token contract

Phase 4 defines the values. This phase defines that the list is **closed** and what happens at its edges.

| Group | Examples | Themeable |
|---|---|---|
| Surfaces | base, block background, block border, overlay | Yes |
| Text | primary, muted, accent | Yes |
| Accent | `--accent` and everything `color-mix()`ed from it | Yes |
| Status | success green, error red, warning | **No** — fixed by [../decisions.md](../decisions.md) |
| Fonts | body font, mono font, size, line height | Yes, with limits |
| Geometry | radius, border width, block spacing | Yes |

**Status colours stay fixed.** A theme that makes failure green is a theme that costs someone a deploy. This is the same reasoning that already exempts them from the accent system, applied to a bigger surface.

**Line height is capped, not free.** Phase 4 requires consistent line height across fonts so switching does not reflow scrollback. A theme that breaks that breaks the reveal animation's row measurement with it.

## xterm and mermaid

Both carry their own theme objects and neither reads CSS variables.

There must be **one function** that takes the resolved token set and pushes it into: the `:root` properties, the xterm theme object, and mermaid's config. Three call sites, one source. Any component added later that has its own theming joins that function — it does not grow its own path. This has already bitten twice in the phase docs ([phase-4-styling.md](phase-4-styling.md), [phase-9-rich-media.md](phase-9-rich-media.md)); treat the third occurrence as proof the function is needed rather than as another special case.

## Verify

- Drop a theme file in the themes directory; it appears in settings without a restart.
- Edit a theme file while the app runs; the UI updates within the watcher debounce.
- A theme with two keys works, inheriting everything else.
- A theme with an unknown key logs and is otherwise ignored.
- No theme can change success green or error red.
- Switching a theme updates the xterm view and any on-screen mermaid diagram, not only the DOM.
- Theme switching does not reflow scrollback or leave animation splits behind.

## Gotchas to watch

- **`color-mix()` on a user-supplied accent can go muddy or illegible.** Phase 4 already flags this for yellow and orange. With arbitrary user colours it is guaranteed. Compute a contrast check on load and warn — do not silently ship unreadable text.
- **A theme file is untrusted input.** It is TOML from disk, so parse it as data and never as anything evaluable. The moment a theme can express a selector or a script, the plugin-system rejection has been quietly reversed.
- **Do not let the theme list grow into a settings panel.** The curated accent swatches remain the primary control. Custom themes are for people who go looking.
