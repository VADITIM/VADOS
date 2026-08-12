# Tests

What needs checking **on screen**, written by Claude at the end of any turn that changed behaviour. Nothing here is automated — these are the things a build, a typecheck and a self-check cannot tell us.

**How to use it:** run a check, then mark it. `[x]` passed, `[!]` failed (add a line saying what you saw). Anything still `[ ]` is unverified and must not be treated as done. Resolved sections get deleted once the whole section is `[x]` — this file is a queue, not a history. What the fix *was* belongs in the CHANGELOG; why it broke belongs in [docs/QUIRKS.md](docs/QUIRKS.md).

Order matters: the top section is the newest.

---

## 2026-08-12 (latest) — Colour runs are indexed by character, not by cell

`rowRuns` moved out of `+page.svelte` into `src/lib/ansi.js` and now advances by the characters a cell holds instead of by the cell. `node src/lib/ansi.check.mjs` covers the arithmetic; what it cannot cover is that the runs still reach the screen at all, so the first check below is the one that matters — a move that quietly stopped producing runs would leave every block monochrome and pass every assertion.

- [ ] `git status` in this repo. Colour is still there in block mode. This is the whole of item 1 of phase H1 still working after the move; if a block came back grey, nothing else here is worth running.
- [ ] `ls --color=always` (or `eza -l`) — the same colours as the raw view shows for the same command.
- [ ] `node compat/make.mjs`, then `cat compat/unicode/width.txt`. Nothing needs to be *coloured* correctly here yet — what is being looked at is whether any colour that is there starts and ends on the glyph it belongs to, rather than a character early or late after a CJK or emoji row. Compare against Windows Terminal side by side and mark the row in `compat/CHECKLIST.md`.
- [ ] Same file: report whether the **columns** line up in block mode. That half of the Unicode blocker is untouched by this change and is the thing the fixture was written for.
- [ ] A program using reverse video — `printf '\e[7mreversed\e[0m\n'`. The swap still reads as a swap, and switching the accent or theme in settings while it is on screen now moves it with the theme instead of leaving it on the colour it was snapshotted at.
- [ ] A block with no colour in it at all (`echo hi`) still renders with no styled spans. Inspect the DOM, not the screen — an unstyled run costs an element that should not exist.

---

## 2026-08-08 — Version bumped to 0.4.0

Version fields only, in `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `package.json` and `package-lock.json`. No code changed. `tauri.conf.json` is the one that reaches the built app, so it is the one worth a look.

- [X] `npm run tauri dev` still starts and the shell comes up. A malformed `tauri.conf.json` fails at launch, not at build.
- [X] `npm run tauri build` produces an installer named for **0.4.0**, and the installed app reports 0.4.0 in its properties.

---

## 2026-08-08 — A list row is the reveal unit

The reveal moved from the `<ul>` to the `<li>`. Replaces the previous section's fix, which was a no-op for `ping`: that list was already the last element of an open block, so it was already unsplit — the actual fault was that only the first row or two ever animated at all.

- [!] `ping 8.8.8.8`. **Every reply row animates as it arrives** — one a second, each rising into place. This is the one that was broken: rows 3 and 4 used to appear with no animation.
-- No proper wave animatio per entry. They animate but not with an expected flow
- [!] No row waves character by character. Each row arrives as one piece.
--- Previous point
- [X] The `##` headings above each list still sweep their bar.
- [X] The bullet markers line up with their rows and nothing is left invisible after the run finishes. A row stuck at `visibility: hidden` is what a reveal that never ran looks like.
- [X] `ls` in a folder with many entries, or `npm ls`. The visible rows animate, scrolling down does not replay them, and the whole thing does not stall — per-row should be *cheaper* than the old whole-list split, so anything slower than before is a regression worth reporting.
- [X] Run a list command and toggle the panel (Ctrl+B) mid-run, then resize the window. Rows settle in place rather than replaying.
- [?] `less` on a long file, then page through it. Rows repaint without tearing or leaving spans behind.
- [X] Ordinary prose output — `git status`, `--help` text — still waves character by character. If that stopped, `splittable` is matching more than rows.

---

## 2026-08-08 — Lists do not character-wave (superseded by the section above)

