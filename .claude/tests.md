# Tests

What needs checking **on screen**, written by Claude at the end of any turn that changed behaviour. Nothing here is automated — these are the things a build, a typecheck and a self-check cannot tell us.

**How to use it:** run a check, then mark it. `[x]` passed, `[!]` failed (add a line saying what you saw). Anything still `[ ]` is unverified and must not be treated as done. Resolved sections get deleted once the whole section is `[x]` — this file is a queue, not a history. What the fix *was* belongs in the CHANGELOG; why it broke belongs in [docs/QUIRKS.md](docs/QUIRKS.md).

Order matters: the top section is the newest.

---

## 2026-08-09 (latest) — A paged command says `q`, not `ctrl+c`

`git diff` showed `running · ctrl+c stops` while `less` held the keyboard, and `less` ignores an interrupt. The pager's own prompt (`:`, `(END)`, `--More--`) is still read out of the block first; a command that is known to page now says so on its own when that prompt is not recognised. `runHint` in `parse.js`.

- [ ] `git diff` on something long enough to page. The foot reads **`q quits the pager · ctrl+c stops`**. Press `q`: the block ends. This is the report.
- [ ] Same block, once you page down to the bottom: if the foot changes to `q quits · space pages · / searches`, the pager's prompt is being read and that is the stronger path working. **Say which of the two you saw** — if it is always the command-derived one, the prompt never reaches the block and that is worth knowing.
- [ ] If it is still wrong, press F3 (or toggle the block to raw) and report **what the block's last line actually is** while `less` is waiting. That line is the evidence this reads.
- [ ] `git --no-pager diff`, `git status`, `npm ls`. Back to `running · ctrl+c stops` — nothing that does not page may claim to.
- [ ] `man ls` (Git Bash), or anything piped into `less`. Says `q quits the pager`.
- [ ] `git commit -m "log this"`. Not paged — the subcommand is read in its own position, so a paged word inside a message must not trip it.

---

## 2026-08-09 — The first Ctrl+C is the one that works

The reported fault: keys that stop a program had to be pressed several times. A key pressed while the keyboard had drifted elsewhere is written through by hand, and that recovery excluded the three cases that mattered — raw mode had no recovery at all, `atPrompt` excluded every key pressed while a command was running, and a modifier chord was never written through. `keyBytes` / `appKey` in `+page.svelte`.

**Every check below is "click something first, then press the key once."** That is the whole bug; pressing keys without clicking never showed it.

- [ ] `ping -t 8.8.8.8`. Click a block, the banner, the empty space beside the input. Now press **Ctrl+C once**. It stops. This is the report.
- [ ] Same, but click the cwd panel (Ctrl+B) or a folder in it first. One Ctrl+C.
- [ ] `htop` or `vim` (raw mode). Click somewhere outside the terminal, then press `q` / Esc `:q` once. It reaches the program — before this there was nothing at all putting the keyboard back in raw mode.
- [ ] `claude`, or anything else that repaints inline. Ctrl+C once after a click.
- [ ] A command that asks something (`Read-Host`, a `y/n` prompt). Click a block, then type the answer. The **first** character lands.
- [ ] With a command running, click a block and press Ctrl+C — the block's reveal stops as well; no bars are left drawn and no text is left half-animated.
- [ ] Open settings (Shift+Esc), click the startup-directory field, type. The characters still land **in the field** — a real text field keeps every key, and that guard must not have been widened.
- [ ] Ctrl+A, Ctrl+B, Ctrl+Shift+C after clicking a block. Each still does its own job rather than being sent to the shell as a control byte.
- [ ] Without clicking anything at all, everything above behaves as it always did. This path only runs when the keyboard was somewhere else.

---

## 2026-08-09 — Every row waves; settings moved to Shift+Esc

The reported fault: `ping`'s first three replies rose as one piece and only the fourth waved. The tail element of an open block is held back from the character split because output is appended to it — but each row is the tail at the instant it lands, so every row was held and only the last was released, when the block closed. It is now held only while its line is unfinished (`tailComplete`, the cursor at column 0). Separately, the settings panel moved off Esc.

- [ ] `ping 8.8.8.8`. **Every reply waves character by character as it lands**, including the first. This is the report.
- [ ] Same run: the row currently being written is the only thing that may rise as one piece, and on line-at-a-time output like this you should not see even that.
- [ ] `foreach ($i in 1..10) { $i; Start-Sleep 1 }`, `ls`, `npm ls`. Same: no row rises as one piece.
- [ ] Something that prints without a newline and keeps going — `Write-Host -NoNewline`, a build's progress line, `curl` downloading. The half-written line must **not** tear, freeze mid-word, or show characters out of order. This is what the hold is for and the only way to see it fail.
- [ ] `less` or another pager, and a command with a spinner. Unchanged from the section below — the repaint rule is separate and still applies.
- [ ] **Shift+Esc** opens settings. Shift+Esc again closes it, with the same exit motion as before.
- [ ] Bare **Esc** with the panel open still closes it. From inside the startup-directory field too.
- [ ] Bare Esc with a suggestion strip up dismisses the strip, with a block selected deselects it, with the input selected (Ctrl+A) drops the selection. None of them open settings any more.
- [ ] Bare Esc with **nothing** open, at a prompt with something typed: PSReadLine clears the line. That key is given back — this is the check that it actually arrived.
- [ ] `vim`: Esc still leaves insert mode, and Shift+Esc reaches vim rather than opening the panel.
- [ ] `/help` lists Shift+Esc and the new Esc line.

