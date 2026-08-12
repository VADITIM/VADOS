# Changelog

## Unreleased

### Output

- Output keeps the colour the program gave it. A block read the text off the screen and threw every cell attribute away, so `git status` rendered monochrome and the only tint in a block was the one derived from the shape of the text. Both now apply: the program's colour where it said something, the parser's where it did not. The sixteen ANSI colours are themeable and are the same in a block and in the raw view.
- Colour lands on the right characters on a row containing a CJK glyph, an emoji or a combining mark. Runs were indexed by terminal cell, and those characters do not take one cell each, so every colour boundary after one of them sat a character or two off the text it belonged to.
- A block can be shown as the bytes it arrived as, with Ctrl+Shift+R on the selected block, and copying it while it is raw copies those bytes. Every block now keeps its own byte log to do it with; before this the bytes were not kept at all, which is why the toggle never existed. Logs are capped and the oldest are dropped first, and a block that lost its own says so.
- Output arrives in fewer, larger pieces. The reader now holds a chunk back while the pipe still has more queued, rather than sending every read straight through, and cuts where an escape sequence will not be split. Nothing ticks while the terminal is idle, and a stream that goes quiet is sent immediately.
- Scrollback holds 10,000 rows rather than 20,000. The old figure was twice the budget the project is written against and nothing had been measured against either.
- A list row waves character by character like the prose around it, and does so one beat ahead of it. Rising as one piece read as a row that had failed to animate.
- Prose animates a line at a time. A command printing a line every second — a loop, a slow build — showed the first line rising and every line after it appearing with nothing, because the whole paragraph was one element and an element animates once.
- The bar that sweeps a result line or a status heading is that status's colour, red or green, instead of the accent.
- A block running a pager says `q quits`. `git diff` said `ctrl+c stops`, which is the one key `less` ignores — the pager's own prompt is still read first, and a command known to page now says so even when nothing recognisable was drawn.
- Every row of a streaming list waves as it arrives. Only the row still being written is held back now, rather than every row that was the newest at the time — which meant `ping` waved on its last reply and nothing else.
- A column table renders as one thing. `Get-ChildItem`'s file rows begin `-a----`, which is also how a diff writes a deleted line, so a directory listing came out as prose for its folders and a fenced diff for its files, with the timestamps in between tinted.
- Output that follows a progress spinner animates. A program erasing its own progress line — `npm ls`, `npm install` — cost the block one row, which was read as the program redrawing its whole screen and took the character wave off everything it printed afterwards.
- A block re-reads its output in full when the command ends. A program that draws a progress line over its own output — `npm ls` — could leave the block holding a spinner frame and nothing else.
- A code block is the last thing in a block to arrive, after the prose that introduces it, with its own flags and paths sweeping in tier order inside that slot.
- Links, timestamps and paths inside a code block are tinted and revealed like the same shapes in prose. A stack trace is paths and a log is timestamps, and both were flat.
- A block's result line sweeps its bar like any other status text, instead of its own scale pulse.
- The result line says what the exit code meant — `exit 130 · stopped (ctrl+c)`, `exit 127 · command not found` — and prints Windows status codes as hex, since `exit -1978335212` and `0x8A150014` are the same number and only one of them can be looked up.
- The bar at the foot of a running block stays for as long as the command runs. It used to disappear on the first line of output, so a command that printed two lines and stalled looked finished.

### Input

- Ctrl+C and any other key stops a running program on the first press. A key pressed while the keyboard had drifted onto something clicked earlier was dropped whenever a command was running, and in `vim`/`htop` nothing put the keyboard back at all — so the key that ends a program was the one most likely to be eaten.
- Settings opens on Shift+Esc. Bare Esc still closes it, drops a selection, dismisses a suggestion and deselects a block — and with none of those open it now reaches the shell, which is where PSReadLine's clear-line went.
- A cwd longer than 30 characters is shortened in the input bar to its last three folders, with one dot for each folder above them — `C:/Users/vadim/source/VADOS/src/lib` shows as `..../VADOS/src/lib`. The full path is the element's tooltip, and block heads still record it whole.
- The input keeps the keyboard whatever is clicked, and a key pressed while focus had already moved is written through instead of being dropped. Clicking a panel button or a block left the caret blinking in the bar while nothing typed anywhere.
- Ctrl+A selects the input line. It used to reach the webview, which selected the whole scrollback instead — and nothing could be done with that selection.
- Double-clicking the input bar selects the line the same way. Backspace deletes the selection and typing replaces it; both used to act on one character at the caret.
- Tab never moves focus into the output. A link in a block or a button in the panel could take the caret out of the input, with no way back except the mouse.
- A command can be found by what it does: typing `remove`, `list`, `search`, `download` and the like shows the command that does it, labelled with the word that found it.
- Running one of those words runs the command — `remove build` sends `rm build`, and the block records `rm build`, not the word. Words that are already commands somewhere (`copy`, `move`, `rename`, `kill`, `find`, `clear`) reach the shell untouched.