- [!] `ping 8.8.8.8`. The four reply rows arrive as **one piece** — the whole list rises together. No character-by-character stagger crossing from the end of one row to the start of the next.
-- line 24
- [X] Same run: the two `##` headings above the lists still sweep their bar. Only the list's prose changed.
- [X] `npm ls` or anything with a long list. It still animates — one rise, not a flicker, and not nothing at all.
- [!] A list with tinted tokens in it (a path or a `--flag` inside an item) still gets its bars swept over those tokens; only the grey text around them stopped waving.
-- Wave animations in lists should retain as mentioned before
- [!] Ordinary prose output — `git status`, `--help` text — still waves character by character. If that stopped too, the predicate is matching more than lists.
-- stopped
- [X] Scroll back over a finished `ping` and resize the window. The list settles in place rather than replaying.

---

## 2026-08-08 — Settings split out into its own component

The whole overlay — markup, CSS, entrance, exit, the label flicker — moved to `src/lib/components/Settings.svelte`, and the tables it reads moved to `src/lib/settings.ts`. No behaviour was intended to change. The build and the typecheck pass, but neither of them opens the panel: every line below is checking that something survived the move.

### It still looks like itself

- [!] Press Esc. The panel rises into place with the stutter, over a blurred backdrop, centred with an inset on all four sides — it must not slide in from an edge.
-- It should slide in from the btoom and slide out to the top. VISIBILY
- [X] Every control is there and styled: the font X with its crossed bars, four wedges with the accent blob on the selected one, eight round swatches in a 3-wide grid, two switches with a sliding knob, the startup-directory field and Browse. Nothing unstyled, nothing collapsed to a bare button — that is what a lost stylesheet looks like.
- [!] The root-shell switch is still absent on Windows (it is Unix-only) and present on Arch.
-- cant test now
- [!] Press Esc again. The panel accelerates away **upward**, against the direction it came from, and the backdrop fades with it. It must not vanish instantly — that is the exit tween failing to reach the panel across the new component boundary.
-- line 57
- [X] After it closes, type. The keyboard goes back to the shell rather than nowhere.

### The controls still do what they say

- [X] Click each of the four font modes. The screen changes, and the label you clicked flickers with the RGB split. No flicker means `.glitch-char` is not matching any more.
- [X] Flip both switches. Same: the state moves, the knob slides, and the label on the side being moved *to* is the one that flickers.
- [X] Click several swatches. The tint follows everywhere — borders, the block rail, the caret — and `white` still reads as off-neutral rather than washing the borders out.
- [X] Set a startup directory with Browse. The native picker opens and the field takes the path.
- [X] Close the app and reopen it. Every setting comes back the way you left it.
- [!] Edit `config.toml` by hand to a nonsense accent (`accent = "chartreuse"`) and save. The app keeps whatever is on screen instead of clearing the tint.
-- cant test, didnt use installer yet
### Reduced motion

- [!] Turn on the OS reduced-motion setting, then open and close the panel. It fades rather than stuttering, and no label flickers. This is the one that would silently break: `reduceMotion` is a prop now, and it had to become `$state` for the panel to ever see it change.
-- didnt test now
---

## 2026-08-08 — Settings tables moved to `src/lib/settings.ts`

Pure code move, no behaviour intended. The typecheck and the build pass, but neither of them opens the settings panel — everything below checks that the tables still reach the screen and still round-trip through `config.toml`.

- [!] Open settings (Esc, or the gear). Every row is there: four font modes, two scroll modes, two reveal modes, eight accent swatches — and the four font modes still sit in the X, one per corner, each with its own wedge styled.
-- we will not use a gear icon. shift settings menu to ctrl + esc
- [X] Click through all four font modes and both reveal modes. Each one changes the screen, and the label glitches on the row you clicked.
- [X] Click several accent swatches. The tint follows everywhere — borders, the block rail, the caret — and `white` still reads as off-neutral rather than washing the borders out.
- [X] Close the app and reopen it. Every setting comes back the way you left it — that is the `Config` shape surviving the move.
- [!] Edit `config.toml` by hand to a nonsense accent (`accent = "chartreuse"`) and save. The app keeps whatever is on screen instead of clearing the tint — that is `pick`.
-- didnt test now, no installer did
---