---

## 2026-08-09 — Plain words run, and a table is one thing

Two from the same report. Submitting `list` failed with a not-recognised error, so a plain word is now swapped for its command as the line is sent (`wordCommand`, `input.js`) — the shell echoes and records the real name. And `ls` came out as prose for its directory rows and a fenced diff for its file rows, because `-a----` is a dash followed by a letter and so is a diff's deleted line; a rule line (`---- ---- ----`) now takes the whole table as one node.

- [ ] Type `list` and press Enter. `ls` runs, and the **block head reads `ls`**, not `list`. This is the report.
- [ ] `remove tmp.txt`, `search foo`, `download <url>`. Each runs the real command with its arguments intact — nothing is lost, reordered or requoted.
- [ ] `copy a b`, `move a b`, `kill 123`, `find x`. These are **not** swapped: the shell gets the word, because each of them already runs something. `clear` still clears the screen locally.
- [ ] `git remove x`. Past the first word nothing is touched — the shell gets `git remove x` and complains, as it should.
- [ ] Type `remo` and Tab. The strip still writes `rm`; half a word is never swapped on Enter.
- [ ] Press ↑ after running `list`. The shell's history holds `ls` — what ran is what is remembered.
- [ ] Paste `list` plus a newline in one go (Ctrl+V then Enter, or a paste that ends in a newline). It is **not** swapped, deliberately: the mirrored line lags a paste and a swap from a line we are not sure of would send something nobody typed. Report it if that reads wrong.
- [ ] `ls` / `Get-ChildItem` in this repo. **One** block: header, rule line, folders and files all in the same box, columns aligned, `.svelte-kit` intact. Before, the folders were prose with tinted timestamps and the files were a separate fence.
- [ ] `ls -la` in Git Bash, `docker ps`, `netstat -an`, `Get-Process`. Each is one aligned block, nothing split at a row boundary.
- [ ] `git --no-pager diff`. Still a diff: `--- a/x.js` has text on the line, so it is not a rule line and nothing about diffs changed.
- [ ] Output with a `-------` divider line under a heading. Unchanged — one dash run is a divider, and the prose around it must not be swallowed into a box.
- [ ] `/help` lists both plain-word lines, including which words are never swapped.

---

## 2026-08-09 — A spinner is not a repaint

`npm ls --all` landing with no wave at all, reported against the section below. A block that loses height is flagged as a program redrawing its screen and never character-splits again; npm's progress spinner erases its own line, costs the block one row, and tripped that flag before the tree existed. The flag now needs a drop of more than two rows. Same root cause as the lone `\` — both are that spinner.

- [ ] `npm ls --all`. The tree **waves character by character** as it lands. This is the report.
- [ ] `npm install` in a fresh clone, or anything else with a progress line. Same: the output after the spinner waves.
- [ ] `less` on a long file, paged through — the case the flag exists for. Rows repaint without tearing or freezing mid-word. If text ever sticks half-animated, the threshold is too high and that is worth saying.
- [ ] `ping -t 8.8.8.8` for a while, then Ctrl+C. Rows still wave, nothing left stuck.

### The mojibake is not ours

`Get-Content CLAUDE.md` showing `â€"` where the file has `—` was measured, not guessed: Windows PowerShell 5.1 reads a file with no BOM as the ANSI codepage, so it corrupts the text before the terminal sees a byte. 31 of the first 60 lines of `CLAUDE.md` come back wrong; the same read with `-Encoding UTF8` comes back clean. Nothing was changed for it — a terminal that injected encoding defaults into the shell would be answering for the shell, and would break genuinely ANSI files in the other direction.

- [ ] `Get-Content CLAUDE.md -Encoding UTF8`. No `â€`. This is the confirmation, and the workaround.
- [ ] The same `Get-Content CLAUDE.md` in Windows Terminal or the raw console. It is mojibake there too — that is what says the terminal is not the one corrupting it.
- [ ] With the clean read on screen, the check the mojibake was hiding: real headings, real fences, real lists, no invented headings, and `right-click` not read as a flag.

---

## 2026-08-09 — Streaming prose animates per line; status bars; npm ls

