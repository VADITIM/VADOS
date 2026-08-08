/**
 * Every setting VAD/OS has, as data.
 *
 * These tables are the whole definition of a setting: the key written to
 * `config.toml`, the label the settings panel shows, and whatever the mode
 * actually changes. Adding a mode is a row here and nothing else — the panel
 * renders whatever it finds, and `config.rs` stores the key rather than the
 * resolved value, so neither side has a second list to keep in step.
 *
 * Data only. Applying a setting — writing `--accent` to `:root`, re-anchoring
 * the tail, playing the glitch on the row that was clicked — stays in the
 * component, because all of it is DOM.
 */

// Two slots, not four font stacks: text *outside* a module and text *inside*
// one (see the glossary in .claude/architecture.md). Every mode is a pair of
// assignments to those two slots. Code blocks and the raw view ignore both and
// stay mono unconditionally — alignment is load-bearing there.
export const FONT_MODES = {
  mixed: {
    label: "Mixed",
    hint: "Recommended",
    outside: "var(--font-mono)",
    inside: "var(--font-sans)",
  },
  reverse: {
    label: "Mixed Reverse",
    hint: "Modules in mono",
    outside: "var(--font-sans)",
    inside: "var(--font-mono)",
  },
  sans: {
    label: "Sans",
    hint: "Sans everywhere",
    outside: "var(--font-sans)",
    inside: "var(--font-sans)",
  },
  modern: {
    label: "Modern",
    hint: "Mono everywhere",
    outside: "var(--font-mono)",
    inside: "var(--font-mono)",
  },
} as const;

export type FontMode = keyof typeof FONT_MODES;

/**
 * Where each font mode sits on the settings X, in the table's own order.
 * Positional by index rather than by name so the two lists cannot drift
 * apart quietly: a fifth mode reads `undefined` here and the wedge is visibly
 * unstyled, which is the failure anyone would rather have.
 */
export const WEDGES = ["wedge-tl", "wedge-tr", "wedge-bl", "wedge-br"] as const;

// Where the view lands when a new block opens. The two answers are genuinely
// a preference rather than a right and a wrong: anchoring the head near the
// top lets a long command read as a document from its first line, and jumping
// to the tail gets you to the newest output without waiting for it.
export const SCROLL_MODES = {
  top: {
    label: "Stay on top",
    hint: "Anchor the command line near the top",
  },
  bottom: {
    label: "Move down",
    hint: "Follow the newest output",
  },
} as const;

export type ScrollMode = keyof typeof SCROLL_MODES;

// One reveal for all output, whether it arrived finished or is landing chunk
// by chunk: a bar sweeps each coloured token, staggered by how much the token
// means, and a character wave rises under the grey prose between them. What is
// live about live output is *when* an element animates, not how — the
// timeline is the shell's.
//
// There used to be a second animation here, a typewriter for the element still
// growing, and it is gone. One command's output looked like two different
// products depending on where a PTY chunk boundary fell, and a chunk boundary
// is an artefact of the pipe rather than anything about the text — so the
// reader was being shown a distinction with nothing behind it.
//
// The switch is whether any of that runs at all. `instant` is the answer for
// a reader who wants the output and not the picture of it: every element
// rises into place as one, the same gesture the settings panel enters with,
// and no text is ever typed or waved. It governs command output only — chrome
// (the panel, the suggestion strip, a block's border draw) is a response to a
// gesture the user just made and keeps its animation either way.
export const REVEAL_MODES = {
  reveal: {
    label: "Reveal",
    hint: "Bars sweep the tokens, prose waves in behind them",
  },
  instant: {
    label: "Instant",
    hint: "Output rises into place, one piece per element",
  },
} as const;

export type RevealMode = keyof typeof REVEAL_MODES;

// One value drives the whole accent surface — every tint, border and hover
// state derives from it with color-mix in the token layer, so a new accent
// is one row here and nothing else. Each is picked to be vibrant in its own
// right rather than a hue rotation of the indigo, which is why they are not
// all the same saturation.
export const ACCENTS = {
  indigo: { label: "Indigo", value: "#7e55dd" },
  blue: { label: "Blue", value: "#4d7cfe" },
  yellow: { label: "Yellow", value: "#f0b429" },
  orange: { label: "Orange", value: "#fb7a2a" },
  red: { label: "Red", value: "#e5484d" },
  green: { label: "Green", value: "#30c98d" },
  pink: { label: "Pink", value: "#ef5da8" },
  // Not #fff: the accent is a *tint* source — every border and surface derives
  // from it with color-mix, and pure white washes those out to grey. A hair
  // off neutral keeps the derived layer readable.
  white: { label: "White", value: "#e8e8ec" },
} as const;

export type Accent = keyof typeof ACCENTS;

/**
 * The shape written to `config.toml`. Every value is a key from the tables
 * above rather than a resolved colour or font stack — see `config.rs`.
 */
export type Config = {
  appearance: { accent: string; font: string };
  behavior: { scroll: string; reveal: string };
  shell: { cwd: string };
  system: { start_as_admin: boolean };
};

/** One key's worth of validation: an unknown value keeps what is on screen. */
export function pick<T extends string>(value: string, valid: Record<T, unknown>, current: T): T {
  return value in valid ? (value as T) : current;
}