## 0.4.0

### Output

- One reveal for all output: bars sweep the coloured tokens in tier order, a character wave rises under the prose between them, played as content lands. The typewriter is deleted; it made one command's output look like two different products depending on where a PTY chunk boundary fell.
- The reveal setting is `Reveal` / `Instant`; the old `typewriter` value falls back to the default.
- Output that is genuinely markdown is read as markdown instead of guessed at, on evidence only: a reader command printing a `.md` file, or the text clearing a high bar on its own.
- A block takes its structure from the buffer only once the stream goes quiet (80ms, capped at 240ms), and its first paint waits up to 1.5s for the same. A growing buffer's structure is not final, so `ping`'s first replies used to mount as prose and be thrown away.
- A block's first content grows the box into it over 0.45s instead of snapping everything below it under the reader.
- A running command shows how to get out of it where the result line will go: pager keys when a pager is waiting, otherwise `ctrl+c stops`. One that has produced nothing yet shows an indeterminate bar.
- A list row animates when it arrives, and rises as one piece rather than character-waving. The reveal was on the `<ul>`, which fires once, so rows appended later got nothing.
- Long output is much faster. Text is read out of xterm's buffer from where the last read stopped rather than from the top, off-screen elements are shown without being animated or split, and a code block over 20k characters renders untinted. `git --no-pager diff` took seconds against a raw terminal's instant.
- On submit the `>` mark carries the line into the block and brings the prompt back on the way home.

### Parser

- `diff --git a/x b/x` is one code run again; `diff` was missing from the command list.
- Text that already contains backticks is no longer marked up a second time inside them.
- A blank line inside a diff hunk no longer ends the fence. A diff's blank context line is a single space.
- A run of `warning:` lines is one node per line again, instead of collapsing into a single twelve-row heading.
- A body under a heading is a list at any length, including one line. The old length test asked how a *finished* body looks, of one still arriving.

### Input bar

- Inline ghost completion: the rest of the line appears greyed after the caret, Tab or → accepts. Four sources in order, a line run earlier this session, a command name, a subcommand verb, then a path for every word after the first. The path source is what makes it survive the first space.
- The suggestion strip and the ghost are one thing with two views. ↑↓ move the selection and are the only thing that does.
- **Enter always runs the line.** Only a strip that was summoned, by a drop, or by Tab with nothing matching. ↑↓ at an empty prompt still reach the shell's own history.
- Accepting replaces the whole word rather than appending, which fixes the case: `cla` used to complete to `claUDE.md` and send exactly that to the shell.
- `..` completes like any other directory, so `cd ..` is one Tab away.
- The strip is centred over the input bar rather than flush left.
- The prompt no longer renders twice, the scroll stream's copy of the live input line is gone.
- Directory listings for completion are cached for one prompt cycle only: the command that just ran is the thing that creates and deletes files.

### Navigation

- A past block can be selected: Ctrl+Up/Down step through the scrollback, a click selects, Esc deselects, and a rail marks it. Chords rather than bare arrows, which belong to the shell's history and the strip.
- Ctrl+Shift+C copies the selected block, Ctrl+Shift+M copies it as markdown.
- `open <path>` opens a file or folder in whatever the system opens it with, resolved against the prompt's cwd. It never reaches the shell.
- Ctrl+B toggles a folder panel on the right, as a tree. It takes width rather than covering: the scrollback, input bar and strip narrow, and the PTY's column count follows, so the shell wraps where VAD/OS draws it. Costs readline's backward-char; raw mode keeps it.
- A folder opens in place on a click; shift+click replaces the prompt line with `cd <path>`. `..` at the top goes up. Clicking a file offers the same ways to run it that a dropped file gets.
- A file can be dragged out of the panel into any other application. A real OS drag, not an HTML5 one, a webview drag carries `text/plain` and every other app wants a file, which is what the stop cursor was. Always `copy`, never `move`: the panel cannot move, rename or edit anything.
- Nothing in the panel runs a command. It names a path; Enter stays the user's to press.

### Config

- Settings persist to `config.toml` in the platform config directory (`%APPDATA%\vados` / `~/.config/vados`), replacing the `localStorage` placeholder.
- External edits to the file apply without a restart. A file that exists but does not parse is left alone and the session runs on defaults.
- Startup directory setting, with a native folder picker. `~` is expanded before the PTY spawn, which does not shell-expand.
- Start as administrator, Unix only — wraps the next spawned shell in `sudo -E` and leaves the GUI unprivileged. Absent on Windows, where elevation has to be the whole process. Both are next-launch settings; restarting a live session is not the terminal's call.

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