Three reports from the round above. Prose is now one element per line (`lineParts`, capped at `LINE_MAX`), so a line animates when it arrives. A reveal bar takes the status colour of what it uncovers. The final snapshot re-reads the block in full, which is the candidate fix for `npm ls` showing a lone `\`.

- [ ] `foreach ($i in 1..10) { $i; Start-Sleep 1 }`. **Every number waves as it lands**, not just the first. This is the report.
- [ ] Same run: the number currently arriving rises as one piece (it is live and cannot be split); the ones before it waved character by character.
- [ ] `git status`, `npm --help`. Multi-line prose still reads as one paragraph — no extra gaps between lines, no lost blank lines, no line running off the right edge instead of wrapping.
- [ ] A line longer than the window. It wraps inside the block as before and the wave crosses the wrap.
- [ ] `git status` on a clean repo: the `done` bar is **green**, not purple. `git nope`: the `exit 1 · failed` bar is **red**.
- [ ] A `warning:`/`error:` heading in output still sweeps a red bar (this is the case that already worked — it must not have regressed).
- [ ] `npm ls`, several times. The block holds the dependency tree every time. A block showing only `\` is the reported bug and means the full re-read did not cover it — say so rather than assuming it is fixed.
- [ ] `npm ls --all` or another long listing. It is not slower than before: the re-read at command end is one extra pass over the block's rows.
- [ ] `cat` or `Get-Content` on a file of several thousand lines. Still lands promptly — past `LINE_MAX` lines the node is one element again, and this is the check that the cap is doing its job.

---

## 2026-08-09 — Shortened cwd in the input bar

`shortCwd` in `input.js`: past 30 characters the path shows its last three segments, one dot per segment above them. Display only — the bar's tooltip and every block head still carry the full path.

- [ ] `cd` somewhere deep (`src/lib` in this repo). The bar reads `..../VADOS/src/lib` — dots first, then the last three folders.
- [ ] `cd` somewhere short (`C:/Users/vadim`). Unchanged, no dots.
- [ ] Hover the path in the bar. The tooltip is the full path.
- [ ] Run a command from a deep folder. The **block head** shows the whole path, not the shortened one — the head is the record of where it ran.
- [ ] Watch the submit handoff from a deep folder: the `>` mark carries the line into the block. The path must not visibly jump or re-letter mid-flight as the short form is replaced by the full one.
- [ ] The caret and the typed text sit where they did — shortening the path must not move the input columns.

---

## 2026-08-09 — Input keeps the keyboard; select-all is ours

Four changes to the input bar. `selectAll` is a selection VAD/OS owns (Ctrl+A, or double-click on the bar) and the edit after it is replayed to the shell as backspaces and deletes. Tab is taken on the window in the capture phase so it can never move focus. A `focusout` watchdog puts the keyboard back on the input, and a key pressed while focus was already elsewhere is written through rather than dropped.

**The focus one is the important one — it is the reported bug, and the rest is worth nothing if this is still wrong.**

- [ ] Type something. Click the cwd panel (Ctrl+B), click a folder, click a block, click the empty space beside the input, click the banner. After **each** click, type — the characters appear. Not one of them may be swallowed.
- [ ] Same round trip, but check the *first* character each time. That is the one the watchdog cannot save and the write-through has to.
- [ ] Drag-select some output text with the mouse. It stays selected while the button is released. Then type — the text goes to the shell.
- [ ] Open settings (Esc), click the startup-directory field, type. The text lands **in the field**, not at the prompt. Esc still closes the panel.
- [ ] Type a command, press Ctrl+A. The whole input line is highlighted and **the page is not** — no block, no banner, nothing in the scrollback highlights.
- [ ] With it selected, press Backspace. The whole line goes, not one character. This is the reported bug.
- [ ] Select again and type a letter. The line is replaced by that letter.
- [ ] Select again and press → or Home. The selection clears and the caret moves; nothing is deleted.
- [ ] Double-click the input bar. Same selection, same Backspace behaviour.
- [ ] Press Tab with a block clicked, with the panel open, and after clicking a link in output. Focus never lands in the output — Tab completes at the prompt every time.
- [ ] `vim` or `htop` (raw mode). Ctrl+A, Tab and Esc all reach the app untouched.
- [ ] `/help` lists Ctrl+A and the double-click.

---

## 2026-08-09 — Commands found by their plain word

`COMMAND_WORDS` in `input.js` maps an abbreviated command to the words for what it does; `wordSuggestions` matches them on the **first word only** and offers the command with the word as its hint. Nothing rewrites the line — the word is a search key, not an alias.

- [ ] Type `remove` at the prompt. The strip offers `rm`, labelled `remove`. Tab writes `rm` — the typed word is erased, not appended to.
- [ ] Type `list`, `copy`, `move`, `search`, `kill`, `clear`. Each finds its command (`ls`, `cp`, `mv`, `grep`, `taskkill`, `cls`).
- [ ] Type `re`. Several commands match at once and each appears **once**, in the order `rm`, `mv`, `sed`, `curl` — `remove` and `delete` are both `rm` and must not offer it twice.
- [ ] Type `c`. Real command names come first; the word matches are below them.
- [ ] Type `git remove`. **No** word match — past the first word the strip is completing arguments.
- [ ] Type `remove` and press **Enter** without taking the match — see the newest section, this behaviour was replaced.
- [ ] `/help` lists the feature under Keys.

---

## 2026-08-09 — Result line sweeps, and says what happened

`resultPulse` is deleted; the result line is `use:reveal` at tier 0 (`block-result` in `labelTier`), rank 0 so it does not wait. Its text comes from `exitLabel` in `parse.js`, which names known codes and prints anything wider than a byte as hex.

- [ ] `git status`. The `done` line **sweeps a bar** like a status heading, not the old scale-pop. It arrives as soon as the block closes, with no beat of waiting.
- [ ] A failing command (`git nope`, `cd /nowhere`). The `exit …` line sweeps the same way and is red — the two must be the same gesture.
- [ ] Ctrl+C a running command. The line reads `exit 130 · stopped (ctrl+c)` on POSIX, or `exit 0xc000013a · stopped (ctrl+c)` if Windows reports the NTSTATUS. Either way it must **not** be a bare negative number.
- [ ] Whatever produced `exit -1978335212` before. It now reads `exit 0x8a150014` — no name (that code is not one anyone documents), but a value that can be searched.
- [ ] A plain failure (`exit 1` from a script, a command that is not installed). Reads `exit 1 · failed` / `exit 127 · command not found`, decimal, not hex.
- [ ] Scroll back over a finished block and resize the window. The result line settles in place rather than replaying, and no bar is left drawn over it.

---

## 2026-08-09 — Code blocks last, code tokens ranked, run bar always

Three changes. `revealRank` now offsets an element's **whole** reveal — rows at 0, prose at 0.2s, code blocks at 0.4s — labels included, so a block's own tiers play inside its late slot. `codeSpans` gained link, time and path tokens from the same shapes prose uses, ranked with their prose counterparts. The run bar is shown for as long as a command runs, not only while it has printed nothing.

- [ ] `git diff --help` or anything with a fenced block. The prose and headings above the block land **first**, the code block starts after them, and inside it the flags sweep before the placeholders. Nothing about the block's order should look different from prose's — only when it starts.
- [ ] Same output: a code block sitting *between* two paragraphs still goes last of the three, not in reading order.
- [ ] A block with paths in it (`git status`, a stack trace, `ls -la` piped through something). Paths inside the code block are tinted in the complement hue, the same colour a path in prose gets, and they sweep a bar on the same beat.
- [ ] A dev-server log or anything with `12:30:01` stamps inside a block. The timestamp is dim grey — chrome, not content — and does not read as brighter than the line it stamps.
- [ ] A URL inside a code block is one whole underlined accent run. **Not** split into a path at its `//` or a time at its port — that is the precedence bug this ordering exists to prevent.
- [ ] `git diff` on a real repo. `--git` is still a flag, `a/x.js b/x.js` is still plain, and columns still line up — a token that gained padding would shift every character after it on its row.
- [ ] Run something slow that prints as it goes (`ping 8.8.8.8`, `npm ls --all`). The bar at the foot of the block **keeps running while output arrives** and is replaced by `done` / `exit n` when it finishes. This is the change — it used to vanish on the first line of output.
- [ ] Run a fast command (`git status`). No bar flashes at all — the 0.35s delay still holds.
- [ ] Ctrl+C a running command. The bar goes with the block closing, and nothing is left animating.

