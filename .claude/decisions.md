# Decisions

Settled. Check here before re-opening any of these.

## Product

**Compatibility first, beauty second.** If VAD/OS behaves like a normal terminal for normal output and only upgrades where it is confident, there is no reason to stay on another terminal. If it mangles `ls` to look designed, there is no reason to switch to this one. Every rendering feature is measured against that order, not against how good the screenshot looks.

**Markdown rendering is opt-in on evidence, never assumed.** Output renders raw unless a program declares markdown or a detector clears a high bar. Parsing all output as markdown was considered and rejected: most output is plain or ANSI, and the failure mode (a stray `*` italicising a diff, a `#` eating a comment line) is silent corruption of the thing the user asked to see.

**Every block can be toggled back to raw, and keeps its bytes to do it with.** This is what makes an aggressive renderer safe. Consequence: a block's snapshot is retained even after it renders, so it counts against the scrollback memory budget in [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

**VAD/OS is a terminal, not a shell.** It hosts PowerShell, cmd, WSL, Git Bash, bash, zsh, fish, or any configured binary. PowerShell is the Windows default because it is preinstalled and maintained, not because anything is built on it. No renderer feature may require a specific shell.

**No built-in AI client.** VAD/OS renders LLM output well — that is the point of the markdown path, since `claude` and friends emit markdown into a terminal that cannot show it. It does not ship a model, an API key field, or a chat panel. Those are someone else's product, they age badly, and they would make the terminal a place you have to trust with credentials.

**Export is a document feature, not a screenshot feature.** Markdown, HTML, and PDF all come off the same AST the screen renders from. No "print the DOM" path — it would carry app chrome into the output and break the moment the styling changes.

**No real Docker.** "Container" in the original discussion meant the UI-level fenced block that isolates raw/live output so it cannot break the markdown layout — in current vocabulary that is a **module's** live region, and "container" now means a region of the window that holds modules. See the glossary in [architecture.md](architecture.md). Commands execute on the host. Real containerisation was considered and rejected: it needs Docker Desktop on Windows, breaks the "run my local git/npm" expectation, and adds latency for no benefit here.

**No multi-tab.** Explicitly rejected — Windows Terminal has it and it goes unused; people open a second window instead.

**No plugin system.** Rejected. Settings are a fixed, curated GUI, not an extension surface.

**Settings are a GUI overlay, not a window.** Opens on Esc, in place over the terminal with a blurred backdrop, centred in the window. Centred rather than docked to an edge is the same rule as everything below: an edge-docked panel is a drawer, and this is not one.

**Esc is handled on the window, not in the terminal's key handler.** The terminal's handler only runs while its textarea has focus, so it silently stopped working the moment the user clicked anything inside the panel — which is exactly when they want to press Esc. The terminal's handler keeps only the `preventDefault`, so the shell still never sees the key in block mode.

**Every path that closes a surface hands focus back to the input.** The terminal is the input engine even when it is invisible, and it cannot be clicked to regain focus. A close path that forgets this leaves a user typing into nothing, with no visible sign of why — the most expensive failure in the app for how cheap it is to prevent.

**File drops go through the native drag-drop, never the HTML5 `drop` event.** This is the fix for the Linux problem, not a preference. Under webkit2gtk an HTML5 file drop only materialises when the drag source offers `text/uri-list` in a form the webview recognises, and many editors and file managers offer a private target first — which is what "drag and drop works in some apps, sometimes" actually is. The native path registers a drag destination on the *window* (GTK on Linux, OLE on Windows) and hands over resolved paths, so it sees drags the DOM is never told about, on one code path for both platforms. The webview's own drag handling has to stay off for this, which is the default; turning it back on to get HTML5 drops would take these events away.

A dropped path is written at the prompt as an argument and nothing runs. A drop is a noun, not a sentence — what to do with the file is still the user's to finish typing.

**The scrollbar is drawn over the output container, not laid out inside it.** A classic scrollbar takes layout width on one side only, so every module sits off-centre by exactly its width. Chromium dropped `overflow: overlay`, and `scrollbar-gutter: stable both-edges` solves the symmetry by reserving the gutter twice — paying the width on both sides instead of neither. So the native bar is hidden and a thumb is positioned over the side gap. It is draggable; a scroll indicator you cannot grab is a downgrade from the thing it replaced.

