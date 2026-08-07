One line per change. What changed, and the constraint or cause if it is not obvious. No rationale essays, no feature tours.
# Changelog

## Unreleased

## 0.3.0

### Commands

- `help` lists every command and key binding.
- Commands accept a `/` prefix: `/help`, `/clear`, `/cls`.
- Commands no longer reach the shell, the typed line is erased from the line editor, so nothing lands in shell history.

### Animation

- Typewriter reveal: one left-to-right wipe per rendered row, quantized to a character grid. A wrapped line gets one reveal per visual row. Same in plain and structured output. A code block's box is present before its text types.
- Reveal is clamped to the viewport: rows off screen are shown, not animated.
- Flood control: more than 40 pending rows appears at once; in "move down" the stagger falls as the backlog grows.
- Row wipe 0.225s, stagger 0.096s.
- Submit is one handoff: the input bar retracts, the block pops from that size, travels to its place, lands with an overshoot. Unsubmitted blocks get the plain entrance.
- Pointer-tracked hover ring on blocks.
- Settings panel enters on a stutter; changing a setting flickers characters of the chosen option.
- Result line pulses on completion; banner divider draws in from the left.
- Raw view switch is a crossfade.
- `clear` sweeps blocks out instead of removing them.
- Caret returns to line start, stops blinking, and stays visible while a command runs.
- All of the above are skipped under reduced motion, except the hover ring.

### Output rendering

- A full command line is marked up as one unit, not a lone flag mid-sentence. Commands that are also ordinary words are left alone.
- Blocks VAD/OS writes itself carry their own structure instead of going through the shape detector.

### Fixes

- Typing `(`, `{`, `[` no longer overwrites the prompt: shell integration keeps its markers out of the prompt string.
- Stray `\` before typed characters, from the markers' two-byte terminator.
- Typing works again after `clear`, clearing drops the scrollback without rewriting the screen under the shell.
- Block no longer strands half-faded when the pointer crosses it mid-animation.
- Scrolling during the submit handoff no longer throws it off course.
- Pinned command line sits flush with the top edge; its underline is reachable again.
- No mid-word break on a word too long for one line.

## 0.2.0

### Commands

- `clear`/`cls` wipe rendered block history, keep the banner, confirm by toast.
- Right-click a block copies its output; shift+right-click copies markdown.

### Settings and appearance

- Settings panel: accent colour, font mode, scroll behaviour for new commands.
- Font modes (Mixed, Mixed Reverse, Sans, Modern), a rule for where mono
  applies, not a font picker. Code, ASCII banners, and the raw view stay mono.

### Animation

- Typewriter reveal. *(Written ahead of the work, the row reveal actually
  shipped in the release above.)*
- Animated typing caret.
- Sticky command lines: a block's command pins while its output scrolls.
- Toasts replace printed confirmations.

### Output rendering

- Rewritten markdown parser and block styling (open/closed, exit-code colour,
  dividers).

## 0.1.0

First tagged build. Windows 11 only, no Linux build.

### Works

- Real PTY session via `portable-pty`, streaming bytes to the frontend.
- One block per command with cwd and exit code, from OSC 133 markers.
- Shell integration for PowerShell, bash, zsh, injected at spawn. Dotfiles
  untouched.
- Parser renders headings, lists, code blocks, inline code.
- Raw xterm.js view for `vim`, `htop`, `claude`.
- Docked input bar mirroring what you type.
- Right-click copies a block's output; shift+right-click copies markdown.

### In the README, not in the build

Accent and font switching. Typewriter reveal. Config file and settings panel.
`open <file>` and keyboard navigation. fish.

### Rough edges

- Scrollback grows for the life of a session: no cap, no virtualization.
- Performance numbers are targets; nothing measured against a real terminal.
- The parser reads shape, not language, so it fences prose and bolds plain
  lines when output looks unusual.
- A PTY merges stderr into stdout, so error text is styled by pattern match.
  PowerShell error records come out as a bold paragraph plus a code block.
- bash and zsh ship untested; PowerShell is what this build was driven with.
- Unsigned builds, so SmartScreen warns on first run.