---

## 2026-08-09 — List rows wave, one rank above prose

Rows are character-split like any other prose now (`splittable` deleted), and the wave gained two ranks: a row waves a beat before ordinary prose, both still after every label tier. `waveRank` in `reveal-plan.js`; self-check passes.

- [ ] `ping 8.8.8.8`. Each reply row **waves character by character** as it arrives — the same gesture prose gets, not the whole row rising as one piece. This is the reported fault.
- [ ] Same run: the `##` headings above the lists still sweep their bar **first**, before any row waves.
- [ ] A block holding both a list and a paragraph. The list rows wave one beat (0.2s) **ahead** of the plain prose, not together with it.
- [ ] A list item containing a path or a `--flag`. The token still sweeps its bar and the grey text around it waves — the label must not be split into characters.
- [ ] `ls` in a big folder. All visible rows wave, nothing stalls, scrolling down does not replay them. Per-row splitting is the cost of this change, so anything visibly slower than before is the regression to report.
- [ ] Run a list command and toggle Ctrl+B mid-run, then resize. Rows settle in place, no leftover character spans, no row stuck invisible.

---

## 2026-08-08 — Version bumped to 0.4.0

Version fields only, in `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `package.json` and `package-lock.json`. No code changed. `tauri.conf.json` is the one that reaches the built app, so it is the one worth a look.

- [ ] `npm run tauri dev` still starts and the shell comes up. A malformed `tauri.conf.json` fails at launch, not at build.
- [ ] `npm run tauri build` produces an installer named for **0.4.0**, and the installed app reports 0.4.0 in its properties.

---

## 2026-08-08 — Settings split out into its own component

The whole overlay — markup, CSS, entrance, exit, the label flicker — moved to `src/lib/components/Settings.svelte`, and the tables it reads moved to `src/lib/settings.ts`. No behaviour was intended to change. The build and the typecheck pass, but neither of them opens the panel: every line below is checking that something survived the move.

### It still looks like itself

- [ ] Press Esc. The panel rises into place with the stutter, over a blurred backdrop, centred with an inset on all four sides — it must not slide in from an edge.
- [ ] Every control is there and styled: the font X with its crossed bars, four wedges with the accent blob on the selected one, eight round swatches in a 3-wide grid, two switches with a sliding knob, the startup-directory field and Browse. Nothing unstyled, nothing collapsed to a bare button — that is what a lost stylesheet looks like.
- [ ] The root-shell switch is still absent on Windows (it is Unix-only) and present on Arch.
- [ ] Press Esc again. The panel accelerates away **upward**, against the direction it came from, and the backdrop fades with it. It must not vanish instantly — that is the exit tween failing to reach the panel across the new component boundary.
- [ ] After it closes, type. The keyboard goes back to the shell rather than nowhere.

### The controls still do what they say

- [ ] Click each of the four font modes. The screen changes, and the label you clicked flickers with the RGB split. No flicker means `.glitch-char` is not matching any more.
- [ ] Flip both switches. Same: the state moves, the knob slides, and the label on the side being moved *to* is the one that flickers.
- [ ] Click several swatches. The tint follows everywhere — borders, the block rail, the caret — and `white` still reads as off-neutral rather than washing the borders out.
- [ ] Set a startup directory with Browse. The native picker opens and the field takes the path.
- [ ] Close the app and reopen it. Every setting comes back the way you left it.
- [ ] Edit `config.toml` by hand to a nonsense accent (`accent = "chartreuse"`) and save. The app keeps whatever is on screen instead of clearing the tint.

### Reduced motion

- [ ] Turn on the OS reduced-motion setting, then open and close the panel. It fades rather than stuttering, and no label flickers. This is the one that would silently break: `reduceMotion` is a prop now, and it had to become `$state` for the panel to ever see it change.

---

## 2026-08-08 — Settings tables moved to `src/lib/settings.ts`

Pure code move, no behaviour intended. The typecheck and the build pass, but neither of them opens the settings panel — everything below checks that the tables still reach the screen and still round-trip through `config.toml`.

- [ ] Open settings (Esc, or the gear). Every row is there: four font modes, two scroll modes, two reveal modes, eight accent swatches — and the four font modes still sit in the X, one per corner, each with its own wedge styled.
- [ ] Click through all four font modes and both reveal modes. Each one changes the screen, and the label glitches on the row you clicked.
- [ ] Click several accent swatches. The tint follows everywhere — borders, the block rail, the caret — and `white` still reads as off-neutral rather than washing the borders out.
- [ ] Close the app and reopen it. Every setting comes back the way you left it — that is the `Config` shape surviving the move.
- [ ] Edit `config.toml` by hand to a nonsense accent (`accent = "chartreuse"`) and save. The app keeps whatever is on screen instead of clearing the tint — that is `pick`.

---

## 2026-08-08 — The cwd panel

### It opens, and it takes width

- [ ] Press Ctrl+B. A panel appears down the right side, inset from all four edges, listing the current folder. Directories are tinted and sorted first, files after, each alphabetical.
- [ ] The scrollback, the input bar **and** the suggestion strip all end short of it — nothing is hidden behind the panel. The strip is still centred, over the narrowed bar rather than over the window.
- [ ] The output and the input bar **animate** to their narrower width — they must not snap. The panel's left edge and the terminal's right edge stay welded together the whole way; if they ever come apart it reads as two objects instead of one push.
- [ ] Press Ctrl+B again. The panel slides off to the right and the terminal widens with it, in the same lockstep, a little faster.
- [ ] Hammer Ctrl+B open/shut/open quickly. No half-open band left behind, no panel stranded mid-slide.
- [ ] Watch the block text while the band moves. It re-wraps live (that is CSS doing it), and it must not visibly re-render or flicker per frame — the expensive resize work is deliberately held until the tween lands.

### The shell keeps wrapping in the right place

- [ ] **The check that matters most.** With the panel open, run something that prints long rows (`git log --oneline`, or `ls` in a folder with long names). Every row must wrap where the block's edge is, with no stub line left behind it. If it wraps at the old full width, the PTY was not resized.
- [ ] Close the panel and run it again: wrapping follows back out.
- [ ] Toggle the panel **while a long command is still running**. The band moves, and the running block's text is re-read once at the end rather than per frame — check it does not end up truncated or doubled.
- [ ] Open `vim` or `htop` with the panel open. Raw mode takes the whole window and Ctrl+B is left to the program.

### The listing follows the shell

- [ ] With the panel open, `cd` somewhere. The panel's title and list follow within a prompt.
- [ ] With the panel open, create a file (`echo hi > tmp.txt`). It appears in the list after the command finishes — the listing is re-read once per prompt.
- [ ] After a click the keyboard is still the shell's — type immediately, without clicking the terminal first.

### The tree

- [ ] Every folder has an arrow to its left; files have the same width of blank, so names line up. Click an arrow: the folder opens under it, indented, and the arrow turns to point down.
- [ ] Click the folder's **name**: same thing. Click again: it closes.
- [ ] Open three levels deep. Indentation keeps stepping and the hover highlight is still the panel's full width at every level.
- [ ] Collapse a folder that had children open, then reopen it — the children come back re-read, not stale.
- [ ] `..` is the first row, and only at the top level — it must **not** appear inside expanded subfolders, where the parent is already the row above.
- [ ] Click `..`: `cd ..` replaces the prompt line and does not run. Press Enter — the panel now shows the parent, and `..` is there again, so going up repeatedly works.
- [ ] Shift+click `..`: the same thing, not a second behaviour.
- [ ] With something expanded, run a command that writes a file into that subfolder. It appears at the next prompt; the expansion is not lost.
- [ ] `cd` somewhere else. The tree resets to the new folder with nothing expanded, and the old folder's contents must not flash back in a moment later.

### Clicking and shift-clicking

- [ ] **Shift+click a folder.** The prompt line is *replaced* with `cd <path>` — anything already typed is gone, not left around it. It does **not** run; press Enter yourself.
- [ ] Do the same with the caret parked in the *middle* of a half-typed command. Still a clean replace, nothing left to the right of where the caret was.
- [ ] Shift+click a folder several levels deep: the path is relative to the prompt and the `cd` actually lands there.
- [ ] Shift+click a folder whose name has a space: the path is quoted and the `cd` works.
- [ ] **Click a file.** The run-options strip comes up — the same one dropping a file on the window gives. For `x.sh` the first option is `bash x.sh`, for `x.py` a `python`, for `x.exe` the `&` call. The bare path and a `cd` are at the bottom.
- [ ] Enter accepts there (that strip was summoned, not typed) and the command is written but **not run**.
- [ ] Click a file with no known extension: there is still a sensible list, ending in the bare path.

### Dragging out — the native drag

- [ ] **The one that failed before.** Drag a `.png` from the panel into Paint, and into Aseprite. It opens. No stop cursor.
- [ ] Drag one into Explorer / the file manager. Check the source file is **still where it was** — the mode is `copy`, so nothing may be moved or deleted. If any drag removes or alters a file, stop and report it.
- [ ] A small accent-coloured square follows the cursor during the drag.
- [ ] Drag a file from the panel back onto the VAD/OS window: the run-options strip comes up, same as an Explorer drop.
- [ ] Drag a file from Explorer onto the window as before: unchanged.
- [ ] **Press and release without moving**: that is still a click, and it opens the run options. It must not start a drag.
- [ ] **Drag a file out and let go over another app, then look at the terminal**: the run-options strip must *not* be up. The click after a drag is deliberately swallowed.
- [ ] Drag a *folder* out. It should behave like any folder drag, and again the original must be untouched.
- [ ] Start a drag and press Esc, or let go over nothing. Nothing is left stuck; the next click still works.

### Linux — this is the part that cannot be checked from here

- [ ] Repeat every check in the section above on Arch. The Linux path is GTK: `file://` URIs and a pixbuf drag icon, which is a different implementation from the Windows one, not the same code.
- [ ] Note whether the session is **X11 or Wayland** when reporting. `drag-rs`'s GTK backend pulls in `gdkx11`, so a native Wayland session is where this is most likely to fall over. If it fails there, say so and say which — that determines whether the fix is XWayland or a different plugin.