**Modules float; nothing docks to an edge.** Every module — input, output, settings, debug, and whatever comes later — rests over its container — inset on all sides, rounded on all corners, lifted with its own shadow. No drawer welded to the frame, no full-bleed sidebar, no element whose border runs off the window. This holds for almost everything in the UI, so the exceptions are the thing to justify, not the rule.

**No overlay has a fixed width or height — and no fixed minimum either.** Every floating surface — settings, debug, and whatever comes later — sizes itself from the window in `dv` units, with a `dvh` cap and its own scroll for the overflow. A panel that keeps its pixel width on a small window stops being a module resting over the terminal and becomes a wall across it.

The correction that took a second pass: a single proportional width is not enough on its own. The panel's contents — labels, hints, swatches — do not shrink with the window, so a flat `30dvw` goes unreadable long before it goes small. The shape that holds is `clamp(30dvw, <preference>, 88dvw)`: **both bounds are viewport units**, so the panel takes a larger share of a narrow window and a smaller one of a wide window, with no pixel floor anywhere. Type is the exception and stays in `rem` — it should track the reader's font size, not the window.

Two consequences that are not obvious: a floating surface needs real elevation or the inset reads as a rendering gap rather than a choice, and the entrance motion has to match — a lateral slide from the right is the tell of a drawer, so floating panels rise into place instead.

**The reveal an element gets is decided by whether it can still change, and that is decided in the reveal pass, never at mount.** At mount nothing has arrived yet, so nothing is knowable — the pass asks instead which element is the last one inside a block that has not closed. That one types; everything above it is finished and gets the static reveal. Typing out text that was already complete is what made the typewriter look messy: it was animating the wrong thing, not animating wrongly. `REVEAL_MODES` keeps whole-typewriter available as the A/B control while the two are compared; a switch to settle a question with, not a permanent preference.

**The parse is the identification for the animation.** The parser already decided what every run of text is, and the renderer wrote that decision onto the element as a class. The animation reads it back rather than re-deriving it, so it knows nothing about markdown and cannot disagree with the parser about what a line contains. Adding a token kind is a row in the parser and a row in `reveal-plan.js` — never a new code path in the animation.

**Colour decides which reveal a run of text gets, and saturation decides when.** A colour is the parser saying *this run means something specific*: anything tinted is a label and sweeps under an accent bar, anything grey is prose and rises in the character wave. Tiers play most-saturated first — status colours, then accent-filled tokens, then the complement, then the accent text, then the softest tint — because the order the eye receives them in should be the order of how much they matter. An empty tier is skipped rather than held open, so the number of beats is the number of *kinds of thing* in the line.

**Fonts are a scope rule, not a font picker.** Two slots — `--font-outside` and `--font-inside` — and a mode is a pair of assignments to them, so adding a mode is a row in `FONT_MODES` and nothing else. "Modern" means mono everywhere; the name predates the decision and was kept because it is what the README already called that row. Code blocks, inline code, the ASCII banner and its divider, and the raw view ignore both slots and stay monospace in every mode, because alignment is load-bearing there and taste is not.

**Where the view lands on a new command is a preference, not a default to get right.** Anchoring the new block's head near the top lets long output read as a document from its first line; jumping to the tail gets you to the newest output without waiting. Both are correct for different work, so the toggle is the answer rather than a tuned compromise. Tail-following stops the moment the reader scrolls up — a feed that yanks the view back down cannot be read at all. That detachment is tracked from scroll events fired while nothing is tweening, **never inferred from how far the tail has moved**: one large output chunk jumps further than any scroll gesture, so a distance heuristic silently refuses to follow exactly the commands that produce enough output to need following.

**Switching the mode moves the view, in either direction.** Toggling is the reader saying where they want to be, so "stay on top" scrolls back up to the current command and "move down" goes to the tail. Opening a block, by contrast, only ever moves forward — output must never drag the reader backwards.

**The command line sticks to the top of an overflowing block.** Same affordance an editor uses to keep the enclosing function name visible: once output is taller than the screen, the line telling you which command produced it is the first thing to leave. A hairline rule appears under it only while pinned, so it reads as chrome that arrived rather than a divider that was always there.

## Technical

**Tauri over Electron.** Small binary, native window, and the webview preserves full CSS freedom — no native widget lock-in. Electron would work but is heavier and worse on the performance axis that this project is built around.

