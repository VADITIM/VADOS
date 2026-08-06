# Changelog

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

Accent and font switching. The typewriter reveal and the rest of
[ANIMATION.md](ANIMATION.md). The config file and settings panel. `open <file>`
and keyboard navigation. fish.

### Rough edges

Scrollback grows for the life of a session. No cap, no virtualization, so
memory climbs as you work.

The [PERFORMANCE.md](PERFORMANCE.md) numbers are targets. No measurement
against a real terminal has happened yet.

The parser reads shape, not language, so it fences prose and bolds plain lines
when output looks unusual.

A PTY merges stderr into stdout, so error text gets styled by pattern match.
PowerShell error records come out as a bold paragraph plus a code block.

PowerShell is the shell this build was driven with. bash and zsh ship untested.

Builds carry no signature, so SmartScreen warns on first run.