### The panel's own chrome

- [ ] The title is the current path, elided from the **left** when it is too long, so the tail — the part that says where you are — is what survives. Check a deep path: `C:\Users\…\VADOS`. It is set with `direction: rtl`, which is the one thing here that can reorder punctuation oddly; if the drive letter or the slashes land in a strange place, that is why.
- [ ] Open the panel in a folder with more entries than fit. The list scrolls, the title stays put, and there is no visible scrollbar taking width.
- [ ] Open a folder with nothing in it: it says `empty`, under the `..` row.
- [ ] Switch the accent in settings while the panel is open: folder names and the open arrows follow it.
- [ ] F2 with the panel open — the screenshot includes it and is not clipped.

### It does not collide with what was there

- [ ] With a block selected (Ctrl+Up), Ctrl+B still opens the panel and the selection rail stays put.
- [ ] Esc with the panel open still opens settings — the panel is a toggle on Ctrl+B and is deliberately not on Esc's chain. Say so if that reads wrong.
- [ ] Open the settings panel *while* the cwd panel is open. Settings is centred over everything including the panel, with its scrim over it. Close it: the cwd panel is still there and still the right width.
- [ ] **The focus one, which is the likeliest thing to be quietly broken.** Click a folder in the panel to expand it, then — without clicking the terminal — press Ctrl+B, then Ctrl+Up, then Tab. All three must still work. Every app chord lives on the terminal's key handler and does nothing while anything else holds focus; clicks inside the panel are supposed to hand focus straight back. If the keyboard goes dead after a panel click, this is that (tasks.md has the standing entry).
- [ ] Same check after shift+clicking a folder and after clicking a file.
- [ ] Turn on `prefers-reduced-motion` at the OS level. Ctrl+B: the band snaps and the panel fades in over about a tenth of a second — no slide either way, and closing still actually closes.
- [ ] `/help` lists Ctrl+B, the `..` line, the folder click/shift-click line and the drag line.