## 2026-08-08 — The cwd panel

### It opens, and it takes width

- [!] Press Ctrl+B. A panel appears down the right side, inset from all four edges, listing the current folder. Directories are tinted and sorted first, files after, each alphabetical.
-- works actually but spamming ctrl+b tends to close the panel instead of actually switching between open and close
- [?] The scrollback, the input bar **and** the suggestion strip all end short of it — nothing is hidden behind the panel. The strip is still centred, over the narrowed bar rather than over the window.
- [X] The output and the input bar **animate** to their narrower width — they must not snap. The panel's left edge and the terminal's right edge stay welded together the whole way; if they ever come apart it reads as two objects instead of one push.
- [X] Press Ctrl+B again. The panel slides off to the right and the terminal widens with it, in the same lockstep, a little faster.
- [!] Hammer Ctrl+B open/shut/open quickly. No half-open band left behind, no panel stranded mid-slide.
--mentioned in line 99
- [X] Watch the block text while the band moves. It re-wraps live (that is CSS doing it), and it must not visibly re-render or flicker per frame — the expensive resize work is deliberately held until the tween lands.
-- General issue with side bar opening: it moves the output window view, doesnt keep it positioned at the current output block.

### The shell keeps wrapping in the right place

- [?] **The check that matters most.** With the panel open, run something that prints long rows (`git log --oneline`, or `ls` in a folder with long names). Every row must wrap where the block's edge is, with no stub line left behind it. If it wraps at the old full width, the PTY was not resized.
-- this is working right i suppose?
- [X] Close the panel and run it again: wrapping follows back out.
- [X] Toggle the panel **while a long command is still running**. The band moves, and the running block's text is re-read once at the end rather than per frame — check it does not end up truncated or doubled.
- [!] Open `vim` or `htop` with the panel open. Raw mode takes the whole window and Ctrl+B is left to the program.
-- cant test now, windows doesnt have this
### The listing follows the shell

- [X] With the panel open, `cd` somewhere. The panel's title and list follow within a prompt.
- [X] With the panel open, create a file (`echo hi > tmp.txt`). It appears in the list after the command finishes — the listing is re-read once per prompt.
- [X] After a click the keyboard is still the shell's — type immediately, without clicking the terminal first.

### The tree

- [X] Every folder has an arrow to its left; files have the same width of blank, so names line up. Click an arrow: the folder opens under it, indented, and the arrow turns to point down.
- [X] Click the folder's **name**: same thing. Click again: it closes.
- [!] Open three levels deep. Indentation keeps stepping and the hover highlight is still the panel's full width at every level.
-- it works good, a nice change would be here to accomodate it > resizable folder panel
- [!] Collapse a folder that had children open, then reopen it — the children come back re-read, not stale.
-- the children are also collapsed, they should not be
- [!] `..` is the first row, and only at the top level — it must **not** appear inside expanded subfolders, where the parent is already the row above.
-- clicking this should actually show you whats in the above it (only one deep)
- [X] Click `..`: `cd ..` replaces the prompt line and does not run. Press Enter — the panel now shows the parent, and `..` is there again, so going up repeatedly works.
- [X] Shift+click `..`: the same thing, not a second behaviour.
- [X] With something expanded, run a command that writes a file into that subfolder. It appears at the next prompt; the expansion is not lost.
- [X] `cd` somewhere else. The tree resets to the new folder with nothing expanded, and the old folder's contents must not flash back in a moment later.

### Clicking and shift-clicking

- [X] **Shift+click a folder.** The prompt line is *replaced* with `cd <path>` — anything already typed is gone, not left around it. It does **not** run; press Enter yourself.
- [X] Do the same with the caret parked in the *middle* of a half-typed command. Still a clean replace, nothing left to the right of where the caret was.
- [X] Shift+click a folder several levels deep: the path is relative to the prompt and the `cd` actually lands there.
- [X] Shift+click a folder whose name has a space: the path is quoted and the `cd` works.
- [X] **Click a file.** The run-options strip comes up — the same one dropping a file on the window gives. For `x.sh` the first option is `bash x.sh`, for `x.py` a `python`, for `x.exe` the `&` call. The bare path and a `cd` are at the bottom.
- [X] Enter accepts there (that strip was summoned, not typed) and the command is written but **not run**.
- [?] Click a file with no known extension: there is still a sensible list, ending in the bare path.

