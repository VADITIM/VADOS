# Changelog

## 0.3.0

### Commands

- `help` lists every command and key binding.
- Commands accept a `/` prefix: `/help`, `/clear`, `/cls`.
- Commands no longer reach the shell, the typed line is erased from the line editor, so nothing lands in shell history.

### Input bar

- Suggestion strip above the input bar, one option as ghost text: Up/Down cycle, Enter writes it at the prompt, Esc dismisses.
- Dropping one file opens the strip with the usual ways to run it (`& …`, `bash …`, `python …`, `chmod +x … && …`) plus the bare path. Accepting only writes the line. Multiple files still go in as arguments.
- Tab opens the strip on the current directory, filtered by the word under the cursor, directories first. Takes Tab from the shell's completer, which runs inside a line editor the block renderer cannot see.
- Accepting an option erases the token it replaces with backspaces; the shell already holds those keystrokes.
- Menu items, quoting, path joining, text segmentation in `src/lib/input.js`. Self-check: `node src/lib/input.check.mjs`.
- Selection in the mirrored input is visible, read off the screen cells' background attributes: `translateToString` was dropping them.
- Mouse selection survives mouseup; the click handler that refocuses xterm was collapsing it.
- `::selection` themed off the accent, replacing a near-invisible system blue.

### Startup

- Shell starts in Rust's `setup` and its output is buffered until the frontend attaches, so PowerShell's startup overlaps the webview boot instead of queueing behind it.
- Window is created hidden and shown once sized and centred; it used to resize and re-centre on screen.

### Animation

- The typewriter writes with the input bar's caret: it rides the wipe's leading edge and steps with it. Caret and clip edge come out of one function (`revealHead`), since two copies of the same rounding drift apart.
- The typewriter is chosen per block, not per element. Everything inside a block still awaiting its command types; a block that has returned gets the static reveal. Previously the last registered element typed and its siblings swept in on bars, with the boundary falling wherever a PTY chunk landed.
- Typing is paced by block rather than by row: one element is one burst of `rows × 0.028s`, clamped to 0.12–0.26s, and the stagger is between elements. Reading-paced rows put a multi-line block seconds behind the shell now that a whole block types.
- One element types at a time, in document order; off-screen elements skip the queue because they have nothing to animate.
- A code block's box rises into place before the code types inside it. It is still never clipped — it was simply never animated either, so it appeared at full strength the frame it mounted.
- Submit spawns the block off the ghost line instead of flying it in: the `>` mark runs to the end of the command, the border draws outward from the top centre, then the box springs 0.4dvw wider and settles as content appears. 0.44s to the first revealed row.
- Drawn border is a masked gradient ring on its own layer, brightest at each growing end; a `border` cannot carry a gradient tracking a moving point. One custom property is both clip inset and head position.
- Arrival bounce runs on the drawn frame, not the block: `scale` would zoom the text, padding or margin would push it sideways. The block's own border stays transparent until the bounce lands.
- Draw is 0.34s `power2.inOut`; an `out` ease is most of the way across before the eye finds it.
- Submit gesture is claimed for 600ms after Enter, up from 250ms: slower shell round trips were producing blocks that skipped the draw.
- A block's whole content is hidden until the border finishes drawing, not only its text. A code block's box was appearing before its container.
- Copying a block leans it toward the cursor and shrinks it slightly, then settles. 0.28s; amplitude is a `dv` distance, the pointer supplies direction only.
- Label reveal: an accent bar sweeps a coloured token, then retreats while the text opens behind it. Bars live in a static overlay, since a clip applies to the element's own decoration.
- Labels are the parser's token classes, tiered by saturation 0.2s apart: status colours, accent-filled tokens, paths, flags and links, placeholders. Ranking in `src/lib/reveal-plan.js`.
- Bar timing: 0.28s sweep, 0.32s retreat, both `power3.inOut`, text set visible under the bar rather than tweened.
- A bar covers the label's text, not its box: measured off a `Range`, one bar per line rect. A heading or list item is a block, so its box ran the full container width.
- Warnings sweep red whatever the accent is.
- Grey prose rises character by character in a wave, characters grouped into words so lines cannot wrap mid-word. Past 400 characters the unit is the word; wave capped at 0.6s.
- An element is revealed once, by one animation. A live element that stops being live is shown and dropped.
- Typewriter runs only on the last element of an open block. Chosen in the reveal pass, not at mount, where nothing has arrived yet.
- Reveal setting: `Typewriter` (labels and wave on finished text, typing on live) or `Instant` (elements rise as one, 0.8dvh `power3.out`). Replaces the typewriter A/B control. Output only panel, suggestion strip and border draw keep their animation; reduced motion still disables everything.
- Settings panel is centred, rises from 6dvh below, leaves upward; changing a setting flickers characters of the chosen option.
- Typewriter reveal: one left-to-right wipe per rendered row, quantized to a character grid. A wrapped line gets one reveal per visual row. Same in plain and structured output. A code block's box is present before its text types.
- Reveal is clamped to the viewport: rows off screen are shown, not animated.
- Flood control: more than 40 pending rows appears at once; in "move down" the stagger falls as the backlog grows.
- Row wipe 0.225s, stagger 0.096s.
- Pointer-tracked hover ring on blocks.
- Result line pulses on completion; banner divider draws in from the left.
- Raw view switch is a crossfade.
- `clear` sweeps blocks out instead of removing them.
- Caret returns to line start, stops blinking, and stays visible while a command runs.
- All of the above are skipped under reduced motion, except the hover ring.

### Output rendering

- A full command line is marked up as one unit, not a lone flag mid-sentence. Commands that are also ordinary words are left alone.
- Blocks VAD/OS writes itself carry their own structure instead of going through the shape detector.

### Settings

- Font modes are an X; accents are a grid; scroll mode and reveal mode are switches.
- Panel is three titled cards: Font, Color, and both switches. The font X is four quadrants, so all four labels sit horizontally; the old triangle wedges turned two of them on their side. Selection is a blob on the X's arm.
- Accent swatches are round, three across.
- A switch shows both states either side of the knob, lit side underlined in the accent and carrying the toggle flicker. Per-mode hints moved to the row's tooltip.
- Four accents added: red, green, pink, white. White is `#e8e8ec`.

### File system

- Drop a file on the window to insert its path at the prompt, quoted. Uses Tauri's native drag-drop, not the HTML5 `drop` event, which is unreliable under webkit2gtk.

### Fixes

- No white flash on launch: window `backgroundColor`, `color-scheme: dark`, and an inline background in `app.html`; one per startup stage.
- Input renders again after Ctrl+C: PowerShell echoes `^C` before the redrawn prompt, which the anchored prompt regex could not match.
- Esc always toggles settings; it was in xterm's key handler, so any click in the panel disarmed it.
- Focus returns to the input when settings close or a file is dropped.
- "Move down" plays its reveals correctly: the pass measured rects against a viewport still travelling, since the scroll starts from a `ResizeObserver` delivered after its `requestAnimationFrame`. Now waits for the view to settle, capped at 30 frames.
- List items no longer stack their characters on one spot mid-wave: `text-indent` is inherited and re-applied inside each split span, which is an inline-block and so a block container of its own.
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

### Settings and appearance

- Settings panel: accent colour, font mode, scroll behaviour for new commands.
- Font modes (Mixed, Mixed Reverse, Sans, Modern), a rule for where mono
  applies, not a font picker. Code, ASCII banners, and the raw view stay mono.

### Animation

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