**SvelteKit kept, not swapped for bare Svelte + Vite.** The scaffold ships SvelteKit in SPA mode (`adapter-static`, `ssr = false`). Its router is unused, but in SPA mode it costs nothing at runtime and re-scaffolding would be pure churn.

**xterm.js is the fallback, not the main view.** See [architecture.md](architecture.md). Consequence: xterm's own theming and font settings only matter inside alt-screen apps.

**Raw bytes over `tauri::ipc::Channel`, not `emit`.** Channels are the intended path for high-frequency binary streams; `emit` adds per-event JSON overhead. Rust never decodes to `String` — that would corrupt multi-byte characters split across reads.

**PowerShell on Windows, not `cmd.exe`.** `CommandBuilder::new_default_prog()` resolves to `cmd.exe` via `ComSpec`, so the shell is named explicitly instead.

**TOML over JSON for config.** Humans will hand-edit it. Comments, and no trailing-comma footguns.

**Config lives in the OS-standard dir** via Tauri's `path::app_config_dir()` — `%APPDATA%\vados\` on Windows, `~/.config/vados/` on Linux. Never hardcoded.

**OSC markers are parsed in the frontend by xterm, never in Rust.** Rust is a dumb pipe. Parsing them in Rust means delivering them out-of-band from the bytes they describe, and there is no ordering guarantee between two Tauri channels — a fast command's output arrives in the same 8 KB read as its own `133;D` and the next prompt, so the event overtakes the data and the output is attributed to the wrong command. xterm's `registerOscHandler` runs mid-parse at the exact cursor position. Reverted once already; do not reintroduce.

**The parser emits nodes, never a markup string.** Structured nodes render through Svelte, which escapes text, so arbitrary command output can never be read as markup. Any renderer swap must preserve this. A renderer that hands back an HTML string reopens the injection surface and is disqualified on that alone, regardless of how good it is.

**One AST feeds screen, clipboard, and export.** `copy as markdown` already works this way. Export follows. A parser rule must never need writing twice.

**Syntax tinting inside a code block is colour-only, and keyed on shape rather than language.** Three token kinds are tinted — CLI flags, `<placeholder>`s, and quoted strings — because those three mean the same thing in `git diff --help`, a shell script, and a compiler error, which no keyword list does. Nothing that changes metrics is allowed: a code block's columns line up only because every glyph is the same width, so padding, background, weight, or letter-spacing on a token would shift every character after it on that row. This is the "except code blocks" carve-out that keeps them monospace in every font mode, applied to highlighting — tint the token, never resize it. The inline-code chip style is therefore explicitly not reused inside a fence. Real language-aware highlighting, if it ever arrives, inherits the same constraint.

**A command is marked up whole, and the command list is curated rather than detected.** `git diff --no-index [<options>] <path>` is one thing a reader recognises; backticking only the `--no-index` out of the middle of it splits one idea into three. So a known command name, an optional known subcommand verb, and the argument-shaped tokens after them are one inline code run. Both lists are hand-kept in `src/lib/parse.js`: reading `PATH` or asking the shell what is executable would cover every command instead of eighty, at the price of a round trip per render to tell `git` from `gti`. **The subcommand list is a whitelist and was a blacklist first** — the set of English words that can follow a tool name is open ("git is not installed", "cmd instead" both slipped through), the set of verbs tools use for subcommands is small and shared. An unlisted subcommand degrades to the command name plus separately-tinted flags: worse, never wrong. Names that are also ordinary English words (`make`, `find`, `go`, `type`, `echo`) are deliberately absent, because those are what turn a sentence in a program's output into a fake command.

**Embeds are leaves.** A mermaid diagram, image, or video occupies a block-level slot and does not participate in the character grid or the row-staggered reveal. Trying to align an embed to the terminal grid was rejected before it was built — grid alignment is what forces every other terminal into Sixel-shaped compromises.

**OSC 133 over prompt heuristics.** Matching the prompt string breaks on custom prompts, multiline prompts, oh-my-zsh, and starship. The cost of OSC 133 is shell init injection; worth it.

## Animation

**GSAP, no alternatives.** See [docs/ANIMATION.md](docs/ANIMATION.md) for the binding rules.

**Stagger by rendered row, 0.12s.** Per-character staggering is forbidden — an 80-column line would take four seconds and produce thousands of tweens.

**Typewriter = a `clipPath` wipe quantized to a character grid.** A stepped wipe reads as character-by-character typing at a fraction of the cost of real per-character animation. The stepping is what makes it typing rather than a fade.