### Dragging out — the native drag

- [X] **The one that failed before.** Drag a `.png` from the panel into Paint, and into Aseprite. It opens. No stop cursor.
- [X] Drag one into Explorer / the file manager. Check the source file is **still where it was** — the mode is `copy`, so nothing may be moved or deleted. If any drag removes or alters a file, stop and report it.
- [?] A small accent-coloured square follows the cursor during the drag.
-- there is none, just a drag and drop native os icon
- [X] Drag a file from the panel back onto the VAD/OS window: the run-options strip comes up, same as an Explorer drop.
- [X] Drag a file from Explorer onto the window as before: unchanged.
- [X] **Press and release without moving**: that is still a click, and it opens the run options. It must not start a drag.
- [X] **Drag a file out and let go over another app, then look at the terminal**: the run-options strip must *not* be up. The click after a drag is deliberately swallowed.
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

- [X] `ping -t 8.8.8.8` — no entry appears at the top and disappears again. Replies accumulate as list items and nothing already on screen is rebuilt. Ctrl+C to stop.
- [X] `npm --help` — the whole block appears at once. No half-block that grows a second time.
- [!] `npm ls --all` — an indeterminate bar appears beside `running · ctrl+c stops` while it works, then the whole block lands at once.
--- Did not animate the list 
- [ ] `cargo build` — run it in `src-tauri` (`cd src-tauri` first; there is no crate at the repo root). The bar must **not** appear once output is flowing, and the block must keep updating rather than waiting for the command to finish. Any long streaming command does as well — `npm install` in a fresh clone, or `ping -t`.

### The handoff

- [ ] Type a long command and press Enter. The `>` mark travels visibly slower and **erases everything it passes over** — the path, the `|`, and the command — characters vanishing under the glyph, not near it.
- [ ] On the way back, the path and the `|` are **written back** as the mark retreats over them. The command is not, and must not be.
- [ ] The caret travels out with the mark and returns with it, ending exactly where a fresh prompt's caret sits.
- [ ] A short command (`ls`) still reads as one gesture rather than a twitch.
- [ ] Submit twice quickly. No leftover copy over the bar, and — the failure that matters — the path is never left clipped away. If the prompt ever comes back missing its path, that is this.
- [ ] Esc into the settings panel mid-gesture, and Ctrl+C mid-gesture. Same check: the prompt comes back whole.
- [X] The bar does not flash on a fast command (`git status`).

### The first-landing height transition

- [X] `npm --help` — the box grows into its content over about half a second rather than snapping.
- [?] The growth happens **once**. A streaming command must not tween its height on every chunk.
- [?] Resizing the window mid-transition does not leave the box stuck at a wrong height.
- [ ] The character wave still plays *after* the growth. The tween writes an inline height that starts below the natural one, and the growth observer read that as a program repainting its own screen — which flagged the block and took the wave off it permanently. `git --no-pager diff` on one small file is the clean test: bars sweep, then characters rise.

### Long output

- [ ] `git --no-pager diff` in a repo with a large diff — close to instant, comparable to Windows Terminal. Time it roughly against `wt`.
- [ ] While it lands, only what is in the viewport animates. Scroll down afterwards: the rest is simply there.
- [ ] A very large diff renders untinted (no coloured flags inside the code block) — that is the 20k-character cap, not a bug. Under it, tinting still works: `git --no-pager diff` on a single small file.
- [ ] Copy a large block (right-click) and confirm the text is complete and unchanged.

### Markdown

- [!] `Get-Content CLAUDE.md` — real headings, real fences, real lists. No invented headings, and `right-click` is not read as a flag.
--- Weird symbols appearing out of nowhere like "â€". It seems to parse an .md file into .md, which is not needed. The system should know this.
- [X] `git diff CLAUDE.md` — **not** markdown mode. It is a diff and must render as one.
- [X] `Get-Content src-tauri/tauri.conf.json` — not markdown, no `#` headings invented.

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
