# Changelog

## Unreleased

## 0.2.0

- Settings panel with live accent colour picker, font mode selector, and a
  scroll-behaviour choice for new commands (stay put vs. follow to bottom).
- Font modes (Mixed, Mixed Reverse, Sans, Modern) a rule for where mono
  vs sans applies, not a font picker. Code, ASCII banners, and the raw view
  stay monospace in every mode.
- Typewriter reveal: output animates in row by row as it arrives, with hard
  flood control so it never falls behind on fast-printing commands.
- Animated typing caret in the input bar.
- Sticky command lines: a block's command line pins to the top while its
  output scrolls underneath.
- Toast notifications, replacing printed confirmation messages.
- `clear`/`cls` now wipe the rendered block history, not just the screen,
  the banner stays, a toast confirms it instead of printing a block.
- Right-click a block to copy its output; shift+right-click copies it as
  markdown.
- Rewritten markdown parser and block styling (open/closed state, exit-code
  colour, dividers).

## 0.1.0

First tagged build. Windows 11 only. Linux has no build yet.

### Works

- A real PTY session. `portable-pty` spawns your shell and streams bytes to the
  frontend.
- One block per command, carrying its cwd and exit code, from OSC 133 markers.
- Shell integration for PowerShell, bash, and zsh, injected at spawn. Your
  dotfiles stay untouched.
- A hand-rolled parser that renders output as headings, lists, code blocks, and
  inline code.
- A raw xterm.js view for `vim`, `htop`, and `claude`.
- A docked input bar mirroring what you type.
- Right-click a block to copy its output. Shift+right-click copies it as
  markdown.

### In the README, not in the build

Accent and font switching. The typewriter reveal. The config file and
settings panel. `open <file>` and keyboard navigation. fish.

### Rough edges

Scrollback grows for the life of a session. No cap, no virtualization, so
memory climbs as you work.

Performance numbers are targets. No measurement against a real terminal has
happened yet.

The parser reads shape, not language, so it fences prose and bolds plain lines
when output looks unusual.

A PTY merges stderr into stdout, so error text gets styled by pattern match.
PowerShell error records come out as a bold paragraph plus a code block.

PowerShell is the shell this build was driven with. bash and zsh ship untested.

Builds carry no signature, so SmartScreen warns on first run.