**The reveal is a clip staircase on the element, never `SplitText`.** This reverses the original call, and the reason is a lifecycle conflict rather than a preference: `SplitText` replaces an element's `innerHTML` with one wrapper per row and restores a saved HTML *string* on `revert()`, both of which detach the text nodes Svelte is holding. Output elements re-render from the parser on every PTY chunk, so the first reveal of a streaming element would be the last update it ever received — the block frozen at whatever text it held, while the shell went on producing output nobody could see. It would only have shown up on long-running commands, i.e. after shipping. The replacement clips the element itself: rows above the cursor visible, the cursor's row wiped, the rest clipped. No DOM touched, nothing to revert, one tween per element. Rules in [docs/ANIMATION.md](docs/ANIMATION.md); geometry and its self-check in `src/lib/reveal.js`.

**The reveal's clip is permanent while an element can still grow, and never covers chrome.** Two consequences of the above that are easy to undo by accident. Clearing the clip between chunks puts the next chunk's text on screen for the frame before the reveal runs — text appears, vanishes, then types itself in. And a code block's box, border and background are already there while its contents arrive; clipping the container animates the box in, which says something different and wrong. Text that shares an element with chrome gets its own inner element.

**Every action is a handoff, not an appearance.** Content moving between regions of the UI animates as one gesture — retract, pop from the retracted size, travel — so the eye follows it to where it went. "The action happens and then a thing fades in" is the pattern this replaces. Specified in [docs/ANIMATION.md](docs/ANIMATION.md).

**One focal element per action; everything else is at 40% amplitude with no overshoot.** Two things moving at full amplitude means neither is the subject, and the animation has stopped guiding anything. This is a rule about meaning, not about restraint.

**Two overshoot characters, and they are not interchangeable.** Elastic (`back.out`) goes on the element gaining focus; a discrete, quantized settle goes on the element losing it. Elastic pulls the eye, discrete releases it. Swapping them inverts what the motion says, so it is a correctness bug rather than a taste call.

**Everything that enters also leaves.** Anything dismissable — panel, toast, collapsed section, removed block — plays an exit rather than blinking out. An entrance without an exit is worse than no animation at all: the entrance establishes that the object is physically present, and the cut then contradicts it. A cut reads as malfunction, which is the one thing a terminal must never fake. The exit is shorter than the entrance, eased `in`, and never overshoots — overshoot means *arrived*. Rules in [docs/ANIMATION.md](docs/ANIMATION.md).

**Nothing animates because time passed.** No idle glitch, no infinite CSS animation, no ambient loop. Idle CPU is budgeted at literally zero ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)), and an effect nobody triggered is battery spent to be noticed.

**The character glitch is the toggle's state-change animation.** Not a panel-entrance decoration and not idle chrome — it fires when a toggle flips, on that toggle's own label. Same effect the portfolio loops forever, spent on the one moment it means something. Panel and overlay entrances keep the separate stuttered slide; nothing else glitches, and never a command block or output. Simulated malfunction in a terminal is indistinguishable from real malfunction.

**Gesture amplitude is a fixed `dv` distance, never a constant scale factor.** `scaleX: 0.82` retracts a 600px input by 108px and a 1600px one by 288px — same code, two different gestures. Retract to a fixed distance and derive the scale from the measured width.

**`dv` units are the house unit** for distances and layout, over `vw`/`vh`/`%`. In a Tauri webview `dvh` and `vh` resolve identically, so it costs nothing today and is already right anywhere it would not. `rem` still wins for type.

**No SCSS. The token layer is plain CSS custom properties.** SCSS was the original plan and earned nothing once the layer was written: the whole point of these tokens is that they are swappable *at runtime*, which custom properties do natively and a preprocessor cannot. A build step computing values that then have to stay live is backwards. Reopen only when nesting or mixins pay for themselves somewhere concrete.

**Accent tints are derived from `--accent` with `color-mix`, never picked alongside it.** A hand-tuned violet for inline code is correct against exactly one accent and wrong against the other three, and the wrongness is invisible until someone switches. This costs some fidelity — the derived values are near the originals, not identical — and that trade is deliberate.

**Fixed colors are exempt from theming.** Success green, error red, and muted grey never read from `--accent`. Only the app accent (indigo `#7e55dd` default, plus blue / yellow / orange) is swappable.