---

## 2026-08-08 (last) — Suggestion strip centred

- [ ] Type `cd .` — the strip sits centred over the input bar, not flush to its left edge. Still 60% of the bar's width, still fused to its top edge with no seam.
- [ ] Resize the window narrow and wide: it stays centred at both ends.
- [ ] It still rises into place and drops back out — the centring must not have taken the entrance tween with it. (It is done with insets and auto margins rather than a translate, precisely because GSAP owns this element's transform.)

---

## 2026-08-08 (later) — One match list, arrows own it, and the casing fix

### The strip and the ghost are one thing

- [ ] Type `cd .cl`. The strip puts itself up with no Tab pressed, reading `dir · 1/n · ↑↓`, and the greyed-out text after the caret is **that same match**.
- [ ] Press ↑ and ↓. The selection moves and the ghost changes with it, in step. They must never show different things.
- [ ] Nothing else moves the selection — keep typing and it resets to the best match, but no key other than the arrows walks the list.
- [ ] **The check that matters most:** with the strip up, type `git status` and press Enter. It **runs**. If Enter completes the match instead of running the line, submitting commands is broken.
- [ ] Press ↑ at a completely empty prompt: PSReadLine's own history, as before. Nothing is typed, so there is nothing to match and no strip.
- [ ] Press ↑ with `git` typed: the strip moves, and the shell's history does not. That trade is deliberate; report it if it reads wrong.
- [ ] Drop a file on the window: the strip shows the run options and there Enter **does** accept, because that strip was summoned rather than typed. Esc dismisses it.
- [ ] Tab takes the selected match. → takes it too.

### Casing

- [ ] Type `open cla`. The line reads `claUDE.md` — the greyed part is in the file's case, the typed part in yours. Expected on screen.
- [ ] Now press Tab. The line must become `open CLAUDE.md` — the whole word replaced with the name as it is on disk. Before this turn it sent `claUDE.md`, which is a file that does not exist on a case-sensitive filesystem.
- [ ] `cd .CL` then Tab writes `.claude\`, not `.CLaude\`.

### Going up a folder

- [ ] `cd ` then Tab — `..` is offered, ranked with the directories. Take it: the line reads `cd ..\` and running it goes up one folder.
- [ ] `cd .` shows `..` as a match too.
- [ ] `cd` on its own line, unchanged: `cd ..` typed by hand still goes up one, and `cd /` still goes to the drive root. VAD/OS does not rewrite either — that is the shell's meaning.
- [ ] `..` does not gatecrash unrelated completions: `cd s` offers `src\` and no `..`.

### Nothing else broke

- [ ] `/help` lists the new arrow and Tab lines and the `..` line.
- [ ] Submit a line while a match is showing: the `>` mark stops at the end of the command, not past it into the greyed text.
- [ ] Esc with the strip up dismisses the strip and does not open the settings panel. Esc again opens it.

---

## 2026-08-08 — Block selection, keyboard copy, `open`

### Selecting a block

- [ ] Run three or four commands, then Ctrl+Up. The newest block gets a rail down its left edge and its head scrolls to the same height a new block's head lands at.
- [ ] Keep pressing Ctrl+Up: the selection walks back up the scrollback, one block per press, and stops at the oldest rather than wrapping.
- [ ] Ctrl+Down walks back down. Past the newest block the rail disappears and the view returns to the tail — where a fresh prompt would leave it.
- [ ] Click a block: the rail moves to it. Now hover a *different* block — the ring lights that one up, and the rail does **not** move. Those are two different things and must look like it.
- [ ] Hover a block, move away, then select it with Ctrl+Up. The rail appears. (This is the one that failed before the rail existed: the hover leaves an inline border colour behind that outranks any stylesheet rule, so a border-coloured selection was invisible on any block a pointer had ever crossed.)
- [ ] With a block selected, scroll away with the wheel. The rail stays on it — selection is not hover and does not care where the view is.
- [ ] Submit a command with a block selected: the rail goes away. `clear`: same.

### Copying from the keyboard

- [ ] Select a block, Ctrl+Shift+C. Toast says "Copied output", the block gives one small settle, and the clipboard holds the same text right-click gives.
- [ ] Ctrl+Shift+M on the same block: "Copied as markdown", and the clipboard holds real markdown syntax.
- [ ] **The one that may just not work:** if Ctrl+Shift+C opens devtools or does nothing at all, the webview took the chord before we saw it. Report which — that decides whether the chord changes.
- [ ] Nothing selected, Ctrl+Shift+C: a toast saying so. Not silence.
- [ ] Right-click a block: it is copied *and* the rail moves to it.

### Ghost completion

- [ ] **On a completely fresh window, first thing typed:** `gi` shows a greyed `t`. `ca` shows `rgo`. `he` shows `lp`. History has nothing to offer on the first line, so this comes from the curated command list.
- [ ] `git s` on a fresh window shows `tatus` (subcommand list). `git ` with nothing after it shows nothing — a trailing space is not a prefix.
- [ ] Run `git status`. Type `git s` again — now it completes from **history**, not the list. Whatever you actually ran wins.
- [ ] **Past the first word, which is what was reported broken:** `cd .cl` shows `aude\`. `cd s` shows `rc\`. A directory's completion ends in a separator.
- [ ] `cd src` (fully typed, no separator) still offers `\` — that is what lets Tab carry on into it rather than stopping at the name.
- [ ] `cd .claude\te` completes inside that directory, not the repo root.
- [ ] Case-insensitive: `cd claude` finds nothing, `cd .CL` finds `.claude`. The completion comes back in the entry's case, not the typed case.
- [ ] Create a file, then complete against it **without pressing Enter in between** — it will not appear, because the listing is cached for the prompt cycle. Press Enter on anything and it appears. That is the intended trade, not a bug.
- [ ] Tab accepts the greyed-out completion. Tab again immediately drills into the directory it just completed.
- [ ] → accepts too, and the line is backspace-able as if typed.
- [ ] Keep typing past the suggestion: it updates or disappears, and never inserts itself into what you typed.
- [ ] Move the caret into the middle of a line (←): the suggestion goes away. It is only ever at the end.
- [ ] Select the line (Ctrl+A): no ghost.
- [ ] **The one to watch:** submit a line while a ghost is showing. The `>` mark must stop at the end of the *command*, not run on past it. If the mark overshoots into empty space, the ghost width is not being subtracted.
- [ ] → with no suggestion showing still does whatever PSReadLine does with it (nothing at the end of a line, moves right mid-line).

### `open`

- [ ] `open CLAUDE.md` — it opens. This is the one that failed first time with `Not allowed to open path`: the opener plugin's JS command carries a path scope a terminal cannot fill in, so `open` now goes through our own Rust command instead. If the message comes back, the fix did not take.
- [ ] `open README.md` — README opens in whatever the system opens `.md` with. No block appears, since nothing reached the shell.
- [ ] `open .` opens the current folder in the file manager.
- [ ] `open src/lib` — a relative path resolves against the prompt's cwd.
- [ ] `open "a path with spaces.md"` — quotes come off. Drop a file on the window, take "path only", type `open ` in front of it, Enter: same.
- [ ] `open` alone says it needs a path. `open nope.txt` says `no such path: …`, not an OS error code.
- [ ] `/help` lists `open`, `Ctrl + Up / Down`, `Ctrl + Shift + C/M` and `Ctrl + C`. Anything the app does and does not list there is a bug now, not an omission.
- [ ] `help git` prints **PowerShell's** help for git, not our command list. Bare `help` still prints ours. (`help` is `Get-Help`; that distinction is the whole reason local commands split into with-args and without.)

### Nothing taken from the shell

- [ ] Bare Up and Down at an **empty** prompt still walk PSReadLine's history. (With something typed they move the match strip — see the newer section above.)
- [ ] In `vim`, Ctrl+Up and Ctrl+Shift+C reach vim. Esc still leaves insert mode.
- [ ] Esc with a block selected deselects it and leaves the settings panel closed. Esc again opens the panel.

---

## 2026-08-08 — Reveal, settle gate, and the long-output path

### Streaming structure

- [ ] `cargo build` — run it in `src-tauri` (`cd src-tauri` first; there is no crate at the repo root). The bar must **not** appear once output is flowing, and the block must keep updating rather than waiting for the command to finish. Any long streaming command does as well — `npm install` in a fresh clone, or `ping -t`.

### The handoff

- [ ] Type a long command and press Enter. The `>` mark travels visibly slower and **erases everything it passes over** — the path, the `|`, and the command — characters vanishing under the glyph, not near it.
- [ ] On the way back, the path and the `|` are **written back** as the mark retreats over them. The command is not, and must not be.
- [ ] The caret travels out with the mark and returns with it, ending exactly where a fresh prompt's caret sits.
- [ ] A short command (`ls`) still reads as one gesture rather than a twitch.
- [ ] Submit twice quickly. No leftover copy over the bar, and — the failure that matters — the path is never left clipped away. If the prompt ever comes back missing its path, that is this.
- [ ] Esc into the settings panel mid-gesture, and Ctrl+C mid-gesture. Same check: the prompt comes back whole.

### The first-landing height transition

- [ ] The growth happens **once**. Run `foreach ($i in 1..10) { $i; Start-Sleep 1 }`. The box glides open on the first number; every number after that only adds a row — the box must not glide, stretch or rubber-band again, and the input bar below it must not bounce once per second. Ten separate glides is the failure.
- [ ] Resizing the window mid-transition. Run `Start-Sleep 2; npm --help`, then grab the window's right edge and keep dragging it back and forth through the moment the output lands. When you let go, the block's box fits its text: no empty gap under the last line, no text clipped off the bottom. A box stuck at a wrong height until the next command is the failure.
- [ ] The character wave still plays *after* the growth. The tween writes an inline height that starts below the natural one, and the growth observer read that as a program repainting its own screen — which flagged the block and took the wave off it permanently. `git --no-pager diff` on one small file is the clean test: bars sweep, then characters rise.

### Long output

- [ ] `git --no-pager diff` in a repo with a large diff — close to instant, comparable to Windows Terminal. Time it roughly against `wt`. This is the standing performance check for every change above it: per-line prose elements, three more code-token shapes and per-row splitting all land here first.
- [ ] While it lands, only what is in the viewport animates. Scroll down afterwards: the rest is simply there.
- [ ] A very large diff renders untinted (no coloured flags inside the code block) — that is the 20k-character cap, not a bug. Under it, tinting still works: `git --no-pager diff` on a single small file.
- [ ] Copy a large block (right-click) and confirm the text is complete and unchanged.

### Parser

- [ ] `git --no-pager diff` on a file with CRLF warnings — each `warning:` line is its own red heading, staggered, not one tall box.
- [ ] A one-line body under a heading now renders as a single bullet (e.g. `npm --help`'s `All commands:`). Confirm that reads acceptably — it was prose before, and this is the change that fixed `ping`.

### Still-known-broken, do not report as new

- `claude`, `vim`, `htop` — the alt-screen / inline-repaint blocker.
- `git diff` **with** the pager — a screenshot of `less`, garbage in, garbage out.

---

## Carried over — Phase 6, never verified

The whole *Verify* list in [foundation/phase-6-config.md](foundation/phase-6-config.md) has never been run.

- [ ] Change the accent in the panel → `%APPDATA%\vados\config.toml` updates.
- [ ] Edit that file in an external editor → the UI follows without a restart.
- [ ] No bounce: the app's own write must not come back through the watcher.
- [ ] Delete the config → defaults regenerate on next launch.
- [ ] Corrupt the file (unterminated string) → the app keeps running on defaults and does **not** rewrite the file. Fix it → the UI catches up.
- [ ] Set a startup directory, restart → the shell opens there. Set `~/something`, restart → it expands.
