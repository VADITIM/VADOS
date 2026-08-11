<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { startDrag } from "@crabnebula/tauri-plugin-drag";
  import { listen } from "@tauri-apps/api/event";
  import { open } from "@tauri-apps/plugin-dialog";
  // Tauri's own drag-and-drop, never the HTML5 `drop` event. See `watchDrops`.
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { Terminal, type IBufferCell, type IMarker } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import gsap from "gsap";
  import { ScrollToPlugin } from "gsap/ScrollToPlugin";
  import { RoughEase } from "gsap/EasePack";
  import banner from "$lib/banner.txt?raw";
  // `COMMAND_NAMES` / `SUBCOMMAND_NAMES` are the parser's curated lists, reused
  // by the input bar's ghost completion — the parser already had to know what a
  // command looks like to render one, and a second list would drift from it.
  import {
    COMMAND_NAMES,
    SUBCOMMAND_NAMES,
    exitLabel,
    lineParts,
    locate,
    parse,
    runHint,
    toMarkdown,
  } from "$lib/parse.js";
  // The program's own colour, mapped onto the parser's text by offset. Pure and
  // checked without a browser: `node src/lib/ansi.check.mjs`.
  import { paletteColor, rgbColor, tint, type Run } from "$lib/ansi.js";
  // Which reveal a run of parsed text gets, and in what order — read off the
  // classes the parser's own decisions put on it. Checked without a browser:
  // `node src/lib/reveal-plan.check.mjs`.
  import { labelGroups, revealRank } from "$lib/reveal-plan.js";
  // The one animation value shared between two surfaces — the settings overlay
  // and the suggestion strip arrive the same way on purpose.
  import { GLITCH_IN } from "$lib/anim.js";
  // The settings overlay owns its own markup, CSS and entrance. This file keeps
  // the values and does the applying, which is all DOM.
  import Settings from "$lib/components/Settings.svelte";
  // Every setting as data: the keys `config.toml` stores, the labels the
  // settings panel renders, and what each mode resolves to.
  import {
    ACCENTS,
    FONT_MODES,
    REVEAL_MODES,
    SCROLL_MODES,
    WEDGES,
    pick,
    type Accent,
    type Config,
    type FontMode,
    type RevealMode,
    type ScrollMode,
  } from "$lib/settings.js";
  // Everything the docked input bar computes that is not DOM — the suggestion
  // strip's items and the mirrored line's selected runs. Checked without a
  // browser: `node src/lib/input.check.mjs`.
  import {
    completionRequest,
    completions,
    quotePath,
    resolveDir,
    runOptions,
    segments,
    shortCwd,
    step,
    tokenAt,
    unquote,
    wordCommand,
    wordSuggestions,
  } from "$lib/input.js";

  type Node = ReturnType<typeof parse>[number];

  // `rough` ships inside the gsap package but is not part of the core ease set,
  // so it has to be registered like any plugin — an unregistered ease string
  // silently degrades to `power2.out` rather than erroring, which is the worst
  // possible failure mode for an effect whose whole point is the jitter.
  gsap.registerPlugin(ScrollToPlugin, RoughEase);

  // Repeated enough to cover 80dvw at any reasonable window width; the
  // divider element clips it to width, so overshoot is free and safe.
  const dividerLine = "<<>>".repeat(60);

  // #region ── settings ───────────────────────────────────────────────────────
  // The tables themselves live in `$lib/settings.ts` — they are data, and
  // `config.rs` stores their keys. What is left here is what applying one does,
  // all of which is DOM.

  // How far down the viewport a newly anchored block head sits, in `dv` terms
  // per ANIMATION.md — a fraction of the scrollport, not a pixel constant.
  const ANCHOR_TOP = 0.05;

  let fontMode = $state<FontMode>("mixed");
  let scrollMode = $state<ScrollMode>("top");
  let accent = $state<Accent>("indigo");
  let revealMode = $state<RevealMode>("reveal");
  // Next-launch settings. They are shown and stored here, but nothing reads
  // them at runtime: the shell's directory and the shell's token are both fixed
  // at spawn, in Rust, before this file has run.
  let startupDir = $state("");
  let startAsAdmin = $state(false);

  function currentConfig(): Config {
    return {
      appearance: { accent, font: fontMode },
      behavior: { scroll: scrollMode, reveal: revealMode },
      shell: { cwd: startupDir },
      system: { start_as_admin: startAsAdmin },
    };
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Write the whole document, coalesced.
   *
   * Coalesced because a swatch is a control someone drags an eye across —
   * four clicks in a second is normal use, and each one is a file write plus a
   * watcher round trip. The whole document every time because there is one
   * writer and the file is a hundred bytes; a partial update would need a merge
   * on the Rust side to protect against nothing.
   */
  function saveConfig() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      invoke("config_save", { config: currentConfig() }).catch(() => {
        // A read-only config directory. The setting still applies for this
        // session, which is the part the user just asked for.
      });
    }, 120);
  }

  /**
   * Apply a config that came from the file — first load, or an external edit.
   *
   * Deliberately not routed through the setters: those exist to *record* a
   * gesture (they save, and they play the glitch on the label the user just
   * clicked). Neither is true of a change the file made, and saving here is
   * exactly the write-loop the content guard in `config.rs` is defending
   * against — it would just move the loop to this side of the boundary.
   */
  function applyConfig(c: Config) {
    fontMode = pick(c.appearance.font, FONT_MODES, fontMode);
    scrollMode = pick(c.behavior.scroll, SCROLL_MODES, scrollMode);
    revealMode = pick(c.behavior.reveal, REVEAL_MODES, revealMode);
    startupDir = c.shell.cwd ?? "";
    startAsAdmin = !!c.system.start_as_admin;

    const next = pick(c.appearance.accent, ACCENTS, accent);
    if (next !== accent) {
      accent = next;
      document.documentElement.style.setProperty("--accent", ACCENTS[next].value);
      applyTokens();
    }
    resyncTail();
  }

  // The glitch that plays on the row that was clicked belongs to the panel and
  // fires there — these only record the change and apply it.
  function setFontMode(next: FontMode) {
    fontMode = next;
    saveConfig();
  }

  function setScrollMode(next: ScrollMode) {
    scrollMode = next;
    saveConfig();
    resyncTail();
  }

  // Only what mounts after the switch changes: an element's reveal is decided
  // once, in the action, and re-deciding it for text already on screen would
  // replay output the reader has read.
  function setRevealMode(next: RevealMode) {
    revealMode = next;
    saveConfig();
  }

  function setAccent(next: Accent) {
    accent = next;
    saveConfig();
    // Written to :root rather than a Svelte style: prop so the token layer
    // stays the single source, and everything derived from --accent updates
    // with it. applyTokens() carries it to whatever cannot read CSS.
    document.documentElement.style.setProperty("--accent", ACCENTS[next].value);
    applyTokens();
  }

  /**
   * Both of these apply at spawn and nothing re-reads them, so changing one
   * while a shell is running is a promise about the *next* one. The rows say so
   * rather than appearing to do nothing — see `decisions.md`; restarting the
   * session under the user is the one thing a terminal must never do on its own.
   */
  function setStartupDir(next: string) {
    startupDir = next;
    saveConfig();
  }

  async function pickStartupDir() {
    // The native picker, not a text field with a paste in it: the value is a
    // path on this machine and the OS already owns the widget for that.
    const picked = await open({ directory: true, defaultPath: startupDir || undefined }).catch(
      () => null,
    );
    if (typeof picked === "string") setStartupDir(picked);
  }

  /**
   * The *host*, not the shell. `shellIsWindows()` answers a different question
   * — it reads the cwd's shape to quote a dropped path — and a Git Bash session
   * on Windows would answer it "no" while the elevation story stays Windows'.
   */
  const IS_WINDOWS = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

  function setStartAsAdmin(next: boolean) {
    startAsAdmin = next;
    saveConfig();
  }

  let settingsOpen = $state(false);
  let settingsPanel: Settings | undefined = $state();
  // #endregion ────────────────────────────────────────────────────────────────

  type Block = {
    id: number;
    cwd: string;
    /** The typed command line. Always plain text, never markdown-rendered. */
    command: string;
    buffer: string;
    /**
     * The part of `buffer` the block renderer is currently showing.
     *
     * Structure is re-derived from the whole buffer on every change, and a
     * buffer that is still growing is a buffer whose structure is still wrong:
     * `ping`'s header is a heading with one reply under it, then a heading with
     * a list, so the reply mounts as prose and is thrown away a moment later.
     * The same half-parsed state is what made `npm --help` land at one height
     * and jump to another. So structure is only taken when the stream is
     * *quiet* — see `showSoon`. The raw bytes keep arriving into `buffer`
     * meanwhile; nothing is lost, it is only shown a frame or two later.
     *
     * Undefined on blocks VAD/OS writes itself, which are complete on arrival.
     */
    shown?: string;
    closed: boolean;
    exitCode: number | null;
    /** False only for the startup banner — ASCII art, not command output. */
    md: boolean;
    /**
     * Set only on blocks VAD/OS writes itself. `parse` guesses structure from
     * the *shape* of shell output, which is right for output and wrong for
     * text we authored: it reads `VAD/OS` as inline code and `right-click` as a
     * CLI flag. Authored blocks hand over their nodes instead of being guessed
     * at — the same "markdown on evidence, never assumed" rule, applied to
     * ourselves.
     */
    nodes?: Node[];
    /**
     * Showing the bytes instead of the rendering. Per block, never per session:
     * the useful case is "this one block rendered wrong", not "turn the product
     * off" — global raw mode is already the alt-screen fallback.
     */
    raw?: boolean;
    /**
     * How far the block's text moved when the echoed command line was dropped
     * off the front of it. The colour runs (`runsOf`) are in the coordinates
     * from *before* that slice and are not re-indexed for it — re-walking every
     * run on every chunk is a pass over the whole array each time, and one
     * subtraction at the point of use is not.
     */
    runShift: number;
  };

  /**
   * Runs of cells the program gave the same colour and attributes to, per block.
   *
   * Outside `blocks` for the same reason `markers` and the raw logs are: a
   * coloured `--help` dump is thousands of these, they are appended to and
   * extended in place on every chunk, and each of those writes through Svelte's
   * proxy would be a reactive notification for something no template reads
   * directly. The render that shows them is triggered by `buffer` changing in
   * the same pass, which happens after these are written.
   */
  const runsOf = new Map<number, Run[]>();
  const NO_RUNS: Run[] = [];
  const blockRuns = (id: number) => runsOf.get(id) ?? NO_RUNS;

  /**
   * Rendering, clipboard, and export all read a block through this one call.
   *
   * Offsets are attached only when there is something that needs them. A block
   * with no colour in it — most blocks — never pays for the search, and the
   * nodes come back exactly as the parser made them.
   */
  function blockNodes(block: Block): Node[] {
    if (block.nodes) return block.nodes;
    const text = block.shown ?? block.buffer;
    const nodes = parse(text, block.command);
    return blockRuns(block.id).length ? locate(nodes, text) : nodes;
  }

  let wrapper: HTMLDivElement;
  let xtermHost: HTMLDivElement;
  let scrollEl: HTMLDivElement;
  let term: Terminal | undefined;

  // Clicking anywhere must refocus xterm — it's the input engine even though
  // it's invisible here, and it silently loses focus to any other element the
  // user clicks (devtools, address bar, etc.).
  //
  // Except at the end of a drag-selection. Focusing xterm's textarea collapses
  // the document selection, and this runs on the `click` that follows every
  // mouseup — so text selected with the mouse anywhere in the app vanished at
  // the instant the button was released, which is why selecting looked like it
  // did nothing at all.
  function refocus() {
    if (document.getSelection()?.isCollapsed === false) return;
    term?.focus();
  }

  /**
   * Whether an element is allowed to hold the keyboard instead of the input.
   *
   * Exactly one thing qualifies: a real text field, which today means the
   * settings panel's startup-directory box, and tomorrow whatever inline
   * control a rendered block grows. Everything else in this app — every panel
   * button, every block, the scrollport itself — is pointer-driven and has no
   * use for the caret, so holding it is only ever a way to lose it.
   */
  function wantsKeyboard(el: Element | null | undefined) {
    return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
  }

  /**
   * The input keeps the keyboard, whatever was clicked.
   *
   * A webview hands focus to whatever was clicked, and most of what is clickable
   * here is a button that does its work on the click and then sits there holding
   * the caret. That is what "the caret is still blinking and typing does
   * nothing" was: the blink is the *mirror's* caret, drawn from the shell's
   * screen, and it says nothing about which element the keyboard is pointed at.
   *
   * `focusout` rather than a click handler, because the ways focus leaves are
   * open-ended — a click, a drag, a webview dialog, a panel unmounting under the
   * pointer — and every one of them ends here. Checked after the fact rather
   * than from `relatedTarget`: focus moving to nothing at all reports `null`,
   * which is the most common case and the one a `relatedTarget` test misses.
   */
  function keepFocus() {
    queueMicrotask(() => {
      if (wantsKeyboard(document.activeElement)) return;
      if (document.activeElement === term?.textarea) return;
      term?.focus();
    });
  }

  /**
   * A click anywhere is a new caret position, so it ends a selection — the same
   * rule every text field follows. The double-click that *starts* one fires its
   * own `click` first, so this runs before it and cannot undo it.
   */
  function clickAway() {
    selectAll = false;
    refocus();
  }

  let mode = $state<"blocks" | "raw">("blocks");
  let blocks = $state<Block[]>([
    { id: 0, cwd: "", command: "", buffer: banner, closed: true, exitCode: null, md: false, runShift: 0 },
  ]);
  /** Live text of the docked input bar, mirrored from xterm's cursor row. */
  let input = $state("");
  let promptCwd = $state("");
  let nextId = 1;
  let lastCwd = "";

  // True between a prompt appearing and the user pressing Enter. While set,
  // output belongs in the input bar, not in a block — otherwise every prompt
  // redraw spawns an empty block (and PSReadLine redraws on every keystroke).
  //
  // `$state`, not a plain `let`: the template reads this in two places — the
  // live prompt line in the scroll stream, and the caret's idle class. A plain
  // `let` is compiled as a constant read, so both were stuck at their initial
  // `false` for the life of the session: the live prompt line never rendered
  // at all, and the caret never left its idle state. The mirror logic below
  // was working the whole time; nothing was re-reading it.
  let atPrompt = $state(false);
  let caretEl: HTMLSpanElement | undefined = $state();
  let caretX = 0;
  /** Cursor column within the mirrored input text, from xterm's own cursor. */
  let cursorCol = $state(0);
  /**
   * The selected run of the mirrored input, `[from, to)` in input columns.
   * Empty when `to <= from`. Read off the screen cells, not off any shell's
   * key bindings — see the scan in the write callback.
   */
  let shellSelFrom = $state(0);
  let shellSelTo = $state(0);
  /**
   * The whole line selected by *us* — Ctrl+A, or a double-click on the bar.
   *
   * The shell is not told. A select-all keystroke is bound differently in every
   * line editor (PSReadLine's `SelectAll`, readline's `beginning-of-line`), and
   * sending one to find out is how a terminal that hosts more than one shell
   * gets it wrong; the gesture also has to work for a *pointer*, which no shell
   * has a binding for at all. So the selection is ours, it is drawn from the
   * mirror, and the edit that follows is played back to the shell as the keys
   * that produce it — see `eraseSelection`.
   *
   * A boolean rather than a range: both gestures mean the whole line, and a
   * range would be state to keep in step with a line the shell can rewrite
   * under us at any moment.
   */
  let selectAll = $state(false);
  const selFrom = $derived(selectAll ? 0 : shellSelFrom);
  const selTo = $derived(selectAll ? input.length : shellSelTo);
  // The caret splits the line into two runs, and each is segmented against the
  // same absolute range so the selection cannot swallow the caret between them.
  const headSegments = $derived(segments(input.slice(0, cursorCol), 0, selFrom, selTo));
  const tailSegments = $derived(segments(input.slice(cursorCol), cursorCol, selFrom, selTo));

  /**
   * Commands run this session, newest first, no duplicates.
   *
   * ponytail: this session only, and it is why the curated lists below are not
   * optional — a fresh window has nothing to remember, which is exactly when
   * the feature was first reported missing. The shell keeps a far better
   * history and persists it (PSReadLine writes `ConsoleHost_history.txt`), but
   * reading it means knowing which shell is on the other end and where *that*
   * shell puts its history, which is phase 12's registry and not something to
   * guess at from the terminal side.
   */
  let history = $state<string[]>([]);

  /** Longest a suggestion may be, so one pasted monster does not own the bar. */
  const GHOST_MAX = 200;

  function remember(command: string) {
    const at = history.indexOf(command);
    if (at >= 0) history.splice(at, 1);
    history.unshift(command);
    if (history.length > 200) history.pop();
  }

  /**
   * When a suggestion may be offered at all.
   *
   * Only ever with the caret at the very end of the line, and never during a
   * selection. Text after the caret is text the shell will put *before* the
   * completion, so a suggestion mid-line would be a prediction about a line
   * nobody is typing.
   *
   * `.by` rather than the expression form: `menuAuto` is declared further down
   * with the rest of the suggestion strip, and the expression form is evaluated
   * where it is written.
   */
  const suggestLive = $derived.by(
    () =>
      atPrompt &&
      !!input &&
      selTo <= selFrom &&
      cursorCol === input.length &&
      // A drop owns the strip outright while its options are up: those are
      // "how do you want to run this", not "what word is this".
      (!menuOpen || menuAuto),
  );

  /**
   * The directory the path suggestions need listed, or `""`.
   *
   * Only ever past the first word: the first word is a command, and a directory
   * listing is not what completes one.
   */
  const suggestDir = $derived.by(() => {
    if (!suggestLive || !input.includes(" ")) return "";
    const { token } = tokenAt(input, cursorCol);
    return resolveDir(promptCwd, completionRequest(token).dir);
  });

  /**
   * Listings, so suggestions can be derived synchronously while `list_dir` is a
   * round trip. A plain `Map` and a version counter rather than reactive state:
   * an effect that both reads and writes the same `$state` re-triggers itself,
   * and this one writes on every listing.
   *
   * Cleared at every prompt. A listing is only as good as the moment it was
   * taken, and a command that just ran is exactly what creates and deletes
   * files — so the cache is worth one command's worth of keystrokes and no
   * more. That costs one `list_dir` per prompt, and only when a path is
   * actually being typed.
   */
  const dirCache = new Map<string, { name: string; dir: boolean }[]>();
  let dirVersion = $state(0);

  $effect(() => {
    const path = suggestDir;
    if (!path || dirCache.has(path)) return;
    invoke<{ name: string; dir: boolean }[]>("list_dir", { path })
      .then((entries) => {
        dirCache.set(path, entries);
        dirVersion++;
      })
      .catch(() => {});
  });

  /**
   * Every match for the word being typed, best first — history and the curated
   * lists, then the directory. This is *one* list feeding two views of itself:
   * the strip shows which match is selected and how many there are, the ghost
   * shows that same match inline where it would land. One selection, moved only
   * by the arrows, for the same reason there is one focused block.
   */
  const suggestItems = $derived.by(() => {
    if (!suggestLive) return [] as Suggestion[];
    const words = wordSuggestions(input, cursorCol, history, GHOST_COMMANDS, SUBCOMMAND_NAMES);
    if (!suggestDir) return words;
    // Read so this re-runs when a listing lands. The `Map` itself is not
    // reactive — that is the point of it.
    dirVersion;
    const entries = dirCache.get(suggestDir);
    if (!entries) return words;
    const { start, token } = tokenAt(input, cursorCol);
    const { dir, base } = completionRequest(token);
    const paths = completions(entries, base, dir, shellIsWindows()).map((item) => ({
      ...item,
      start,
    }));
    return [...words, ...paths];
  });

  /**
   * The selected match, rendered inline after the caret as the characters it
   * would add.
   *
   * Compared case-insensitively, so `cla` still shows the rest of `CLAUDE.md`.
   * The typed prefix keeps its own case on screen because it is the shell's
   * text and not ours to rewrite — but accepting replaces the whole word, so
   * what actually lands is the name as it is spelled on disk.
   */
  const ghost = $derived.by(() => {
    const item = suggestItems[menuIndex];
    if (!item) return "";
    const typed = input.slice(item.start ?? 0, cursorCol);
    if (!item.text.toLowerCase().startsWith(typed.toLowerCase())) return "";
    return item.text.slice(typed.length, typed.length + GHOST_MAX);
  });

  /**
   * Keep the strip showing the current matches.
   *
   * `untrack` around everything this writes, and it is not a nicety: the strip's
   * own open state feeds back into `suggestLive`, so an effect that both read
   * and wrote it would re-enter itself on every keystroke. It also protects the
   * selection — `menuIndex` must survive a run where the matches did not change,
   * or the arrows would be undone by the next chunk of PTY output.
   */
  $effect(() => {
    const items = suggestItems;
    untrack(() => {
      if (!items.length) {
        if (menuAuto && menuOpen) closeMenu();
        return;
      }
      const same =
        items.length === menuItems.length && items.every((it, i) => it.text === menuItems[i]?.text);
      if (menuOpen && menuAuto && same) return;
      menuAuto = true;
      openMenu(items, items[0].start ?? cursorCol);
    });
  });
  // Solid while keystrokes are landing — a blinking target is hard to track
  // mid-edit. Resumes blinking once the row goes quiet.
  let typing = $state(false);
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let prevInputLen = 0;

  // Sitting the caret after the text meant it tracked the end of the string,
  // not the shell's cursor: it never came back on Backspace and never moved for
  // an arrow key. It is positioned off `cursorCol` instead — one monospace cell
  // per column — which is where PSReadLine actually is.
  //
  // That position is a `left`, so it changes by layout, which CSS cannot
  // transition. FLIP instead: measure where it landed, tween it back from where
  // it was, on transform only. Fires on a real keystroke, so it gets the
  // elastic overshoot of an element gaining focus.
  $effect(() => {
    cursorCol;
    const deleting = input.length < prevInputLen;
    prevInputLen = input.length;
    typing = true;
    clearTimeout(typingTimer);
    // 35% shorter than the 400ms baseline — the bounce reads fine at a
    // tighter follow, and it hands the caret back to blink sooner.
    typingTimer = setTimeout(() => (typing = false), 260);
    if (!caretEl) return;
    // Past three rows the text scrolls inside the bar, and the caret is the one
    // thing that must never be the part scrolled out of view.
    caretEl.scrollIntoView({ block: "nearest" });
    gsap.killTweensOf(caretEl);
    gsap.set(caretEl, { x: 0 });
    const x = caretEl.getBoundingClientRect().left;
    // Clamped, because the distance is only meaningful within one row. Delete a
    // word long enough to unwrap the line and the caret moves *up*, which reads
    // horizontally as most of the bar's width — so the tween started from a
    // point outside the box, spent its first frames behind the clip, and the
    // move looked like it never played. A capped run starts on screen, which is
    // the only part of the travel anyone can see anyway.
    const dx = gsap.utils.clamp(-120, 120, caretX - x);
    caretX = x;
    // While a command is running the caret is a status light, not a cursor: it
    // sits at the start, unlit and not blinking (`.idle`), and it does not
    // travel there — the trip back is the tail of an edit the user is no longer
    // making. `x` is already 0 from the set above, so this is a hard landing.
    if (!atPrompt) return;
    if (!dx || reduceMotion) return;
    // Backspace bounces twice as hard as a typed character — it is the
    // caret snapping backward against the grain of normal left-to-right
    // entry, so the overshoot needs to read as a harder correction.
    const strength = deleting ? 6 : 3;
    // Duration by distance, not one length for every move. A fixed 0.22s is
    // most of a held Backspace's repeat interval, so each new tween killed the
    // last one a fifth of the way in and the caret never actually arrived — it
    // trailed the text it was supposed to be marking. Scaling by the gap keeps
    // a one-cell hop inside the repeat and still gives a whole word deleted at
    // once the full travel. Ceiling stays 0.22: past that it stops reading as
    // a correction and starts reading as a slide.
    const duration = Math.min(0.22, 0.05 + Math.abs(dx) / 1600);
    gsap.fromTo(caretEl, { x: dx }, { x: 0, duration, ease: `back.out(${strength})` });
  });

  // Backspace at column 0 and Delete at end-of-line change neither `input`
  // nor `cursorCol` — there is nothing to mirror — so the effect above never
  // fires and the key reads as dead. This plays the same doubled bounce
  // directly, in the direction that had nothing to eat, so the boundary
  // still gives feedback instead of silently doing nothing.
  function nudgeCaret(dir: 1 | -1) {
    if (!caretEl || reduceMotion) return;
    gsap.killTweensOf(caretEl);
    const dx = dir * -0.5 * parseFloat(getComputedStyle(caretEl).width);
    gsap.fromTo(caretEl, { x: dx }, { x: 0, duration: 0.22, ease: "back.out(6)" });
  }

  /**
   * The bar is docked at the bottom, so a wrapped line grows it upward. It is
   * laid over the stage rather than in flow with it, and the room it needs is
   * given back as scroll padding — growing it must never change the stage's
   * height, because the stage's height is the PTY's row count. Shrinking that
   * mid-line makes the shell redraw and re-wrap the command being typed, which
   * split the echoed line in two and left half of it in the block body.
   *
   * The growth itself is the same FLIP the caret uses: the layout jumps to its
   * new height, then the element is tweened back from where it was on transform
   * only — ANIMATION.md rules out tweening height itself.
   */
  function growUpward(node: HTMLElement) {
    let prev = node.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--input-h", `${next}px`);
      const dy = next - prev;
      prev = next;
      if (!dy || reduceMotion) return;
      // Scoped to `y`: the handoff retract owns `scaleX` on this same element,
      // and clearing the input on Enter resizes the bar in the same frame the
      // retract starts. An unscoped kill would take the retract with it.
      gsap.killTweensOf(node, "y");
      gsap.fromTo(node, { y: dy }, { y: 0, duration: 0.22, ease: "power2.out" });
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }
  /**
   * A block's first content landing, animated rather than snapped.
   *
   * Height is banned everywhere else in ANIMATION.md and sanctioned here: the
   * box goes from a head and a loading bar to a screenful in one frame, and
   * that snap moves everything below it under the reader. `scaleY` is not an
   * option — the content is text and the squash is visible.
   *
   * **Only the first growth.** After that the command is streaming, and a tween
   * per chunk would fight both the next chunk and the scroll sync. So the
   * observer disconnects the moment it has animated once, which also satisfies
   * the doc's unobserve-before-tween guard by never observing again.
   */
  function growBlock(node: HTMLElement) {
    if (reduceMotion) return;
    let prev = node.getBoundingClientRect().height;
    let tween: gsap.core.Tween | undefined;

    // A window resize is not a content change: without this the box latches
    // onto a mid-tween size and chases it for the rest of the drag.
    const cancel = () => {
      tween?.kill();
      node.style.removeProperty("height");
      node.removeAttribute("data-growing");
    };

    const ro = new ResizeObserver(() => {
      const next = node.getBoundingClientRect().height;
      // Only a real jump is worth animating. A pixel of reflow is not.
      if (next <= prev + 1) {
        prev = next;
        return;
      }
      ro.disconnect();
      window.addEventListener("resize", cancel);
      // Tells the growth observer that the shrink it is about to see is ours.
      node.setAttribute("data-growing", "");
      tween = gsap.fromTo(
        node,
        { height: prev },
        {
          height: next,
          duration: 0.45,
          ease: "power3.out",
          overwrite: "auto",
          onComplete: () => {
            node.style.removeProperty("height");
            node.removeAttribute("data-growing");
            window.removeEventListener("resize", cancel);
          },
        },
      );
    });
    ro.observe(node);
    return {
      destroy() {
        ro.disconnect();
        cancel();
        window.removeEventListener("resize", cancel);
      },
    };
  }

  // integration.ps1's exact, known template — "PS <cwd>> ". Stripped from the
  // cursor row directly rather than remembered as a column offset: a column
  // captured once at 133;B goes stale across a resize (reflow shifts every
  // column after it) and across a chunk boundary landing between the prompt
  // text and the B marker, so it doesn't yet reflect this prompt's real
  // width. Re-matching the literal prefix every time has no state to go stale.
  // The trailing space is optional: rows come out of `translateToString(true)`,
  // which trims trailing whitespace, so an empty prompt row is `PS C:\x>` with
  // nothing after the `>`. Requiring the space meant the whole prompt leaked
  // into the input bar until the first character was typed.
  // Deliberately unanchored. Ctrl+C on a running process makes PowerShell echo
  // `^C` and then redraw the prompt on that same row, so the row reads
  // `^CPS C:\x>` — anchored at `^`, the match failed, the mirror took its "no
  // prompt on this row" bail-out, and typing stayed invisible for the rest of
  // that prompt cycle. Whatever precedes the prompt is the abort's own echo and
  // is consumed with it; the prompt's width still falls out of what the strip
  // removed, so `cursorCol` is unaffected. Lazy quantifier so a `>` inside the
  // typed command cannot be mistaken for the prompt's own.
  const PS_PROMPT = /^.*?PS\s+\S.*?>\s?/;
  // The shell writes the prompt text and the 133;B marker as one logical
  // unit, but a PTY read can split them across two chunks — the terminal's
  // 8 KB read boundary has no relation to the shell's write boundaries. Until
  // B has actually been parsed for *this* prompt cycle, the row may only hold
  // a partial prompt that PS_PROMPT won't match yet. This flag closes that
  // window: input only updates once B has fired.
  let promptReady = false;
  // Raw text sent to the shell since the last prompt, tracked synchronously
  // in t.onData — unlike `input`, which mirrors the PTY's echo back and lags
  // behind a paste (a whole line + \r arrives in one onData call, before the
  // echo round-trips). Enter's "did the user type anything" check must not
  // depend on that echo, or a fast paste races it: the block never opens,
  // and the command's output gets silently absorbed as prompt-redraw noise.
  let pendingCommand = "";
  // PowerShell writes some startup noise (loading the injected profile, its
  // own interactive-loop setup) before the first real prompt cycle — that
  // output has no cwd yet, so it fell through the "output arrived with no
  // block open" path below and opened empty, headerless blocks. There's
  // nothing to attribute it to, so it's dropped rather than block-ified
  // until the first prompt has actually completed.
  let booted = false;
  // The window between 133;D (command finished) and the next 133;A (prompt
  // starting). The command's block is already closed and the next one cannot
  // exist yet, so *nothing* arriving here belongs to a block.
  //
  // This is what produced the phantom empty container next to every real one.
  // The fallback below opens a block for output that arrives with none open,
  // and PowerShell writes D and A as one string — but a PTY read boundary has
  // no relation to the shell's write boundary, so a chunk ending between them
  // is routine. When that happened the write callback ran with the block just
  // closed and `atPrompt` not yet true, hit the fallback, and opened an empty
  // block that the following prompt then had nothing to put in.
  //
  // Same root cause as the startup noise `booted` handles: output with nothing
  // to attribute it to. `booted` covers before the first prompt, this covers
  // between every pair after it.
  let betweenCommands = false;
  // The block whose command took over the screen. Its output lives in the
  // alternate buffer and is wiped on exit, so it never gets snapshotted.
  let rawBlockId = -1;

  // #region ── F3 debug overlay ───────────────────────────────────────────────
  // The input mirror and the alt-screen swap have both survived four fixes made
  // by reading the code, which is the signal that the code is not where the
  // answer is. Two things need observing rather than assuming: whether the row
  // PS_PROMPT runs against is the string integration.ps1 thinks it wrote, and
  // whether ConPTY forwards the alt-screen swap at all on this setup.
  //
  // Costs nothing while off: the log push is guarded, and the panel's state is
  // only recomputed on a tick that only fires when the overlay is open.
  let debugOn = $state(false);
  let debugTick = $state(0);
  let debugLog = $state<string[]>([]);

  function debugPush(line: string) {
    if (!debugOn) return;
    // ponytail: fixed 24-line ring, plenty to see one prompt cycle end to end.
    debugLog = [...debugLog.slice(-23), line];
  }

  /** The bytes xterm handed to the PTY for the most recent key. Debug only. */
  let lastSent = $state("");

  /** Live state, recomputed per tick while the overlay is open. */
  function debugState() {
    void debugTick;
    // Sizes come first and are computed before the buffer check — they are the
    // one part of this overlay that is useful when nothing else is.
    //
    // Three numbers because they disagree and the difference is the point:
    // `inner` is the webview viewport (what every `dv` unit resolves against),
    // `outer` includes the window frame and title bar (what tauri.conf.json's
    // width/height set), and the ratio decides whether a pixel measured off a
    // screenshot is a logical pixel or not.
    const sizes = [
      ["window inner", `${window.innerWidth}x${window.innerHeight}`],
      ["window outer", `${window.outerWidth}x${window.outerHeight}`],
      ["dpr / screen", `${window.devicePixelRatio} / ${screen.width}x${screen.height}`],
    ] as const;

    const buf = term?.buffer.active;
    if (!buf) return sizes;
    const y = buf.baseY + buf.cursorY;
    const row = rowText(y);
    return [
      ...sizes,
      ["mode / buffer", `${mode} / ${buf.type}`],
      ["atPrompt / ready / booted", `${atPrompt} / ${promptReady} / ${booted}`],
      ["cursor y,x", `${y},${buf.cursorX}`],
      // JSON-quoted so trailing spaces and stray escapes are visible rather
      // than invisible — the whole point of dumping this.
      ["cursor row", JSON.stringify(row)],
      ["PS_PROMPT matches", String(PS_PROMPT.test(row))],
      ["after strip", JSON.stringify(row.replace(PS_PROMPT, ""))],
      // What xterm actually put on the wire for the last key. This is the line
      // that settles "did the shell receive this character or did the mirror
      // invent it" — everything above is downstream of it.
      ["last key sent", JSON.stringify(lastSent)],
      ["mirrored input", JSON.stringify(input)],
      ["blocks / rawBlockId", `${blocks.length} / ${rawBlockId}`],
    ] as const;
  }
  // #endregion ────────────────────────────────────────────────────────────────

  // Markers live outside `blocks` on purpose: they are live xterm objects and
  // must not be wrapped in Svelte's reactive proxy.
  const markers = new Map<number, IMarker>();

  function currentBlock(): Block | undefined {
    return blocks[blocks.length - 1];
  }

  function openBlock(command: string) {
    // A submitted command puts the reader back at the input bar, so whatever
    // was selected in the scrollback is not what the next key acts on.
    focusedId = null;
    const id = nextId++;
    const marker = term?.registerMarker(0);
    if (marker) markers.set(id, marker);
    blocks.push({ id, cwd: lastCwd, command, buffer: "", shown: "", closed: false, exitCode: null, md: true, runShift: 0 });
  }

  /**
   * Commands VAD/OS answers itself instead of handing to the shell. The `/`
   * prefix is optional on every one of them: `clear` is muscle memory, `/clear`
   * is what anyone who has used a chat client tries first, and neither should
   * be the wrong guess.
   */
  const LOCAL_COMMANDS: Record<string, (args: string) => void> = {
    clear: clearBlocks,
    cls: clearBlocks,
    help: showHelp,
    open: openFile,
  };

  /**
   * The commands above that take the rest of the line. Everything else matches
   * a bare line only, and that distinction is load-bearing rather than tidy:
   * PowerShell's `help` *is* `Get-Help`, so `help git` is a real shell command
   * and must reach the shell, while a bare `help` is ours.
   */
  const LOCAL_ARGS = new Set(["open"]);

  /**
   * What can complete a first word in the ghost suggestion: the commands
   * VAD/OS answers itself, then the parser's curated list. Ours first because
   * they are the ones nothing else on the machine would ever suggest — `help`
   * and `open` are as much commands as `git` is, and leaving the app's own
   * vocabulary out of its own completion is the kind of gap nobody reports
   * because they assume it was deliberate.
   */
  const GHOST_COMMANDS = [...Object.keys(LOCAL_COMMANDS), ...COMMAND_NAMES];

  function localCommand(command: string): (() => void) | undefined {
    const line = command.trim().replace(/^\/\s*/, "");
    const name = (/^\S+/.exec(line) ?? [""])[0].toLowerCase();
    const run = LOCAL_COMMANDS[name];
    if (!run) return undefined;
    const args = line.slice(name.length).trim();
    if (args && !LOCAL_ARGS.has(name)) return undefined;
    return () => run(args);
  }

  /**
   * `open <file>` — hand a path to whatever the OS opens it with.
   *
   * ponytail: the OS default handler, not an editor resolved from config or
   * `$EDITOR`. "Open" already means "the thing this file opens in" everywhere
   * else on the machine, `tauri-plugin-opener` is already a dependency, and an
   * editor setting is a row in a settings panel that nobody has asked for yet.
   * Add one when the default is wrong for somebody, and it lands next to the
   * shell picker in phase 12 where the rest of "which binary" lives.
   *
   * A local command never reaches the shell, so there is no exit code and no
   * block — a toast either way is the whole result surface.
   *
   * Goes through our own Rust command rather than the opener plugin's JS one.
   * The plugin's JS side is guarded by a path scope, which a terminal cannot
   * fill in: the path is whatever the user typed. See `dir.rs`.
   */
  async function openFile(args: string) {
    const path = unquote(args);
    if (!path) return notify("open needs a path");
    // Same join the completion menu uses, so `open src/lib` resolves against
    // the prompt's cwd exactly as Tab does. `~` is passed through untouched by
    // it and will fail here as a directory that is not there — the same
    // ponytail corner, and the same fix (the shell registry knows whose home).
    await invoke("open_path", { path: resolveDir(promptCwd, path) }).catch((err) =>
      notify(`open failed: ${err}`),
    );
  }

  function clearBlocks() {
    // A gesture whose destination is about to be unmounted has nothing left to
    // hand off to, and a pending one would be claimed by the next block to
    // mount — which would be a different command entirely.
    killHandoff();
    killReveals();
    // A block leaning toward the cursor is about to be swept out from under it,
    // and its `y` is the same property the sweep below tweens.
    copyPull?.kill();
    copyPull = undefined;
    // Everything that enters also leaves. Blinking a screenful of blocks out of
    // existence reads as a fault, and this app cannot afford motion that looks
    // like malfunction. Shorter than the entrance, eased *in* so it accelerates
    // away, and no overshoot — nothing that is leaving has arrived.
    //
    // The tween owns the unmount, not this function: Svelte tears the `{#each}`
    // out the instant `blocks` is truncated, so clearing it here would animate
    // nodes that are already gone.
    const leaving = scrollEl ? [...scrollEl.querySelectorAll("section.block")] : [];
    if (!leaving.length) return dropBlocks();
    gsap.to(leaving, {
      autoAlpha: 0,
      y: reduceMotion ? 0 : -8,
      duration: reduceMotion ? 0.1 : 0.16,
      ease: "power2.in",
      // From the end: the newest block is the one the eye is on, so the sweep
      // runs back up the way the output arrived.
      stagger: reduceMotion ? 0 : { each: 0.02, from: "end" },
      onComplete: dropBlocks,
    });
  }

  function dropBlocks() {
    // The focused block is about to stop existing.
    focusedId = null;
    markers.forEach((m) => m.dispose());
    markers.clear();
    // The blocks these belonged to are about to stop existing, and this is the
    // largest thing the session holds.
    dropRawLogs();
    runsOf.clear();
    blocks.length = 1;
    // The shell never sees this command any more, so nothing else drops the
    // xterm scrollback the blocks were snapshotted from. Leaving it would keep
    // a session's worth of rows alive behind a screen that looks empty.
    //
    // `\x1b[3J` (drop saved lines), not `term.clear()`. `clear()` also rewrites
    // the screen and promotes the cursor row to row 0, which the shell is not
    // told about — PSReadLine went on redrawing the input line at the row it
    // still believed the prompt was on, so the cursor row held bare typed text
    // with no prompt in front of it. The mirror strips a prompt off that row to
    // find the input, found none, and showed nothing at all while the shell
    // received every keystroke normally: typing was invisible until Enter ran
    // it. Clearing only the scrollback frees the same memory and moves nothing.
    term?.write("\x1b[3J");
    notify("Output cleared");
  }

  const HELP_NODES: Node[] = [
    { kind: "heading", level: 2, text: "Commands", tone: null },
    {
      kind: "list",
      items: [
        "help — this list. Also /help",
        "clear — clear rendered output, keeping the banner. Also cls, /clear",
        "open <path> — open a file or folder in whatever the system opens it with",
      ],
    },
    { kind: "heading", level: 2, text: "Keys", tone: null },
    {
      kind: "list",
      items: [
        "Up / Down — move through the matches shown above the input",
        "Tab or Right arrow — take the selected match. Enter always runs the line",
        "Up / Down at an empty prompt — the shell's own history, untouched",
        "Type what a command does — remove, list, search, download — and the matches show the command that does it",
        "Running one of those words runs the command: `remove x` sends `rm x`, and the block shows what ran. Words that are already commands somewhere — copy, move, rename, kill, find — are never swapped",
        ".. completes like any folder, so cd .. is one Tab away",
        "Ctrl + B — show the current folder in a panel on the right, as a tree",
        "Click a folder in the panel, or its arrow, to open it. Shift + click puts `cd` at the prompt",
        ".. at the top of the panel goes up a folder, the same way",
        "Click a file in the panel for the same options a file dropped on the window gets",
        "Drag a file out of the panel into any other app to open it there. It is never moved",
        "Ctrl + A — select the whole input line. Backspace deletes it, typing replaces it",
        "Double-click the input bar — the same selection, from the pointer",
        "Ctrl + Up / Down — select a past command block, or click one",
        "Ctrl + Shift + C — copy the selected block, Ctrl + Shift + M as markdown",
        "Ctrl + Shift + R — show the selected block as the bytes it arrived as, and back. Copying it while it is raw copies the bytes",
        "Ctrl + C — stop the running command",
        "Shift + Esc — open and close settings",
        "Esc — dismiss a suggestion, deselect a block, or close settings. With nothing open it goes to the shell, which clears the line",
        "F2 — capture a screenshot",
        "F3 — toggle the debug overlay",
        "Right-click a block — copy its output",
        "Shift + right-click a block — copy it as markdown",
        "Drop a file on the window — pick how to run it, or take the path alone",
      ],
    },
    {
      kind: "text",
      parts: [{ code: false, text: "Every command is optionally prefixed with /. Anything not listed here is handed to the shell." }],
    },
  ];

  /**
   * A block VAD/OS wrote itself: closed on arrival, and with no xterm marker,
   * so `snapshot` leaves its text alone rather than overwriting it with
   * whatever happens to be on the screen. `buffer` still carries the raw text
   * the raw-view toggle needs — every block keeps the bytes it rendered from.
   */
  function showHelp() {
    blocks.push({
      id: nextId++,
      cwd: lastCwd,
      command: "help",
      buffer: toMarkdown(HELP_NODES),
      closed: true,
      exitCode: 0,
      md: true,
      nodes: HELP_NODES,
      runShift: 0,
    });
  }

  function closeBlock(exitCode: number) {
    const last = currentBlock();
    if (last && !last.closed) {
      last.closed = true;
      last.exitCode = exitCode;
      // Nothing will ever read this block again, and the cache holds a copy of
      // its text.
      snapRead.delete(last.id);
    }
  }

  // #region Raw byte log ──────────────────────────────────────────────────────
  /**
   * What actually arrived on the wire, per block.
   *
   * **This is a record, not a render source, and the distinction is the whole
   * design.** `buffer` is read back out of xterm's screen *after* every escape
   * sequence has been applied, and that is the only thing that can be drawn:
   * replaying these bytes as text reproduces every cursor move, erase-line and
   * PSReadLine full-line redraw as literal garbage. So the screen stays what
   * the block renders from, and this is what the block can be *shown as* — the
   * raw toggle, `copy as raw`, and a faithful export.
   *
   * Held outside `blocks` for the same reason `markers` is: bulk binary has no
   * business inside Svelte's reactive proxy, and nothing here is read during
   * render.
   */
  type RawLog = { chunks: Uint8Array[]; bytes: number; dropped: boolean; text?: string; at?: number };
  const rawLogs = new Map<number, RawLog>();
  let rawBytes = 0;
  /**
   * Caps, per block and across the session, counted against the RSS budget in
   * docs/PERFORMANCE.md. A block past its own cap stops logging rather than
   * keeping a window of the middle — a truncated head with a truncated tail is
   * a raw view that lies about what it is showing.
   */
  const RAW_BLOCK_CAP = 1 << 20;
  const RAW_TOTAL_CAP = 24 << 20;

  /**
   * Append a chunk to the open block's log. Called on the PTY's hot path, so it
   * is a push and a counter and nothing else — no decoding, no scanning, no
   * concatenation. Everything that costs happens in `rawText`, on a toggle.
   */
  function logRaw(bytes: Uint8Array) {
    const block = currentBlock();
    // Nothing open, or a full-screen app has the session: there is no block to
    // show these under either way.
    if (!block || block.closed || !block.cwd || block.id === rawBlockId) return;
    let log = rawLogs.get(block.id);
    if (!log) rawLogs.set(block.id, (log = { chunks: [], bytes: 0, dropped: false }));
    if (log.dropped) return;
    if (log.bytes + bytes.length > RAW_BLOCK_CAP) {
      log.dropped = true;
      return;
    }
    log.chunks.push(bytes);
    log.bytes += bytes.length;
    rawBytes += bytes.length;
    while (rawBytes > RAW_TOTAL_CAP && evictRaw());
  }

  /**
   * Drop the oldest surviving log. Oldest first because a raw view is nearly
   * always wanted for something that just happened, and `Map` iterates in
   * insertion order, which is block order.
   *
   * The entry stays behind as `dropped` rather than being deleted: a block that
   * cannot show its bytes has to say so, and a missing entry is
   * indistinguishable from a block that never logged any.
   */
  function evictRaw(): boolean {
    const open = currentBlock()?.id;
    for (const [id, log] of rawLogs) {
      if (id === open || log.dropped) continue;
      rawBytes -= log.bytes;
      rawLogs.set(id, { chunks: [], bytes: 0, dropped: true });
      return true;
    }
    return false;
  }

  function dropRawLogs() {
    rawLogs.clear();
    rawBytes = 0;
  }

  /**
   * One decoder for the session, per docs/PERFORMANCE.md. Only ever used here —
   * xterm does its own decoding, and Rust never converts to `String` at all so
   * that a multi-byte character split across two reads survives.
   */
  const rawDecoder = new TextDecoder();
  /** Our own markers, which are traffic VAD/OS injected rather than output. */
  const OSC_OURS = /\x1b\][07]?133;[^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\]7;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
  const D_MARK = "\x1b]133;D";
  /**
   * Control characters, made visible. A raw view whose escape sequences are
   * still *acting* as escape sequences shows the same thing the rendered view
   * does, only worse — the point is to see the bytes, so ESC becomes a glyph.
   * Newlines stay real: a raw view that is one enormous line is unreadable and
   * nothing is being hidden by keeping it.
   */
  const CTRL = /[\x00-\x09\x0b-\x1f\x7f]/g;
  function visibleCtrl(text: string): string {
    return text.replace(CTRL, (c) => (c === "\x7f" ? "␡" : String.fromCharCode(0x2400 + c.charCodeAt(0))));
  }

  /**
   * The block's bytes, as text, for display and for copy.
   *
   * Trimmed at the tail only. The log opens when the user pressed Enter, so it
   * already starts at the command echo; it closes one chunk late, because the
   * chunk carrying `133;D` carries the next prompt behind it — that prompt
   * belongs to no command and is cut here. Our own OSC markers go with it. Note
   * that PowerShell's integration never sends `133;C`, so an output-start
   * marker is not something to look for.
   */
  function rawText(block: Block): string {
    const log = rawLogs.get(block.id);
    // Blocks VAD/OS wrote itself never had bytes — `buffer` *is* their source.
    if (!log) return block.buffer;
    if (log.dropped && !log.chunks.length) return "";
    // The template reads this on every render, and a block re-renders on every
    // chunk while its command runs. Without the cache a closed block would be
    // re-decoded for any reason at all.
    //
    // ponytail: cached, not incremental. A block left on the raw view *while*
    // it is still producing output re-decodes from the top per chunk, which is
    // quadratic — bounded by RAW_BLOCK_CAP, and only reachable by deliberately
    // toggling a running block. Resume from the last chunk if that stops being
    // an edge case.
    if (log.text !== undefined && log.at === log.chunks.length) return log.text;
    let text = "";
    for (const chunk of log.chunks) text += rawDecoder.decode(chunk, { stream: true });
    text += rawDecoder.decode();
    const end = text.indexOf(D_MARK);
    if (end >= 0) text = text.slice(0, end);
    log.text = text.replace(OSC_OURS, "");
    log.at = log.chunks.length;
    return log.text;
  }
  // #endregion ────────────────────────────────────────────────────────────────

  function rowText(y: number): string {
    return term?.buffer.active.getLine(y)?.translateToString(true) ?? "";
  }

  // #region Colour runs ───────────────────────────────────────────────────────
  /**
   * A reused cell, for the same reason the read buffer in `pty.rs` is reused:
   * this is walked per character of every row that arrives.
   */
  let cellBuf: IBufferCell | undefined;

  /**
   * Append the coloured runs of row `y` to `runs`, in the coordinates of a row
   * whose text starts at `base`.
   *
   * Only runs that say something are recorded. Default-attribute text — nearly
   * all of it — costs one comparison per cell and produces nothing, which is
   * what keeps `tint` returning a bare text node for almost every line.
   *
   * ponytail: cell index is taken as character index. That holds for everything
   * one cell wide, and drifts by a cell on a row containing a wide glyph — the
   * *text* is unaffected either way, since it still comes from
   * `translateToString`, so the cost of being wrong is a colour boundary one
   * character out on a CJK or emoji row. Walk the cells for the text too if
   * that ever matters; it means owning the trailing-whitespace trim as well.
   */
  function rowRuns(y: number, base: number, len: number, runs: Run[]) {
    const line = term?.buffer.active.getLine(y);
    if (!line) return;
    if (!cellBuf) cellBuf = term?.buffer.active.getNullCell();
    if (!cellBuf) return;
    /** The run being accumulated, still open. */
    let open: Run | undefined;
    const width = Math.min(line.length, len);
    for (let x = 0; x < width; x++) {
      const cell = line.getCell(x, cellBuf);
      if (!cell) break;
      // A cell of width 0 is the second half of a wide glyph and carries the
      // same attributes as the first — extending the open run over it is right,
      // and starting a new one on it would split every wide character in two.
      if (cell.getWidth() === 0) continue;
      const fgSet = !cell.isFgDefault();
      const bgSet = !cell.isBgDefault();
      const inverse = !!cell.isInverse();
      if (!fgSet && !bgSet && !cell.isBold() && !cell.isDim() && !cell.isItalic() && !cell.isUnderline() && !cell.isStrikethrough() && !inverse) {
        open = undefined;
        continue;
      }
      const fg = fgSet ? (cell.isFgRGB() ? rgbColor(cell.getFgColor()) : paletteColor(cell.getFgColor())) : "";
      const bg = bgSet ? (cell.isBgRGB() ? rgbColor(cell.getBgColor()) : paletteColor(cell.getBgColor())) : "";
      const next: Run = {
        at: base + x,
        end: base + x + 1,
        // Reverse video is resolved here rather than at paint time. The block
        // renderer has no terminal background to fall back on the way the raw
        // view does, so "swap them" has to become two concrete values while the
        // cell is still in hand.
        fg: inverse ? bg || token("--surface-base") : fg,
        bg: inverse ? fg || token("--text") : bg,
        bold: !!cell.isBold(),
        dim: !!cell.isDim(),
        italic: !!cell.isItalic(),
        underline: !!cell.isUnderline(),
        strike: !!cell.isStrikethrough(),
      };
      if (
        open &&
        open.end === next.at &&
        open.fg === next.fg &&
        open.bg === next.bg &&
        open.bold === next.bold &&
        open.dim === next.dim &&
        open.italic === next.italic &&
        open.underline === next.underline &&
        open.strike === next.strike
      ) {
        open.end = next.end;
        continue;
      }
      runs.push((open = next));
    }
  }
  // #endregion ────────────────────────────────────────────────────────────────

  /**
   * Whether `row` and the row after it are two halves of one split word.
   *
   * PowerShell word-wraps its own error records at the console width and emits
   * a real newline at every break, so xterm never marks those rows as wrapped —
   * to the buffer they are separate logical lines. Most of those breaks belong
   * in the output and are kept. The ones that don't are the breaks PowerShell
   * had no choice about: a word longer than the line has nowhere to wrap and
   * gets cut mid-word, and rejoining it is the difference between one long
   * token and a token with a space dropped into the middle of it.
   *
   * The test: the row is filled to its last column, the next one carries on
   * without a space, and the two fragments together are longer than a line —
   * which is what "didn't fit" means. `glued` says the previous seam was
   * already joined, so the word demonstrably started further back.
   *
   * ponytail: a word that happens to end exactly at the last column, followed
   * by a new logical line, is indistinguishable from a split and gets joined.
   * Needs the emitting program's own wrap width to do better, which the PTY
   * does not carry.
   */
  function splitWord(row: string, next: string, cols: number, glued: boolean): boolean {
    if (row.length < cols) return false;
    const tail = (/\S*$/.exec(row) ?? [""])[0].length;
    const head = (/^\S*/.exec(next) ?? [""])[0].length;
    if (head === 0 || tail + head <= cols) return false;
    // One of: the word began mid-row, it fills the whole next row, or it was
    // already being joined. All three mean it is longer than a line on its own.
    return glued || tail < row.length || next.length >= cols;
  }

  // A block's text is read back out of xterm's screen buffer rather than
  // accumulated from the raw stream. xterm has already applied every escape
  // sequence — cursor moves, erase-line, the full-line redraw PSReadLine does
  // on every keystroke, and reflow on resize. Appending raw bytes instead
  // reproduces all of that as literal garbage. The marker tracks the block's
  // first row as the buffer scrolls and trims.
  /**
   * Where the last read of a block got to, so the next one resumes there.
   *
   * Re-reading every row of a block on every chunk is quadratic in the block's
   * own length, and the constant is not small — a `translateToString` and a
   * regex per row. `git --no-pager diff` is thousands of rows arriving over
   * dozens of chunks, and that product is the whole reason it was slow. A raw
   * terminal has nothing to re-read, which is why it does not pay this at all.
   *
   * Rows already passed cannot change **while output is being appended**, which
   * is the only case this fast path is taken: a repaint (the buffer got shorter)
   * and a reflow (a resize) both throw the cache away and re-read in full.
   */
  const snapRead = new Map<
    number,
    { fromY: number; y: number; text: string; glued: boolean; end: number; runs: number }
  >();
  /** Rows re-read on every pass regardless. See below. */
  const SNAP_SLACK = 2;
  /**
   * Whether the last line of the open block was finished when it was last read.
   *
   * The reveal holds its character split off the element output is still being
   * *appended* to — and that is only true while a line is unfinished. A program
   * that writes a whole row and a newline (`ping`, `ls`, every list there is)
   * has nothing more to put in the element the row landed in, and the cursor
   * standing at column 0 is the program's own statement of that.
   *
   * Read here rather than at reveal time on purpose: this is the same buffer
   * read the rendered text came from, so it describes the DOM that exists. The
   * cursor a frame later describes a screen that may already have moved on.
   */
  let tailComplete = true;

  // A block's text is read back out of xterm's screen buffer rather than
  // accumulated from the raw stream. xterm has already applied every escape
  // sequence — cursor moves, erase-line, the full-line redraw PSReadLine does
  // on every keystroke, and reflow on resize. Appending raw bytes instead
  // reproduces all of that as literal garbage. The marker tracks the block's
  // first row as the buffer scrolls and trims.
  function snapshot(block: Block, full = false) {
    if (block.id === rawBlockId) return;
    const marker = markers.get(block.id);
    if (!marker || marker.line < 0 || !term) return;
    const buf = term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    const cols = term.cols;
    tailComplete = buf.cursorX === 0;

    let from = snapRead.get(block.id);
    // The marker moved (the buffer trimmed under us) or the block got shorter
    // (a program is repainting its own screen) — either way nothing read so far
    // can be trusted.
    if (full || from?.fromY !== marker.line || end < from.end) from = undefined;

    let y = from?.y ?? marker.line;
    let out = from?.text ?? "";
    let glued = from?.glued ?? false;
    // The runs live on the block and are truncated back on resume, rather than
    // being copied into the cache: the cache is rewritten on every pass, and
    // copying a `--help` dump's worth of runs each time is the quadratic read
    // this cache exists to avoid, in a new place.
    let runs = runsOf.get(block.id);
    if (!runs) runsOf.set(block.id, (runs = []));
    runs.length = from?.runs ?? 0;
    // Everything except the last couple of rows is committed. The join between
    // two rows is decided by looking at the row *after* them, and the row after
    // the last one is still being written — so the tail is re-read every pass
    // and only what sits behind it is kept.
    const commitY = Math.max(marker.line, end - SNAP_SLACK);
    let keep = { fromY: marker.line, y, text: out, glued, end, runs: runs.length };

    for (; y <= end; y++) {
      if (y === commitY) keep = { fromY: marker.line, y, text: out, glued, end, runs: runs.length };
      if (!buf.getLine(y)) continue;
      const row = rowText(y);
      // Measured against the row's own text, so a run can never claim more
      // columns than the text it is colouring has characters.
      rowRuns(y, out.length, row.length, runs);
      out += row;
      // A wrapped row continues the same logical line — no newline, otherwise
      // long output gains a break at every terminal width.
      glued = splitWord(row, rowText(y + 1), cols, glued);
      if (!buf.getLine(y + 1)?.isWrapped && !glued) out += "\n";
    }
    keep.end = end;
    snapRead.set(block.id, keep);
    // The block starts on the prompt row, so its first logical line is the
    // echoed command — already captured in `block.command`, drop it here.
    //
    // The runs stay in `out`'s coordinates and this is what tells `tint` how
    // far they moved. Re-indexing them here would be a walk over every run on
    // every chunk.
    // No newline yet means the echoed command is all there is, and the block's
    // text is empty — not the command line, which the head already shows.
    const nl = out.indexOf("\n");
    const cut = !block.command ? 0 : nl < 0 ? out.length : nl + 1;
    block.runShift = cut;
    block.buffer = out.slice(cut).replace(/\s+$/, "");
  }

  /**
   * How long the stream has to be quiet before the block renderer takes the
   * buffer's structure, and the longest it may be held back regardless.
   *
   * A chunk boundary is an artefact of the pipe, not of the text, and parsing
   * on every one of them renders structure the output does not have yet. The
   * quiet window waits for the program to finish its thought; the cap is what
   * keeps a command that never stops talking (`ping -t`, a build) flowing
   * instead of never rendering at all. Both are under a fifth of a second — the
   * output is not being delayed so much as it is being allowed to arrive.
   */
  const SHOW_QUIET = 80;
  const SHOW_MAX = 240;
  /**
   * The same cap for a block that has nothing on screen yet, and much longer.
   *
   * The cap is a compromise for output that keeps coming; the *first* paint is
   * not the same problem. Half a block appearing and the rest arriving after it
   * is the thing that reads as broken, and it is worth waiting for — until this
   * long, a block shows nothing rather than showing part of itself. The loading
   * bar is what covers the wait, so the reader is never looking at an empty box
   * wondering whether anything is happening.
   *
   * A second and a half rather than a fraction of one, because most commands
   * finish inside it: `npm --help` writes its output over several ConPTY reads
   * with gaps of their own, so a shorter hold caught it mid-dump and painted
   * half a block. Anything still running past this is a *streaming* command,
   * and streaming is the case the cap is for.
   */
  const SHOW_FIRST_MAX = 1500;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let showHeldSince = 0;

  /** Take the buffer's structure now. Used when there is provably no more coming. */
  function showNow(block: Block) {
    clearTimeout(showTimer);
    showTimer = undefined;
    showHeldSince = 0;
    if (block.shown === block.buffer) return;
    block.shown = block.buffer;
    queueReveal();
  }

  // One timer, not one per block: only the last block is ever open.
  function showSoon(block: Block) {
    const now = performance.now();
    showHeldSince ||= now;
    if (now - showHeldSince >= (block.shown ? SHOW_MAX : SHOW_FIRST_MAX)) {
      showNow(block);
      return;
    }
    clearTimeout(showTimer);
    showTimer = setTimeout(() => showNow(block), SHOW_QUIET);
  }

  // Scrolling is motion, so it goes through GSAP like everything else (see
  // ANIMATION.md) — a bare scrollTop assignment teleports.
  const mm = gsap.matchMedia();
  // `$state`, not a plain `let`: it is handed to the settings overlay as a prop
  // now, and a plain `let` read in a template compiles to a constant read — the
  // worst bug this codebase has had. The media query can flip mid-session.
  let reduceMotion = $state(false);
  mm.add("(prefers-reduced-motion: reduce)", () => {
    reduceMotion = true;
    return () => (reduceMotion = false);
  });

  let scrollTween: gsap.core.Tween | undefined;

  // A fresh block is empty, so there is nothing under it to scroll against and
  // its head physically cannot reach the top of the viewport. That is why
  // anchoring once on creation moved nothing. `spacerEl` is the fix: reserve
  // exactly the room the last block is short of, so the target is always
  // reachable, and shrink that reservation as real output fills the space.
  let spacerEl: HTMLDivElement;
  /** Static host for the reveal bars — see `barFor`. Built once, never keyed. */
  let barsEl: HTMLDivElement;

  function isLastBlock(node: HTMLElement) {
    return node.parentElement?.querySelector("section:last-of-type") === node;
  }

  // "Move down" is a fast move, not a teleport — a jump gives the eye nothing
  // to follow and the view arrives somewhere unexplained. Duration scales with
  // how far there is to go, so catching up from a screen away still reads as
  // travel while the per-chunk nudges stay near-instant. Both ends are well
  // inside ANIMATION.md's 0.3s output budget.
  function tailDuration(distance: number, view: number) {
    return Math.min(0.26, Math.max(0.08, (distance / view) * 0.22));
  }

  // Manual scrolling detaches the tail; a new command or a mode switch
  // re-attaches it. This used to be inferred from how far the tail had moved,
  // which was wrong in the case that matters: one large output chunk jumps
  // further than any scroll gesture would, and looked identical to the reader
  // having deliberately scrolled away. So "move down" refused to follow exactly
  // the commands that produce enough output to need it.
  let tailDetached = false;
  /** A growth update that arrived mid-tween and still has to be honoured. */
  let tailPending: HTMLElement | undefined;

  // Called from the scroll handler, and only while nothing of ours is tweening
  // — that is what separates a scroll the reader performed from one this code
  // performed. Covers the wheel, a scrollbar drag, and the keyboard equally,
  // which listening for `wheel` alone would not.
  function checkDetached() {
    if (!scrollEl || scrollTween?.isActive()) return;
    const slack = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    tailDetached = slack > scrollEl.clientHeight * 0.1;
  }

  // Why the view is being synced, which is what decides whether it may move
  // and in which direction:
  //
  //   grow   — output arrived. Maintain the reservation, never move the view.
  //            The anchor line does not move once set (`offsetTop` is fixed),
  //            so re-scrolling on every chunk could only fight the reader.
  //   open   — a command was submitted. Move forward to the new block.
  //   switch — the mode was toggled. Move in *either* direction: going back to
  //            "stay on top" means going up to the latest command, which is
  //            the whole point of choosing it.
  /**
   * `shrink` is a block that got *shorter*, which only a program redrawing its
   * own screen does — a pager swapping pages, or any full-screen repaint. It is
   * its own intent because the other three all assume content only ever grows,
   * and on a shrink that assumption fails in both modes at once: the view is
   * left past the end of a document that no longer reaches it, and the browser
   * clamps `scrollTop` to fix it. That clamp is the rearrangement — the layout
   * moving on its own, with neither scroll mode having any say in it.
   */
  type SyncIntent = "grow" | "open" | "switch" | "shrink";

  function syncTail(node: HTMLElement, intent: SyncIntent = "grow") {
    if (!scrollEl || !spacerEl || !isLastBlock(node)) return;
    const anchor = intent !== "grow";
    // A shrink re-applies the mode's rule but does not *reset* the reader's
    // position: scrolling up is how output that has passed gets read, and
    // content redrawing itself under them is not a reason to take that away.
    if (anchor && intent !== "shrink") tailDetached = false;
    // Growth moves every head below it, so the pinned set is stale by now.
    queueStuck();
    const view = scrollEl.clientHeight;

    if (scrollMode === "bottom") {
      // No reservation in this mode — the tail is the target, and spare room
      // under it would mean scrolling to the bottom landed on empty space.
      spacerEl.style.height = "0px";
      const target = scrollEl.scrollHeight - view;
      const distance = target - scrollEl.scrollTop;
      // Scrolling up is how output that already passed gets read; yanking the
      // view back down on the next chunk would make that impossible.
      if (tailDetached && !anchor) return;
      if (intent === "shrink") {
        // The document just got shorter under the view. "Move down" means the
        // tail, so follow it back up — hard, not tweened: the content it would
        // animate across no longer exists, and a page swap fires this on every
        // keypress. Detached readers are left alone above.
        if (!tailDetached && distance < 0) scrollEl.scrollTop = target;
        return;
      }
      if (distance <= 0) return;
      // A tween is already covering this ground. Re-targeting it every chunk
      // is what made the previous version stutter — let it land instead. But
      // the update cannot just be dropped: the last chunk of a command usually
      // arrives while the previous chunk's tween is still running, and after
      // it there are no more resizes to trigger another sync. Dropping it left
      // the view short by exactly that chunk, every time. Hand it to the tween.
      if (scrollTween?.isActive() && !anchor) {
        tailPending = node;
        return;
      }
      // Below roughly a line of text, motion is not perceptible and a tween is
      // pure overhead. This is the case that fires on almost every chunk.
      if (distance < view * 0.02) {
        scrollEl.scrollTop = target;
        return;
      }
      scrollTween = gsap.to(scrollEl, {
        duration: reduceMotion ? 0 : tailDuration(distance, view),
        ease: "power2.out",
        scrollTo: { y: target },
        overwrite: true,
        onComplete: () => {
          const pending = tailPending;
          tailPending = undefined;
          if (pending) syncTail(pending);
        },
      });
      return;
    }

    // The reservation is what holds the head at ANCHOR_TOP when the block is
    // shorter than the viewport, so it is recomputed on a shrink as well —
    // without it a block that halved in height leaves the view scrolled past a
    // document that no longer extends that far.
    spacerEl.style.height = `${Math.max(0, view * (1 - ANCHOR_TOP) - node.offsetHeight)}px`;
    if (!anchor) return;

    // Read after the write: the reservation above has to be in the layout
    // before `offsetTop` and the scroll range mean anything.
    const target = Math.max(0, node.offsetTop - view * ANCHOR_TOP);
    // Opening a block only ever moves the view forward. Switching the mode is
    // allowed to move it back up — that is the reader asking to see the
    // command again, not output pushing them somewhere.
    if (intent === "open" && target <= scrollEl.scrollTop + 1) return;
    if (Math.abs(target - scrollEl.scrollTop) < 1) return;
    scrollTween?.kill();
    // A shrink is not a gesture, so it is not animated. The head is *already*
    // where it belongs in this mode — the block's top has not moved, only its
    // bottom — so this only ever runs to undo a clamp, and animating a
    // correction draws the eye to the thing it exists to hide.
    if (reduceMotion || intent === "shrink") {
      scrollEl.scrollTop = target;
      return;
    }
    scrollTween = gsap.to(scrollEl, {
      duration: 0.3,
      ease: "power2.out",
      scrollTo: { y: target },
      overwrite: true,
    });
  }

  // Output arrives in chunks over the life of a block, so the anchor has to be
  // maintained rather than set once. Observing the element is what makes this
  // fire after layout — reacting to the buffer string instead would compute
  // `offsetHeight` from the previous frame's DOM.
  let growth: ResizeObserver | undefined;
  /**
   * The height each observed block was last seen at. A `ResizeObserver` reports
   * that a box changed, never which way — and the two directions want opposite
   * things here, so the previous value has to be kept to tell them apart.
   */
  const blockHeight = new WeakMap<Element, number>();

  function anchorNewBlock(node: HTMLElement) {
    growth ??= new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const height = el.offsetHeight;
        const before = blockHeight.get(el) ?? 0;
        blockHeight.set(el, height);
        // The first-landing tween writes an inline height that starts *below*
        // the natural one, so without this the box animating into its content
        // reads as a program repainting its own screen: the block gets flagged
        // `data-repaint` for good and loses the character wave for the rest of
        // its life. An animation of ours is never evidence about the program.
        if (el.hasAttribute("data-growing")) continue;
        if (height >= before) {
          syncTail(el, "grow");
          continue;
        }
        // A block only gets shorter when a program is redrawing its own screen,
        // and a redraw rewrites every element in it — so this also marks the
        // block as one the reveal must not character-split. Set once and left:
        // a program that has repainted will repaint again, and the attribute is
        // read by the reveal pass rather than by anything with a lifetime.
        //
        // **A line is not a screen.** A program erasing the line it is standing
        // on — every progress spinner does, `npm ls` most visibly — costs the
        // block one row, and reading that as a redraw took the character wave
        // off the entire command: the spinner ran for a second, and the tree
        // that landed after it was flagged unsafe to split for the rest of its
        // life. The last element is held back on its own account either way
        // (`growingEdge`), and that is where a rewrite in place actually lands.
        //
        // ponytail: measured in rows, not intent. A pager loses a screenful, a
        // spinner loses its own line, and nothing in between has come up.
        const row = parseFloat(getComputedStyle(el).lineHeight) || 20;
        if (before - height > row * 2) el.setAttribute("data-repaint", "");
        syncTail(el, "shrink");
      }
    });
    growth.observe(node);
    // Next frame, not now: `spacerEl` is bound on an element that comes after
    // this one in the template, so on the first block it does not exist yet
    // and the anchor would be dropped silently. A frame also guarantees the
    // new block is in the layout before its `offsetTop` is read.
    requestAnimationFrame(() => syncTail(node, "open"));
    return { destroy: () => growth?.unobserve(node) };
  }

  function syncLast(intent: SyncIntent = "grow") {
    const last = scrollEl?.querySelector<HTMLElement>("section:last-of-type");
    if (last) syncTail(last, intent);
  }

  // Switching the mode has to re-run against the module that is already open,
  // or the setting appears to do nothing until the next command.
  function resyncTail() {
    syncLast("switch");
  }

  // Sticky command line, the same affordance an editor uses to keep the
  // enclosing function name visible. Pinned-state detection is a rect compare
  // rather than the usual IntersectionObserver threshold trick: a sticky
  // element pins to the scrollport's *padding* box while an observer root is
  // its content box, and reconciling the two means hardcoding this element's
  // padding into an observer that fails silently when the padding changes.
  const heads = new Set<HTMLElement>();
  let stuckFrame = 0;

  // The native scrollbar is hidden and this stands in for it. Chromium dropped
  // `overflow: overlay`, so an overlay scrollbar cannot be had from CSS — but a
  // classic one takes layout width on the right only, which pushes every module
  // off-centre by exactly that width. Drawing it over the content is what keeps
  // the container symmetric without reserving a gutter on both sides.
  //
  // Height and offset are written directly rather than tweened. ANIMATION.md's
  // ban on animating height is about tweens; this tracks a scroll position and
  // must be exact on the frame it lands.
  let thumbEl = $state<HTMLElement | undefined>();
  const THUMB_MIN = 24;

  function syncThumb() {
    if (!scrollEl || !thumbEl) return;
    const view = scrollEl.clientHeight;
    const content = scrollEl.scrollHeight;
    const range = content - view;
    // A scrollbar for content that fits is noise. Hidden, not zero-height —
    // a 0px thumb still paints its border radius on some zoom levels.
    thumbEl.classList.toggle("on", range > 1);
    if (range <= 1) return;
    const height = Math.max(THUMB_MIN, (view / content) * view);
    thumbEl.style.height = `${height}px`;
    thumbEl.style.transform = `translateY(${(scrollEl.scrollTop / range) * (view - height)}px)`;
  }

  // Dragging the thumb is a scroll like any other — it goes through
  // `scrollTop`, so `checkDetached` sees it and the tail detaches correctly.
  function thumbDrag(node: HTMLElement) {
    function down(e: PointerEvent) {
      if (!scrollEl) return;
      e.preventDefault();
      const startY = e.clientY;
      const startTop = scrollEl.scrollTop;
      node.setPointerCapture(e.pointerId);

      function move(ev: PointerEvent) {
        if (!scrollEl) return;
        const view = scrollEl.clientHeight;
        const travel = view - node.offsetHeight;
        if (travel <= 0) return;
        // Pointer distance maps onto the *content* range, not the track range —
        // dragging half the track must scroll half the document.
        scrollEl.scrollTop =
          startTop + ((ev.clientY - startY) / travel) * (scrollEl.scrollHeight - view);
      }

      function up(ev: PointerEvent) {
        node.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      }

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }

    node.addEventListener("pointerdown", down);
    return { destroy: () => node.removeEventListener("pointerdown", down) };
  }

  function syncStuck() {
    stuckFrame = 0;
    syncThumb();
    if (!scrollEl) return;
    const edge = scrollEl.getBoundingClientRect().top;
    // ponytail: linear in mounted blocks. Fine until scrollback virtualization
    // (PERFORMANCE.md) exists; that pass should hand this only visible blocks.
    for (const head of heads) {
      head.classList.toggle("stuck", head.getBoundingClientRect().top <= edge + 0.5);
    }
  }

  function onScroll() {
    queueStuck();
    checkDetached();
    // The hovered block moved under a stationary pointer, so the cached rect
    // the ring is positioned against is stale.
    hotRect = undefined;
  }

  function queueStuck() {
    stuckFrame ||= requestAnimationFrame(syncStuck);
  }

  function stickyHead(node: HTMLElement) {
    heads.add(node);
    return { destroy: () => heads.delete(node) };
  }

  // #region Block focus ───────────────────────────────────────────────────────
  // **One** notion of "the focused block", per phase-7-navigation.md. Keyboard
  // navigation is what builds it, but it is not what it is for: fold/unfold
  // (phase 8), the raw toggle and per-block export (phase 10) and copy all need
  // to name a block, and each of them growing its own idea of which one is the
  // version of this that quietly breaks the others.
  //
  // The hover ring is deliberately *not* this. It tracks a pointer, disappears
  // the moment the pointer leaves, and never survives a scroll — it says where
  // the mouse is, not what the next command acts on. Two states, two meanings,
  // and only this one is ever read by a feature.

  let focusedId = $state<number | null>(null);

  function blockEl(id: number) {
    return scrollEl?.querySelector<HTMLElement>(`section.block[data-id="${id}"]`) ?? undefined;
  }

  /** Ids in screen order. The banner is not a block and cannot be focused. */
  function focusableIds() {
    return blocks.filter((b) => b.md).map((b) => b.id);
  }

  /**
   * Focus a block and bring it into view, anchored the same way a new block is
   * — its head at `ANCHOR_TOP`, so the command that produced the output is the
   * line the eye lands on.
   */
  function focusBlock(id: number) {
    focusedId = id;
    const node = blockEl(id);
    if (!node || !scrollEl) return;
    // A jump backwards is the reader deliberately leaving the tail, and is
    // exactly the case `checkDetached` cannot see: it bails while a tween of
    // ours is running, which this is.
    tailDetached = !isLastBlock(node);
    const view = scrollEl.clientHeight;
    const target = Math.max(
      0,
      Math.min(node.offsetTop - view * ANCHOR_TOP, scrollEl.scrollHeight - view),
    );
    scrollTween?.kill();
    if (reduceMotion || Math.abs(target - scrollEl.scrollTop) < 1) {
      scrollEl.scrollTop = target;
      queueStuck();
      return;
    }
    scrollTween = gsap.to(scrollEl, {
      duration: 0.3,
      ease: "power2.out",
      scrollTo: { y: target },
      overwrite: true,
      // The pinned-head set changes all the way through the travel, not only
      // at the end — without this the sticky line lags a whole jump behind.
      onUpdate: queueStuck,
    });
  }

  /**
   * Step the focus one block, newest-last. Past the newest block is the input
   * bar: focus clears and the view returns to the tail, so Ctrl+Down out of the
   * scrollback lands exactly where a fresh prompt does.
   */
  function moveFocus(delta: 1 | -1) {
    const ids = focusableIds();
    if (!ids.length) return;
    if (focusedId === null) {
      // Already at the input bar — there is nothing newer to move to.
      if (delta > 0) return;
      focusBlock(ids[ids.length - 1]);
      return;
    }
    const at = ids.indexOf(focusedId);
    // The focused block was cleared out from under the focus.
    if (at < 0) return focusBlock(ids[ids.length - 1]);
    const next = at + delta;
    if (next >= ids.length) {
      focusedId = null;
      syncLast("switch");
      return;
    }
    focusBlock(ids[Math.max(0, next)]);
  }

  /**
   * Copy the focused block from the keyboard — the same two copies right-click
   * offers, minus the pointer the lean gesture needs a direction from. The
   * settle stands in for it: the block acknowledges the key rather than a toast
   * being the only evidence anything happened.
   */
  function copyFocused(asMarkdown: boolean) {
    const block = blocks.find((b) => b.id === focusedId);
    if (!block) return notify("No block selected — ctrl+up selects one");
    const node = blockEl(block.id);
    if (node && !reduceMotion) settle(node, 0.985);
    copyText(block, asMarkdown);
  }

  /**
   * Show the focused block as the bytes it arrived as, and back.
   *
   * The second consumer of the focus model, and the one it was built for — see
   * phase-7-navigation.md. A crossfade rather than a swap: this is a state
   * change on an object already on screen, and a cut reads as the block having
   * been replaced by a different one.
   *
   * The reveal is killed rather than queued behind. An in-flight reveal is
   * measured against a layout that is about to stop existing, and its teardown
   * would restore text into elements the toggle has already unmounted.
   */
  function toggleRaw() {
    const block = blocks.find((b) => b.id === focusedId);
    if (!block) return notify("No block selected — ctrl+up selects one");
    const log = rawLogs.get(block.id);
    if (!block.raw && log?.dropped && !log.chunks.length) {
      return notify("Raw bytes for this block were dropped — memory cap");
    }
    killReveals();
    const flip = () => (block.raw = !block.raw);
    const node = blockEl(block.id);
    if (!node) return flip();
    gsap.killTweensOf(node);
    // 0.2s across both halves, per the durations table in docs/ANIMATION.md.
    // Out is the shorter one and eased `in`: it is leaving.
    gsap
      .timeline()
      .to(node, { autoAlpha: 0, duration: reduceMotion ? 0.05 : 0.08, ease: "power2.in", onComplete: flip })
      .to(node, { autoAlpha: 1, duration: reduceMotion ? 0.05 : 0.12, ease: "power2.out" });
  }
  // #endregion ────────────────────────────────────────────────────────────────

  /**
   * Resolved value of a design token. The one place JS reads the token layer:
   * xterm keeps its own theme object and does not read CSS variables, and
   * mermaid will join it later, so this is a function from the start rather
   * than a line inside whatever swaps the accent.
   */
  function token(name: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // The sixteen go in as well, so a program's red is the same red in the raw
  // view and in a block. xterm cannot read CSS variables, which is the whole
  // reason this function exists; `ansi.js` hands the *block* renderer the
  // variable itself, and both resolve to the same token.
  const ANSI_NAMES = [
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow",
    "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
  ] as const;

  function xtermTheme() {
    const theme: Record<string, string> = {
      background: token("--surface-base"),
      foreground: token("--text"),
    };
    ANSI_NAMES.forEach((name, i) => (theme[name] = token(`--ansi-${i}`)));
    return theme;
  }

  /** Push the resolved tokens into everything that cannot read them itself. */
  function applyTokens() {
    if (term) term.options.theme = xtermTheme();
  }

  // #region Hover ring ────────────────────────────────────────────────────────
  // Ported from the portfolio's `Module.vue`: a radial gradient tracking the
  // pointer, masked to the border ring only (`.block-hue` in the stylesheet),
  // over a separate border-colour lift. Two layers — the ring supplies the hot
  // spot and the falloff, the border supplies the base lift.
  //
  // Three changes forced by scale, all of them in this function rather than the
  // CSS. The portfolio has ten modules on screen; this has a scrollback.
  //
  //  1. One delegated listener on the scroll container, never one per block.
  //     Per-block listeners are PERFORMANCE.md's failure mode #4 and they leak
  //     one pair per command.
  //  2. `--mx`/`--my` are written to the hovered block only, resolved with
  //     `closest()`. Blocks are never looped over on a pointer move.
  //  3. No permanent `will-change` — it rides on the `.hot` class, so it exists
  //     only while a block is actually the hovered one.
  //
  // Ambient tier: it responds to the pointer and to nothing else, and no action
  // ever changes it.
  let hotBlock: HTMLElement | undefined;
  /** The hovered block's rect, cached — a move is not a layout change. */
  let hotRect: DOMRect | undefined;

  // `overwrite: "auto"`, never `true`. `true` kills every tween on the target,
  // not just the conflicting one — so moving the pointer over a block that was
  // still animating in killed its entrance mid-tween and left it stranded at
  // whatever opacity and scale it had reached. That is the "sometimes ends up
  // faded" bug, and it is a hover away from happening to any block, since the
  // pointer is usually already sitting where the newest one arrives.
  function borderTo(node: HTMLElement, colour: string) {
    gsap.to(node, { borderColor: colour, duration: 0.25, ease: "power2.out", overwrite: "auto" });
  }

  function hoverLeave() {
    if (!hotBlock) return;
    hotBlock.classList.remove("hot");
    borderTo(hotBlock, token("--border"));
    hotBlock = undefined;
    hotRect = undefined;
  }

  function hoverMove(e: PointerEvent) {
    const block = (e.target as HTMLElement)?.closest?.("section.block") as HTMLElement | null;
    if (block !== hotBlock) {
      hoverLeave();
      if (block) {
        block.classList.add("hot");
        borderTo(block, token("--border-bright"));
        hotBlock = block;
      }
    }
    if (!hotBlock) return;
    // Measured on entry and after any scroll, not per move: the rect only
    // changes when the layout does, and a getBoundingClientRect per pointer
    // event is a forced synchronous layout per pointer event.
    hotRect ??= hotBlock.getBoundingClientRect();
    hotBlock.style.setProperty("--mx", `${e.clientX - hotRect.left}px`);
    hotBlock.style.setProperty("--my", `${e.clientY - hotRect.top}px`);
  }
  // #endregion ────────────────────────────────────────────────────────────────

  // Single-slot toast — one notice at a time is all a copy confirmation
  // needs; a queue would be solving a problem this app doesn't have yet.
  let notice = $state("");
  let noticeEl = $state<HTMLElement | undefined>();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function notify(text: string) {
    // A second notice can land mid-exit. Reset the node rather than letting it
    // reappear part-way through a fade it is no longer doing.
    if (noticeEl) {
      gsap.killTweensOf(noticeEl);
      gsap.set(noticeEl, { autoAlpha: 1, y: 0 });
    }
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(dismissNotice, 1600);
  }

  function dismissNotice() {
    if (!noticeEl) {
      notice = "";
      return;
    }
    gsap.to(noticeEl, {
      autoAlpha: 0,
      y: -8,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => (notice = ""),
    });
  }

  // Svelte tears an `{#if}` block out the instant the flag flips, so an exit
  // tween started from the click handler would animate a node that is already
  // gone. The overlay plays its own exit and hands the flag back here when it
  // lands. Every close path goes through this — there is no other way to shut
  // the panel, by design.
  function closeSettings() {
    const landed = () => {
      settingsOpen = false;
      // The panel took focus from xterm when it opened, and xterm is the
      // input engine — without this the user is typing into nothing.
      refocus();
    };
    if (settingsPanel) settingsPanel.close(landed);
    else landed();
  }

  function toggleSettings() {
    if (settingsOpen) closeSettings();
    else settingsOpen = true;
  }

  // #region ── the cwd panel ──────────────────────────────────────────────────
  //
  // The one surface in this app that is not laid *over* the terminal. It takes
  // width away from the scrollback and the input bar instead, because a file
  // list is something you read alongside a command rather than instead of one —
  // an overlay would have to be dismissed before the command it was consulted
  // for could be typed, which is the whole reason a drawer was ruled out for
  // settings and the reason one is right here.
  //
  // It stays a floating surface within that band: inset on all four sides, its
  // own border and shadow, not welded to the window frame.
  let panelOpen = $state(false);
  let panelEl: HTMLElement | undefined = $state();

  // The tree, as one flat map keyed by the path *relative to the prompt's cwd*
  // — `""` is the folder itself, `"src"` is one level in. Flat rather than
  // nested nodes for the reason every tree ends up flat eventually: expanding a
  // folder is then one assignment at a known key instead of a walk to find the
  // node to mutate, and re-reading the whole tree on a new prompt is a loop
  // over the keys that already exist.
  //
  // Relative, not absolute, because the panel's whole contract is that it has
  // no location of its own — every path here is resolved against `promptCwd`
  // at the moment it is used, so a `cd` moves the panel by definition rather
  // than by an invalidation somebody has to remember to write.
  let tree = $state<Record<string, { name: string; dir: boolean }[]>>({});
  let expanded = $state<string[]>([]);

  const panelSep = $derived(shellIsWindows() ? "\\" : "/");
  function joinRel(rel: string, name: string) {
    return rel ? rel + panelSep + name : name;
  }

  function loadDir(rel: string) {
    const cwd = promptCwd;
    if (!cwd) return;
    invoke<{ name: string; dir: boolean }[]>("list_dir", {
      path: resolveDir(cwd, rel),
    })
      // Directories first, then files, each alphabetical — the ordering every
      // file browser has, and the same one `completions` already sorts by.
      .then((entries) => {
        // A listing that was asked for under a different cwd is answering a
        // question nobody is asking any more: a `cd` fired between the request
        // and the reply, and writing it now would put the old folder's contents
        // back into a tree that has already been cleared for the new one.
        if (promptCwd !== cwd) return;
        tree[rel] = entries.sort(
          (a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name),
        );
      })
      .catch(() => {
        if (promptCwd === cwd) tree[rel] = [];
      });
  }

  // Listing follows the shell, never the panel. `dirVersion` is bumped by the
  // same OSC 133;A handler that drops the completion cache, so every folder
  // currently on screen — not just the root — is re-read once per prompt and
  // picks up files a command just wrote.
  //
  // `expanded` is read through `untrack` on purpose: expanding a folder loads
  // that one folder itself, and re-listing the other eight because the array
  // changed is eight IPC round-trips to learn nothing.
  //
  // The reset for a new cwd is in this same effect rather than one of its own,
  // and that is a correctness point, not tidiness: as two effects the loads for
  // the *old* cwd were already in flight when the reset cleared the tree, and
  // they landed a moment later and put the old folder back on screen.
  let panelCwd = "";
  $effect(() => {
    const cwd = promptCwd;
    dirVersion;
    if (!panelOpen || !cwd) return;
    untrack(() => {
      // A different cwd is a different tree. Dropping it rather than merging is
      // the point: a folder called `src` in the new directory is not the `src`
      // that was expanded in the old one, and keeping the expansion open would
      // silently claim it was.
      if (cwd !== panelCwd) {
        panelCwd = cwd;
        expanded = [];
        tree = {};
      }
      for (const rel of ["", ...expanded]) loadDir(rel);
    });
  });

  function toggleDir(rel: string) {
    if (expanded.includes(rel)) {
      // Descendants go with it. Collapsing and re-expanding then re-reads,
      // which is what makes a stale subtree impossible to keep on screen.
      expanded = expanded.filter((p) => p !== rel && !p.startsWith(rel + panelSep));
      return;
    }
    expanded = [...expanded, rel];
    loadDir(rel);
  }

  /**
   * The band the panel occupies, as a fraction of `--panel-w`, and the one
   * tween that moves it.
   *
   * ANIMATION.md bans animating width and padding, and this is the sanctioned
   * exception the user asked for by name: the terminal's own frame never moves,
   * so the only way the output and input containers can arrive at their new
   * width is for that width to be animated. The ban's real target is a tween
   * whose *only* option was a layout property — this one has no other option,
   * because the thing being animated is a layout fact.
   *
   * **One tween drives both sides**, and that is not a tidiness point. The
   * panel's left edge and the terminal's right edge have to stay welded
   * together or the gesture reads as two objects that happen to be moving at
   * the same time. Two tweens with matching numbers agree only until someone
   * retunes one of them; one tween cannot disagree with itself — the same rule
   * the handoff's `--gap` is written under.
   */
  let appEl: HTMLElement | undefined = $state();
  const band = { p: 0 };
  let bandTween: gsap.core.Tween | undefined;
  // Read by the resize observer. A layout property tweening per frame is
  // exactly the thing that observer is watching for, and its callback is not
  // cheap — see `syncBand`.
  let bandMoving = false;
  let syncBand: () => void = () => {};

  function writeBand(node: HTMLElement | undefined) {
    // A multiplier on the custom property rather than a pixel figure, so the
    // width stays the `clamp()` the stylesheet owns and this code never has to
    // know what it resolved to.
    appEl?.style.setProperty("--panel-open-w", `calc(var(--panel-w) * ${band.p})`);
    if (node) gsap.set(node, { x: (1 - band.p) * (node.offsetWidth + 12) });
  }

  function moveBand(node: HTMLElement, to: 0 | 1, onLanded: () => void) {
    bandTween?.kill();
    if (reduceMotion) {
      // Skipped, not shortened: the band snaps and the panel gets the 0.1s
      // opacity fade the reduced-motion table gives every panel slide.
      band.p = to;
      writeBand(undefined);
      gsap.set(node, { x: 0 });
      gsap.to(node, { autoAlpha: to, duration: 0.1, onComplete: onLanded });
      syncBand();
      return;
    }
    bandMoving = true;
    bandTween = gsap.to(band, {
      p: to,
      // The chrome numbers: the settings panel's rise on the way in, its
      // shorter accelerating leave on the way out.
      duration: to ? 0.34 : 0.2,
      ease: to ? "power3.out" : "power2.in",
      onUpdate: () => writeBand(node),
      onComplete: () => {
        bandMoving = false;
        writeBand(node);
        syncBand();
        onLanded();
      },
    });
    gsap.to(node, { autoAlpha: to, duration: to ? 0.2 : 0.15, ease: "power2.out" });
  }

  /** The entrance. The panel pushes the terminal aside rather than arriving after it has moved. */
  function panelSlide(node: HTMLElement) {
    band.p = 0;
    gsap.set(node, { autoAlpha: 0 });
    writeBand(node);
    moveBand(node, 1, () => {});
  }

  // Same rule as `closeSettings`: the tween owns the unmount, because Svelte
  // tears the `{#if}` out the instant the flag flips.
  function closePanel() {
    if (!panelEl) {
      panelOpen = false;
      return;
    }
    moveBand(panelEl, 0, () => {
      panelOpen = false;
      refocus();
    });
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else panelOpen = true;
  }

  /**
   * Replace the whole prompt line with `text`.
   *
   * Backspaces clear everything left of the caret and Delete everything right
   * of it, rather than assuming the caret is at the end. Two keys every line
   * editor implements, so this stays true of a shell that is not PowerShell —
   * Ctrl+U would have been one keystroke and is unbound in PSReadLine's Windows
   * editmode, where it arrives as a literal `^U`.
   */
  function replaceLine(text: string) {
    const right = Math.max(0, input.length - cursorCol);
    invoke("pty_write", {
      data: "\x7f".repeat(cursorCol) + "\x1b[3~".repeat(right) + text,
    });
    refocus();
  }

  /**
   * Clicking an entry types at the prompt — it never runs anything. The panel is
   * a second way to name a path, the same job the suggestion strip does, so it
   * answers the same way: the shell owns the line, and what the user does with
   * the name is theirs. A panel that ran `cd` on a click would be a second
   * command source with no block behind it.
   *
   * Three gestures, and the split follows what each kind of thing is for:
   *
   * - **A folder** opens in place. Looking inside a folder is the thing a tree
   *   is for, and it is the one action here that does not touch the shell at
   *   all — so it is the bare click, and the twisty is the same action with a
   *   target you can hit without reading the name.
   * - **Shift and a folder** replaces the line with `cd <path>`. Replaces, not
   *   appends: the caret is usually sitting in the middle of something else,
   *   and a `cd` spliced into a half-typed command is a line nobody asked for.
   *   It is still not run — the same rule as everything else here.
   * - **A file** goes through the same path a file dropped on the window does:
   *   the strip comes up with how to run it, most likely runner first —
   *   `bash script.sh`, `python x.py`, `& thing.exe` — with the bare path and a
   *   `cd` at the bottom. This is deliberately not a second answer to a
   *   question already answered: a click in the panel and a drag from Explorer
   *   are the same event with a different source, and a file explorer built
   *   into a terminal is exactly the thing that must not disagree with itself
   *   about what a file is for. `runOptions` is where the table lives.
   *
   * Shift on a file does the same as a plain click — `cd` to a file is not a
   * command, so there is no second gesture to give it.
   */
  function panelPick(e: MouseEvent, entry: { name: string; dir: boolean }, rel: string) {
    if (dragTook) {
      dragTook = false;
      return;
    }
    if (entry.dir && !e.shiftKey) {
      toggleDir(rel);
      return;
    }
    if (entry.dir) replaceLine(`cd ${quotePath(rel, shellIsWindows())}`);
    else dropPaths([resolveDir(promptCwd, rel)]);
  }

  /**
   * The drag preview, as a base64 PNG — which is the one form the plugin takes
   * that is not a path to a file on disk. Drawn rather than shipped as an
   * asset: it is a rounded accent square, so it costs no binary in the repo and
   * no resource to resolve at runtime, which on Linux is a real saving because
   * a bundled asset's path is a different answer per package format.
   *
   * Built once. It never changes, and a canvas per drag is a canvas per drag.
   */
  let dragIcon = "";
  function dragPreview() {
    if (dragIcon) return dragIcon;
    const size = 44;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7e55dd";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(2, 2, size - 4, size - 4, 8);
    ctx.fill();
    dragIcon = canvas.toDataURL("image/png");
    return dragIcon;
  }

  /**
   * Dragging a row out of the window.
   *
   * **This is a real OS drag, not an HTML5 one, and it had to be.** A webview
   * drag carries `text/plain`; every other application wants a file, so Paint
   * and Aseprite showed the stop cursor and there was no `DataTransfer` tuning
   * that would have changed it — a WebView2 drag cannot be promoted into a
   * shell file drag. `tauri-plugin-drag` starts the platform's own: OLE on
   * Windows, `file://` URIs through GTK on Linux.
   *
   * **`mode: "copy"`, never `"move"`.** Those are the only two the native API
   * has — `link` does not exist down here, which is a correction to what the
   * HTML5 version claimed. Copy is the read-only one: the target reads the file
   * and the source is untouched. `move` asks the target to take the file *and
   * the source to delete it*, which is the one thing this panel must never be
   * able to do.
   *
   * Started from a pointer move rather than `dragstart`: the webview's own drag
   * events are what Tauri's OS-level file-drop handler displaces, and that
   * handler is what makes dragging a file *in* from the file manager work. So
   * the gesture is measured here — past `DRAG_SLOP` with the button down is a
   * drag, anything less is the click that opens the run options.
   */
  const DRAG_SLOP = 5;
  /**
   * Set when a drag takes over, and spent by the click that follows it.
   * The native drag grabs the pointer, but the button still goes up over the
   * row it went down on — so without this, dragging a file into Paint would
   * also leave the run-options strip up behind it.
   */
  let dragTook = false;
  function panelDragStart(e: PointerEvent, rel: string) {
    if (e.button !== 0) return;
    const from = { x: e.clientX, y: e.clientY };
    const path = resolveDir(promptCwd, rel);
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < DRAG_SLOP) return;
      done();
      dragTook = true;
      startDrag({ item: [path], icon: dragPreview(), mode: "copy" }).catch((err) =>
        notify(`drag failed: ${err}`),
      );
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  }
  // #endregion ────────────────────────────────────────────────────────────────

  /**
   * Delete the whole selected line, as the keys that would have done it.
   *
   * The shell owns the line; we own the selection. So the edit is expressed the
   * only way the shell will accept one — backspaces for everything left of the
   * caret, deletes for everything right of it. Same move `acceptMenu` makes to
   * replace a half-typed word, and the reason both work for any shell is that
   * neither depends on a binding: `\x7f` and `CSI 3~` are what a real keyboard
   * sends.
   *
   * `after` rides along in the same write so a typed character that replaces the
   * selection cannot arrive before the erase it replaces.
   */
  function eraseSelection(after = "") {
    const del = Math.max(0, input.length - cursorCol);
    invoke("pty_write", { data: "\x7f".repeat(cursorCol) + "\x1b[3~".repeat(del) + after });
    selectAll = false;
  }

  /** Select the whole input line, from the pointer. Ctrl+A's other half. */
  function selectInput() {
    if (mode === "raw" || !atPrompt || !input.length) return;
    document.getSelection()?.removeAllRanges();
    selectAll = true;
    term?.focus();
  }

  /**
   * The bytes a key would have put on the wire, for the one case where it can
   * never be put there by the terminal itself: the event was delivered to
   * whatever was clicked last, and an event is not delivered twice.
   *
   * **Ctrl+letter is the control byte, and it is the reason this exists.**
   * `\x03` is the interrupt — the key a reader reaches for when a program will
   * not stop — and a terminal that drops it because the keyboard had drifted
   * onto a `<section>` is broken in the way that matters most. Ctrl+D, Ctrl+Z
   * and the rest come out of the same arithmetic.
   *
   * Deliberately not a general key encoder: arrows, function keys and anything
   * needing the application-cursor modes are xterm's job, and by the time one
   * of those is pressed the `focus()` beside this call has already put the
   * keyboard back for every key after it.
   */
  function keyBytes(e: KeyboardEvent): string {
    if (e.altKey || e.metaKey) return "";
    if (e.ctrlKey) {
      return /^[a-zA-Z]$/.test(e.key)
        ? String.fromCharCode(e.key.toUpperCase().charCodeAt(0) & 0x1f)
        : "";
    }
    if (e.key.length === 1) return e.key;
    return { Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b" }[e.key] ?? "";
  }

  /**
   * Keys VAD/OS answers itself in block mode, so they are never written through
   * to the shell by the recovery above — the handlers below own them, and they
   * run whether or not the keyboard had drifted.
   *
   * Raw mode has no entry here on purpose: a full-screen app owns its keyboard
   * outright, including Esc and Tab.
   */
  function appKey(e: KeyboardEvent) {
    if (e.key === "Escape" || e.key === "Tab" || e.key === "F2" || e.key === "F3") return true;
    if (!e.ctrlKey || e.altKey) return false;
    if (e.shiftKey) return /^[cCmM]$/.test(e.key);
    return /^[aAbB]$/.test(e.key);
  }

  /**
   * The window's own keys: Esc, Tab and Ctrl+A.
   *
   * All three are on `svelte:window` in the capture phase rather than in
   * xterm's key handler, and for one reason — xterm's handler sits on its own
   * textarea, so it does nothing whenever anything else holds focus. That is
   * fine for a key the shell should get anyway, and wrong for these three,
   * which must behave the same whatever was last clicked.
   *
   * Raw mode is exempt throughout: a full-screen app owns its keyboard.
   */
  function onAppKey(e: KeyboardEvent) {
    // A real text field is being typed into, so every key here is its own —
    // except Esc, which is how the panel holding it is closed.
    if (wantsKeyboard(document.activeElement)) {
      if (e.key !== "Escape") return;
    }
    // **A keystroke always reaches the program, even the first one after focus
    // went somewhere else.** `keepFocus` puts the keyboard back on every way out
    // it can see, and this is the case it cannot: focus that was already gone
    // when the key was pressed. Taking it back is not enough on its own — the
    // event has already been delivered to the wrong element and will not be
    // delivered again — so the key is written through by hand rather than
    // silently dropped.
    //
    // **This runs in raw mode too, and it is not restricted to the prompt.**
    // Both of those were holes in the same guard, and both of them were the
    // reported "I have to press Ctrl+C or q four times": the recovery sat
    // behind an early return for raw mode, so nothing at all put the keyboard
    // back during `htop` or `vim`, and behind `atPrompt`, so every key pressed
    // while a command was *running* — which is every key that stops one — was
    // dropped. A key that ends a program is exactly the key most likely to be
    // pressed after clicking around in its output.
    else if (term && document.activeElement !== term.textarea) {
      term.focus();
      const bytes = mode === "raw" || !appKey(e) ? keyBytes(e) : "";
      if (bytes) {
        e.preventDefault();
        // The selection is ours and the shell knows nothing about it, so a
        // character typed over it is an erase plus that character.
        if (mode !== "raw" && selectAll && !e.ctrlKey && e.key.length === 1) {
          eraseSelection(bytes);
        } else {
          // Everything `t.onData` would have done for a key it never saw. An
          // abort stops the output the reveal is walking through, so the same
          // interrupt rule applies however the byte was produced.
          if (bytes.includes("\x03")) killReveals();
          invoke("pty_write", { data: bytes });
        }
        return;
      }
    }

    if (mode === "raw") return;

    // **Tab never moves focus.** The output is a transcript, not a form: there
    // is nothing in it to tab *to*, but a link in a block is focusable and the
    // panel is full of buttons, so the browser was happy to walk the caret out
    // of the input and into the scrollback. Everything about Tab belongs to the
    // input — it is how a suggestion is taken — so it is taken outright here,
    // before focus can move, and handled in full rather than handed on.
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      term?.focus();
      if (!atPrompt) return;
      if (menuOpen) acceptMenu();
      else openCompletions();
      return;
    }

    // **Ctrl+A means the input line, never the page.** Unintercepted it is the
    // webview's select-all, which selects the entire scrollback — every block
    // on screen highlighted, and a Backspace after it doing nothing to any of
    // them, because none of that text is editable by anyone. It is not sent to
    // the shell either; see `selectAll`.
    if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[aA]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      term?.focus();
      if (atPrompt && input.length) selectAll = true;
      return;
    }

    if (e.key !== "Escape") return;

    /** Taken by us: the shell must not also receive it. */
    const take = () => {
      e.preventDefault();
      // Capture phase on the window, so this is what keeps the key away from
      // xterm's textarea below — nothing further down the tree ever sees it.
      e.stopPropagation();
    };

    // **Shift+Esc opens the panel; bare Esc only ever leaves something.**
    // Opening a panel is not what Esc means anywhere else, and it cost the
    // shell a key it uses: PSReadLine clears the line with Esc, and so does
    // readline's `\e`. Bare Esc with nothing open now goes back to the shell.
    if (e.shiftKey) {
      take();
      toggleSettings();
      return;
    }
    // Innermost thing first, in the order the user is inside them. A panel is
    // outermost: Esc closes it even though Esc no longer opens it, because a
    // surface that traps the keyboard has to be leavable by the key everything
    // else is left by.
    if (selectAll) {
      take();
      selectAll = false;
      return;
    }
    if (menuOpen) {
      take();
      closeMenu();
      return;
    }
    if (focusedId !== null) {
      take();
      focusedId = null;
      return;
    }
    if (settingsOpen) {
      take();
      closeSettings();
    }
    // Nothing to leave: Esc is the shell's, untouched.
  }

  // Enter/exit only — the block-entrance timing from ANIMATION.md (autoAlpha
  // + y, 0.25s), reused here since a toast is the same kind of transient chrome.
  function noticeFade(node: HTMLElement) {
    gsap.from(node, { autoAlpha: 0, y: -8, duration: 0.25, ease: "power2.out" });
    return {
      destroy() {
        gsap.killTweensOf(node);
      },
    };
  }

  // #region Attention tiers ───────────────────────────────────────────────────
  // ANIMATION.md: every animation is focal, peripheral, or ambient, and the
  // tier decides the amplitude. Focal is written literally at the call site;
  // this is the other two, which are the ones that get overdone by accident.
  //
  // Peripheral is 40% amplitude with no overshoot, ever — a `power2.out` and a
  // scaled-down number. Ambient (hover, caret, dividers) needs no helper: it
  // never responds to an action, so it has nothing to scale against.

  /** Peripheral amplitude: 40% of whatever the focal number would have been. */
  const PERIPHERAL = 0.4;

  /**
   * The discrete settle — the element *losing* focus. One quantized overshoot
   * and done, deliberately not a spring: a smooth bounce here reads as "still
   * happening" and competes with whatever just took over. The elastic
   * (`back.out`) belongs to the element gaining focus and the two are not
   * interchangeable; swapping them inverts what the motion says.
   */
  function settle(
    target: gsap.TweenTarget,
    from: number,
    { prop = "scale", tl, at }: { prop?: "scale" | "scaleX" | "scaleY"; tl?: gsap.core.Timeline; at?: number } = {},
  ) {
    // Overshoot past rest, scaled to the peripheral 40%, in the direction the
    // element is coming back from — a retract undershoots, so this overshoots.
    const peak = 1 + (from - 1) * PERIPHERAL;
    const vars: gsap.TweenVars = {
      keyframes: [
        { [prop]: peak, duration: 0.08, ease: "steps(2)" },
        { [prop]: 1, duration: 0.08, ease: "steps(2)" },
      ],
    };
    if (tl) {
      tl.to(target, vars, at);
      return;
    }
    gsap.to(target, vars);
  }
  // #endregion ────────────────────────────────────────────────────────────────

  // #region Handoff ───────────────────────────────────────────────────────────
  // Submitting a command is the reference handoff: three overlapping beats on
  // one timeline — the ghost "> " mark runs to the end of the command it is
  // about to hand over, the block's border then draws outward from the top
  // centre in both directions, and the finished box pops. The continuity is
  // positional rather than dimensional: the border starts drawing from the
  // point the mark just left, so the container reads as having been spawned by
  // the ghost line rather than as a box that faded in near it.
  //
  // Split across two functions because the block does not exist yet when the
  // gesture starts: `startHandoff` runs on Enter, `blockEnter` picks the
  // gesture up when Svelte mounts the section a frame later.
  //
  // The two halves are two timelines, not one, and that is deliberate. Adding
  // the block's beats to the input's timeline meant the whole gesture depended
  // on the block mounting before that timeline finished — and when a slow frame
  // (PTY spawn, a first parse) pushed the mount past it, the children landed on
  // a timeline whose playhead was already at the end and never rendered. The
  // block stayed frozen at its spawn size: small, offset, and overflowing its
  // own box. `handoffParts` is what keeps "kill both halves together" true
  // without making one half's existence depend on the other's clock.

  /**
   * When the border starts drawing, measured from the moment of Enter. The mark
   * is still travelling at that point — the beats overlap by roughly a third,
   * which is what makes the gesture read as one movement instead of three.
   */
  const HANDOFF_BEAT = 0.1;

  /**
   * How far past its resting width the finished box springs, in `dvw`, per side.
   * Small on purpose: this is the box saying it landed, not a second entrance.
   */
  const BOUNCE_DVW = 0.4;

  /**
   * How late a block may mount and still be treated as the one the user just
   * submitted. Past this the gesture is stale and the block gets the plain
   * entrance, which is always correct.
   *
   * Wider than the 250ms it was under the fly-in, because the draw is an
   * in-place gesture: it has no remembered position to land against, so a late
   * block draws its border correctly wherever it ended up. The only thing this
   * window still has to catch is a block so late that nobody connects it to the
   * Enter that caused it — and a shell round trip can genuinely take a few
   * hundred milliseconds, which was showing up as a block that skipped the draw
   * and appeared fully bordered.
   */
  const HANDOFF_STALE_MS = 600;

  let inputBarEl: HTMLDivElement | undefined = $state();
  /** Every animation in the current gesture, so an interrupt kills them together. */
  let handoffParts: gsap.core.Animation[] = [];
  /** Set by beat 1, claimed by the next block to mount. */
  let handoffPending = false;
  let handoffAt = 0;
  /** The frozen copy of the command being wiped, if a gesture is in flight. */
  let handoffWipe: HTMLElement | undefined;
  /** Undoes the clips the gesture wrote into the live prompt. */
  let handoffRestore: (() => void) | undefined;

  /**
   * End the gesture now. `progress(1)` renders every part to its final state
   * before killing it — without that, an interrupted handoff leaves the block
   * wherever the tween happened to be, which is what a broken animation looks
   * like from the outside.
   */
  function killHandoff() {
    handoffParts.forEach((part) => part.progress(1).kill());
    handoffParts = [];
    handoffPending = false;
    // `progress(1)` runs the timeline's `onComplete`, which does both of these
    // — but only for a timeline that got as far as being built. A gesture
    // killed before that leaves the copy sitting over the bar and, far worse,
    // leaves the prompt clipped to nothing.
    handoffWipe?.remove();
    handoffWipe = undefined;
    handoffRestore?.();
    handoffRestore = undefined;
    releaseReveal();
  }

  /**
   * The container has arrived (or the gesture is over), so the rows it owes may
   * start. Always paired with the `revealHeld` set in `startHandoff` — leaving
   * it set is the one bug here that stops output appearing at all, so every
   * path out of the gesture goes through this.
   */
  function releaseReveal() {
    if (!revealHeld) return;
    revealHeld = false;
    queueReveal();
  }

  function startHandoff() {
    if (reduceMotion || !inputBarEl) return;
    // Never queue: a queued handoff is a lie about when the command ran.
    killHandoff();
    handoffPending = true;
    handoffAt = performance.now();
    // The block's first rows usually land in the same chunk that opened it, so
    // without this the reveal starts while the block is still in the air.
    revealHeld = true;

    // The mark and the text it is about to hand over. Measured rather than
    // assumed: the run is however wide the command is, so a one-word command
    // gets a short throw and a long pipeline a long one — the gesture reports
    // what was submitted.
    const mark = inputBarEl.querySelector(".ghost-mark");
    const text = inputBarEl.querySelector(".input-text");
    if (!mark || !text) return;
    const bar = inputBarEl.getBoundingClientRect();
    const rect = text.getBoundingClientRect();
    const markRight = mark.getBoundingClientRect().right;
    // The ghost completion sits inside this box and is not part of what is
    // being handed over — it was never typed. `atPrompt` has already gone false
    // by the time this runs, so Svelte will drop it, but not until it flushes,
    // which is after every measurement here. Without this the mark travels past
    // the end of the command to erase a suggestion nobody committed.
    const ghostW = inputBarEl.querySelector(".ghost-suggest")?.getBoundingClientRect().width ?? 0;
    const textW = rect.width - ghostW;
    const dx = Math.max(0, rect.right - ghostW - markRight);
    const cwd = inputBarEl.querySelector<HTMLElement>(".cwd-text");
    const sep = inputBarEl.querySelector<HTMLElement>(".block-sep");

    // **A frozen copy of the command, wiped as the mark passes over it.**
    //
    // A copy and not the live element: `input` is cleared in the same handler
    // that starts this, so the real text is gone a frame later — and even if it
    // were not, animating a clip on DOM Svelte re-renders is the hazard
    // QUIRKS §8 is about. The clone is ours, is inside the bar so the scoped
    // styles still reach it, and is torn down on every path out of the gesture.
    const wipe = text.cloneNode(true) as HTMLElement;
    wipe.querySelector(".caret")?.remove();
    // Same reason as the caret: it is in this box but it is not the command.
    wipe.querySelector(".ghost-suggest")?.remove();
    Object.assign(wipe.style, {
      position: "absolute",
      left: `${rect.left - bar.left}px`,
      top: `${rect.top - bar.top}px`,
      width: `${textW}px`,
      pointerEvents: "none",
    });
    inputBarEl.append(wipe);
    handoffWipe = wipe;

    // Everything the mark passes over, clipped from the left by however far it
    // has got. The path and the separator are the *live* elements: a clip is a
    // style on the element, not a rewrite of its contents, so a re-render drops
    // it harmlessly — the same reason the reveal's bars are allowed to write one.
    // Only the command is a copy, because only the command is about to be
    // cleared out from under us.
    const erasable = [cwd, sep].filter((el): el is HTMLElement => !!el);
    const boxes = erasable.map((el) => ({ el, box: el.getBoundingClientRect() }));
    let carrying = true;

    function paint() {
      const x = gsap.getProperty(mark, "x") as number;
      const edge = markRight + x;
      for (const { el, box } of boxes) {
        const cut = Math.min(box.width, Math.max(0, edge - box.left));
        el.style.clipPath = `inset(0 0 0 ${cut}px)`;
      }
      // The command only ever goes away — it is not coming back, it is in the
      // block now. The path and the separator belong to the prompt and are
      // written back as the mark retreats over them.
      if (carrying) {
        const cut = Math.min(textW, Math.max(0, edge - rect.left));
        wipe.style.clipPath = `inset(0 0 0 ${cut}px)`;
      }
      // The caret travels with the mark, by the mark's own displacement — it is
      // the thing that says where typing goes, and typing goes where the mark
      // is. It comes back on the return beat for free, since it is reading the
      // same number.
      if (caretEl) {
        // Clearing the input fires the caret's own catch-up bounce in the same
        // frame this starts. For the length of the gesture the caret belongs to
        // the gesture, so that tween is taken off it rather than fought.
        gsap.killTweensOf(caretEl, "x");
        gsap.set(caretEl, { x });
      }
    }

    function restore() {
      for (const { el } of boxes) el.style.removeProperty("clip-path");
      if (caretEl) gsap.set(caretEl, { clearProps: "x" });
    }

    const tl = gsap.timeline({
      onComplete: () => {
        gsap.set(mark, { clearProps: "x,scale" });
        restore();
        wipe.remove();
        if (handoffWipe === wipe) handoffWipe = undefined;
      },
    });
    handoffRestore = restore;
    // Beat 1 — focal. The mark runs to the end of the command, taking the
    // command with it: the clip is driven off the mark's own position each
    // frame rather than off a matching ease, so the text disappears exactly
    // under the glyph and not near it. This is what the travel is *for* — it
    // used to be a mark sliding over text that had already vanished, which is
    // why it read as too fast to follow. Where it stops is where the block's
    // border starts drawing from.
    tl.to(
      mark,
      {
        x: dx,
        duration: 0.26,
        ease: "power2.inOut",
        onUpdate: paint,
        onComplete: () => {
          // Past this point the command is gone for good, so the copy stops
          // being painted and comes out of the document.
          carrying = false;
          wipe.remove();
        },
      },
      0,
    );
    // Meanwhile the source returns to rest, under the border draw rather than
    // after it. Peripheral: it is the thing being left behind — and it writes
    // the prompt back as it goes, so the bar is ready by the time it lands.
    tl.to(mark, { x: 0, duration: 0.12, ease: "power2.in", onUpdate: paint }, 0.3);
    settle(mark, 0.9, { tl, at: 0.42 });
    handoffParts.push(tl);
  }

  /**
   * A block's arrival. Two shapes, and which one it gets is not cosmetic: a
   * block the user just submitted continues the handoff already in flight, and
   * its travel beat *replaces* the plain entrance rather than playing over it.
   * Output arriving on its own gets the entrance — a handoff per line under
   * `npm install` is the flood-control failure with extra steps.
   */
  function blockEnter(node: HTMLElement) {
    if (!reduceMotion) {
      if (handoffPending && inputBarEl && performance.now() - handoffAt < HANDOFF_STALE_MS) {
        handoffPending = false;
        // The block's clock starts at its own mount, so the beat offset is
        // whatever is left of the mark's head start — not the full beat again,
        // which would drift the two halves apart by however long the mount took.
        const at = Math.max(0, HANDOFF_BEAT - (performance.now() - handoffAt) / 1000);
        // The drawn border is its own layer, not the block's `border`: the draw
        // is a clip opening outward from the vertical centre line, and clipping
        // the block itself would take its content with it. Created here rather
        // than in the template for the same reason the reveal bars are — Svelte
        // re-renders this subtree on every chunk.
        const frame = document.createElement("div");
        frame.className = "block-frame";
        frame.style.setProperty("--gap", "50%");
        node.appendChild(frame);
        // Nothing inside the container exists until the container does. The
        // reveal only hides *text*, so without this a code block's box, its
        // background and its border are on screen before the border that is
        // supposed to be enclosing them. A class rather than a tween on the
        // children, because output keeps arriving during the draw and a child
        // that mounts mid-gesture has to be covered by the same rule.
        node.classList.add("spawning");
        // The border being drawn has to be the only border on screen, and an
        // already-filled box would give the draw nothing to describe.
        gsap.set(node, { borderColor: "transparent", backgroundColor: "transparent" });
        const tl = gsap.timeline({
          onComplete: () => {
            frame.remove();
            node.classList.remove("spawning");
            // The transform is scaffolding. Left behind it makes the block a
            // containing block for anything positioned inside it, and an
            // identity matrix is not free to leave on a scrollback's worth of
            // sections.
            gsap.set(node, { clearProps: "transform,borderColor,backgroundColor" });
            releaseReveal();
          },
        });
        // Beat 2 — the frame opens from the top centre in both directions.
        // Written from a proxy in `onUpdate` rather than tweened as a
        // `clip-path` string: one number drives both the clip and the position
        // of the two glowing tips, so the bright head cannot drift off the edge
        // it is supposed to be the end of.
        const draw = { p: 0 };
        tl.to(
          draw,
          {
            p: 1,
            duration: 0.34,
            // `inOut`, never `out` — the same trap the label bar's sweep
            // documents. An `out` ease is most of the way across before the eye
            // has found it, so the border never reads as being *drawn*: it
            // reads as having already been there. Starting from a standstill is
            // what makes the draw a draw.
            ease: "power2.inOut",
            onUpdate: () => frame.style.setProperty("--gap", `${(1 - draw.p) * 50}%`),
          },
          at,
        );
        // Beat 3 — the box is closed, so it becomes a real surface, its content
        // appears, and the box bounces. All three at the same instant: the
        // content is what the box was drawn for, and staging it after the bounce
        // makes the container arrive twice. The reveal is released here, not on
        // complete, so the typewriter runs *with* the bounce rather than behind
        // it.
        //
        // The bounce is on the *frame*, not the block, and that is what keeps
        // the text still: the frame is an empty overlay, so widening it widens
        // the box the user sees and moves nothing inside it. Scaling the block
        // would take its content with it, and animating the block's padding or
        // margin would push the text sideways — which is exactly what was asked
        // to be excluded. The block's own border therefore stays transparent
        // until the bounce is over: for those frames the frame *is* the border.
        tl.set(node, { clearProps: "backgroundColor" });
        tl.call(() => {
          node.classList.remove("spawning");
          releaseReveal();
        });
        // Derived from a fixed visual distance, never a constant factor: the
        // same `scaleX` is a nudge on a narrow window and a lurch on a wide one.
        const overshoot = 1 + ((BOUNCE_DVW / 100) * window.innerWidth) / node.getBoundingClientRect().width;
        tl.to(
          frame,
          {
            keyframes: [
              { scaleX: overshoot, duration: 0.06, ease: "power2.out" },
              { scaleX: 1, duration: 0.12, ease: "back.out(2)" },
            ],
          },
          "<",
        );
        // The glow has nothing left to draw, so it hands the edge back to the
        // block's own border rather than cutting out — and only once the bounce
        // has landed, or the edge would be handed over mid-stretch.
        tl.set(node, { clearProps: "borderColor" });
        tl.to(frame, { autoAlpha: 0, duration: 0.12, ease: "power2.in" });
        handoffParts.push(tl);
      } else {
        // `clearProps` so the entrance leaves nothing behind: a block is
        // permanent content, and an inline opacity left on it is one stray
        // `kill()` away from being a block nobody can read.
        gsap.from(node, {
          autoAlpha: 0,
          y: 8,
          duration: 0.25,
          ease: "power2.out",
          clearProps: "transform,opacity,visibility",
        });
        // A block that mounted too late to claim the gesture still has to let
        // the hold go, or the handoff's own guard silences the reveal for the
        // rest of the session.
        releaseReveal();
      }
    } else {
      releaseReveal();
    }
    return {
      destroy() {
        gsap.killTweensOf(node);
      },
    };
  }
  // #endregion ────────────────────────────────────────────────────────────────

  // #region Reveal ────────────────────────────────────────────────────────────
  // **One reveal, for everything.** The label bars sweep the coloured tokens in
  // tier order and the character wave rises under the grey prose between them —
  // whether the text arrived finished or is landing chunk by chunk right now.
  //
  // What used to be here was a second animation: a `clip-path` staircase that
  // typed the still-growing element row by row, with the bars and the wave
  // reserved for text that was already final. It was removed rather than
  // retuned. The output of one command looked like two different products
  // depending on where a PTY chunk boundary happened to fall, and the boundary
  // is an artefact of the pipe, not a fact about the text. A reader has no way
  // to know why one line typed itself and the line under it swept in on bars,
  // because there is no why.
  //
  // What replaces the typewriter's honesty about liveness is *when* the reveal
  // plays. An element animates as its content lands, so the output still arrives
  // in the order the program wrote it — the timeline is the shell's. It is the
  // same gesture everywhere; only its moment is live.
  //
  // ── The one thing this costs ────────────────────────────────────────────────
  // The character wave splits real DOM, and Svelte re-renders an output element
  // from the parser on every chunk — the `SplitText` hazard that shaped this
  // whole region. Splitting an element that is about to be re-rendered hands its
  // text nodes to a render that will discard them: the element freezes at what
  // it held when the split ran, or the animation tears halfway through.
  //
  // So **elements inside a block that is still awaiting its command do not get
  // split.** They reveal on the same beat as everything else — bars over their
  // tokens, and the prose rising as one piece instead of character by character,
  // which is the resolution the wave already falls back to for a code block.
  // Nothing is ever held back and nothing is revealed twice.
  //
  // An earlier attempt held only the *last* element of the open block, on the
  // theory that it was the only one that could still change. A pager disproves
  // it: `less` repaints the entire screen on every keypress, so every element in
  // that block is rewritten each time. Holding one of them showed nothing at all
  // when the block had only one, and splitting the rest tore them mid-flight.
  /**
   * The bar's two legs, from `miscLabelReveal.ts` in the portfolio. Retuned to
   * roughly two-thirds of its 0.42s/0.5s, per the same rule the glitch was
   * retuned under: a section entrance there is a destination, a line of output
   * here is on the way to something.
   *
   * The retreat is longer than the sweep, and deliberately so — that asymmetry
   * is what makes the bar read as *uncovering* the text rather than as a
   * highlight passing over it.
   */
  const BAR_SWEEP = 0.28;
  const BAR_RETREAT = 0.32;

  /** Every element under reveal → how many of its rows are already revealed. */
  const revealed = new Map<HTMLElement, number>();
  /** In-flight reveals, so an interrupt can kill them and `clear` can bin them. */
  const revealing = new Map<HTMLElement, gsap.core.Animation>();
  /**
   * Undo for a static reveal: puts the element's own text nodes back, drops the
   * bars, clears every clip it set. Registered per element because a static
   * reveal builds real DOM (the character spans) and every path that ends a
   * reveal early — interrupt, `clear`, resize, unmount — has to take it down.
   * The typewriter has no entry here; it touches nothing.
   */
  const cleanups = new Map<HTMLElement, () => void>();
  let revealFrame = 0;
  /** Frames the pass has spent waiting for the view to stop moving. */
  let revealWaits = 0;
  const REVEAL_WAITS_MAX = 30;
  /**
   * Set while a handoff is still flying a block in. Content revealing inside a
   * container that is itself still moving is unreadable, and it is the most
   * common way this animation gets built wrong.
   */
  let revealHeld = false;

  /**
   * Registers an output element for the reveal, and hides it in the same breath.
   *
   * The hide has to happen here, in the action, because an action runs during
   * Svelte's mount flush — before the browser has painted the node even once.
   * Waiting for the reveal pass a frame later is what made text appear at full
   * strength, vanish, and then type itself in.
   *
   * **`visibility`, not a clip.** Which reveal this element gets cannot be known
   * yet: it depends on whether anything more arrives in it, and at mount nothing
   * has. So the hide here is the one hide both reveals can start from, and the
   * pass a frame later replaces it with the hiding its own animation needs.
   */
  function reveal(node: HTMLElement) {
    revealed.set(node, 0);
    if (!reduceMotion) node.style.visibility = "hidden";
    queueReveal();
    return {
      destroy() {
        revealing.get(node)?.kill();
        revealing.delete(node);
        revealed.delete(node);
        cleanups.delete(node);
      },
    };
  }

  function queueReveal() {
    revealFrame ||= requestAnimationFrame(runReveals);
  }


  /** Clears a label's hide. The reveal sets it; nothing else may leave one on. */
  function unclip(node: HTMLElement) {
    node.style.clipPath = "";
  }

  /**
   * Drops the action's pre-paint hide. Called only once the reveal's own hiding
   * is in place — the per-character `autoAlpha` and the label clips. Called any
   * earlier and the whole element is briefly on screen at full strength, which
   * is the flash the reveal exists to avoid.
   */
  function show(node: HTMLElement) {
    node.style.visibility = "";
  }

  /** Whole element hidden, opening left to right. The bar wipe's resting state. */
  const HIDDEN_CLIP = "inset(0 100% 0 0)";

  /**
   * The bar wipe, ported from the portfolio's `Label-Set.vue`: an accent bar
   * sweeps across the element, then retreats from its right edge while the text
   * opens out behind it — so the text lands exactly where the bar has just been
   * rather than fading in under it.
   *
   * **The bar is never a child of anything Svelte renders into.** It lives in a
   * static overlay built once, and is positioned over the target in the scroll
   * container's own coordinates. Appending it to the target would be the
   * `SplitText` hazard again: output elements are re-rendered from the parser on
   * every chunk, and a framework rewriting its children drops whatever this put
   * there — or worse, keeps it and loses the text node instead.
   *
   * A bar cannot live *inside* the target for a second reason that has nothing
   * to do with Svelte: the reveal clips the target, and a clip applies to the
   * element's own decoration too. The bar has to be outside the thing it is
   * uncovering or it gets uncovered along with it.
   */
  /** Beat between one label tier and the next. */
  const LABEL_STEP = 0.2;
  /** Past this many labels in one tier, it opens without bars. */
  const LABEL_MAX = 24;

  /**
   * The label tiers inside one element, in the order they play — most saturated
   * first. The ranking itself lives in `$lib/reveal-plan.js`, which reads it off
   * the classes the renderer put there, which the parser decided. So the
   * animation is downstream of the parse and knows nothing about markdown.
   *
   * The element itself counts as a candidate: a heading *is* a label, whole.
   */
  function labelsIn(node: HTMLElement) {
    const candidates = [node, ...node.querySelectorAll<HTMLElement>("[class]")];
    return labelGroups(candidates, (el) => el.classList);
  }

  /**
   * The bars for one label: one per line box of its *text*, not one over its
   * box.
   *
   * The box is the wrong rectangle. A heading or a list item is a block, so its
   * border box runs the full width of the container whatever the text in it
   * measures — a bar over that sweeps across empty space the token never
   * occupied. A `Range` over the element's contents measures the ink instead,
   * and `getClientRects` gives one rect per line, so a token that wraps gets a
   * bar per row rather than one bar over the ragged rectangle enclosing them.
   */
  function barsFor(node: HTMLElement) {
    if (!barsEl || !scrollEl) return [];
    const range = document.createRange();
    range.selectNodeContents(node);
    const s = scrollEl.getBoundingClientRect();
    const bars: HTMLElement[] = [];
    for (const r of range.getClientRects()) {
      if (!r.width || !r.height) continue;
      const bar = document.createElement("div");
      bar.className = "reveal-bar";
      // A status is red or green whatever the accent is: the two colours in the
      // app that are not the user's to theme, because they are the colour of the
      // thing being reported and not of the terminal. The bar carries it too —
      // a green `done` swept by a purple bar says two things at once, and only
      // one of them is true. `closest`, so a warning *block* paints every bar
      // inside it, not only the heading that carries the class.
      const status = node.closest(".warn, .err, .ok");
      if (status) bar.classList.add(status.classList.contains("ok") ? "ok" : "warn");
      // Viewport rect → scroll-content coordinates. The overlay is absolutely
      // positioned inside the scrollport, so it scrolls with the content and the
      // bar stays over its element if the view moves mid-wipe.
      bar.style.left = `${r.left - s.left + scrollEl.scrollLeft}px`;
      bar.style.top = `${r.top - s.top + scrollEl.scrollTop}px`;
      bar.style.width = `${r.width}px`;
      bar.style.height = `${r.height}px`;
      barsEl.append(bar);
      bars.push(bar);
    }
    return bars;
  }

  /**
   * One label's sweep-and-retreat, added to `tl` at `at`. This is
   * `buildLabelReveal` from the portfolio, beat for beat.
   *
   * Three things it does that are easy to get wrong, and all three were:
   *
   *  - **`power3.inOut`, not `power3.out`.** An `out` ease is nearly finished by
   *    the time the eye has found it — the bar is already most of its width in
   *    the first few frames, so it never reads as *growing*. The `inOut` starts
   *    from a standstill, which is the whole gesture.
   *  - **The text is `set` visible, not tweened.** It is uncovered by the bar
   *    retreating off it, not by a clip racing the bar. Two eases over the same
   *    edge cannot stay together, and where they part the text either leads the
   *    bar or trails it.
   *  - **The retreat is longer than the sweep.** The asymmetry is what makes
   *    the bar read as uncovering the text rather than passing over it.
   *
   * A bar can be absent — a tier too large to draw one per label. Then there is
   * nothing to uncover the text, so it simply opens on the sweep's own curve.
   */
  function wipeAt(tl: gsap.core.Timeline, el: HTMLElement, bar: HTMLElement[], at: number) {
    if (!bar.length) {
      tl.fromTo(
        el,
        { clipPath: HIDDEN_CLIP },
        { clipPath: "inset(0 0% 0 0)", duration: BAR_SWEEP, ease: "power3.inOut" },
        at,
      );
      return;
    }
    tl.fromTo(
      bar,
      { scaleX: 0, transformOrigin: "left center" },
      { scaleX: 1, duration: BAR_SWEEP, ease: "power3.inOut" },
      at,
    )
      // The text is behind the bar at this instant, so it can be uncovered
      // outright. Flipping the origin at full width is invisible — a scale of 1
      // is the identity whichever corner it is anchored to — and it is what
      // turns the second leg into the bar sliding off to the right rather than
      // collapsing back the way it came.
      .set(el, { clipPath: "inset(0 0% 0 0)" }, at + BAR_SWEEP)
      .set(bar, { transformOrigin: "right center" }, at + BAR_SWEEP)
      .to(bar, { scaleX: 0, duration: BAR_RETREAT, ease: "power3.inOut" }, at + BAR_SWEEP);
  }

  /** Per character of the wave. */
  const WAVE_CHAR = 0.3;
  /** Gap between one character and the next — the wave's speed along the line. */
  const WAVE_STAGGER = 0.012;
  /** Ceiling on the whole wave, however many units it turned out to have. */
  const WAVE_SPAN = 0.6;
  /** How far below its resting place a character starts, in px. */
  const WAVE_RISE = 7;
  /**
   * Where the wave's unit drops from a character to a whole word. A code block
   * is hundreds of characters and it still has to wave — falling straight to a
   * single fade at the cut-off is what left code blocks with no wave at all.
   * The gesture survives the coarser unit; the resolution is all that changes.
   */
  const WAVE_MAX = 400;
  /** Past this, nothing is split and the element rises as one piece. */
  const WAVE_MAX_WORDS = 4000;

  /**
   * Splits the element's own text into per-character spans, leaving every child
   * element (the labels) alone.
   *
   * **The original text nodes are kept, not their markup.** They are detached
   * and handed back on completion — the same objects, so the reference Svelte
   * holds for a future update still points at a node that is in the document.
   * This is what `SplitText` gets wrong: restoring from a saved HTML *string*
   * builds new nodes, and every reference the framework had is left pointing at
   * something that will never be on screen again.
   *
   * **Characters are grouped into words, and that nesting is load-bearing.** A
   * character span has to be `inline-block` for a transform to apply to it at
   * all, and a run of inline-blocks gives the browser a line-break opportunity
   * between every one of them — so a split element wraps mid-word, and snaps
   * back to a different wrap when the text is restored. The word wrapper holds
   * `white-space: pre`, which puts the break opportunities back where the
   * spaces are.
   *
   * Returns null when the element is too big to be worth splitting.
   */
  function splitChars(node: HTMLElement, labels: Set<Element>) {
    // Text can be nested — a list's text is inside its `<li>`s, not in the
    // `<ul>` the reveal is attached to. Every element holding text of its own
    // is a host, and a label is never descended into: it is revealed by its own
    // bar, and spans between that bar and its text would be in the way.
    const hosts: { parent: HTMLElement; original: ChildNode[] }[] = [];
    let count = 0;

    function collect(el: HTMLElement) {
      let text = 0;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += (child.textContent ?? "").length;
        else if (child instanceof HTMLElement && !labels.has(child)) collect(child);
      }
      if (text) {
        hosts.push({ parent: el, original: [...el.childNodes] });
        count += text;
      }
    }
    collect(node);
    if (!count || count > WAVE_MAX_WORDS) return null;
    // One unit per character while that is affordable, one per word past it.
    // The stagger is per unit either way, so a code block's wave crosses it at
    // the same speed a sentence's does — in coarser steps.
    const perChar = count <= WAVE_MAX;

    const chars: HTMLElement[] = [];
    for (const { parent, original } of hosts) {
      const next: ChildNode[] = [];
      for (const child of original) {
        if (child.nodeType !== Node.TEXT_NODE) {
          next.push(child);
          continue;
        }
        // Whitespace runs stay as plain text: they carry no ink, so there is
        // nothing to animate, and leaving them alone is what keeps the line's
        // break opportunities exactly where they already were.
        for (const run of (child.textContent ?? "").split(/(\s+)/)) {
          if (!run) continue;
          if (!run.trim()) {
            next.push(document.createTextNode(run));
            continue;
          }
          const word = document.createElement("span");
          word.className = "wave-word";
          if (perChar) {
            for (const ch of run) {
              const span = document.createElement("span");
              span.className = "wave-char";
              span.textContent = ch;
              word.append(span);
              chars.push(span);
            }
          } else {
            // The word is its own unit. It is already the inline-block the
            // transform needs, so it carries both classes rather than wrapping
            // one more span around itself.
            word.classList.add("wave-char");
            word.textContent = run;
            chars.push(word);
          }
          next.push(word);
        }
      }
      parent.replaceChildren(...next);
    }
    return {
      chars,
      restore: () => {
        for (const { parent, original } of hosts) parent.replaceChildren(...original);
      },
    };
  }

  /**
   * How far below its resting place an element starts under `instant`, as a
   * fraction of the viewport — the settings panel's gesture at the scale of a
   * line of output rather than a panel. A `dv` distance under ANIMATION.md's
   * rule: a constant px rise is a twitch on a tall window and a lurch on a
   * short one.
   */
  const INSTANT_RISE = 0.008;

  /** How long that rise takes. Short: the mode exists to get out of the way. */
  const INSTANT_TIME = 0.22;

  /**
   * The `instant` reveal: the element arrives as one piece, rising a hair and
   * fading up on the panel's own ease.
   *
   * This is not "no animation" — that is what `prefers-reduced-motion` is for,
   * and it is handled before this is ever reached. It is *no typewriter*: no
   * text is written character by character, nothing is clipped between chunks,
   * and an element is on screen in full one frame after it mounts. The whole
   * row-count machinery below has nothing to measure here, which is the point.
   */
  function revealInstant(node: HTMLElement) {
    // Held for the same reason both other reveals are: an element inside a
    // container that is still travelling has no resting place to rise to yet.
    if (revealHeld) return;
    revealed.delete(node);
    // Off screen, so there is nothing to watch — same flood control the static
    // reveal applies, and the same answer.
    if (!inView(node)) {
      show(node);
      return;
    }
    show(node);
    const tween = gsap.from(node, {
      autoAlpha: 0,
      y: INSTANT_RISE * window.innerHeight,
      duration: INSTANT_TIME,
      ease: "power3.out",
      onComplete: () => {
        revealing.delete(node);
        cleanups.delete(node);
        gsap.set(node, { clearProps: "opacity,transform,visibility" });
      },
    });
    // A resize lands every in-flight reveal where it stands; this one has no
    // teardown beyond finishing, so that is what it registers.
    cleanups.set(node, () => {
      revealing.get(node)?.progress(1).kill();
      revealing.delete(node);
      cleanups.delete(node);
      gsap.set(node, { clearProps: "opacity,transform,visibility" });
    });
    revealing.set(node, tween);
  }

  /**
   * A code block's box.
   *
   * The reveal only ever types the text *inside* a code block — its box, border
   * and background are chrome, and clipping them would animate the box in rather
   * than the code. But leaving them alone entirely meant the box appeared at
   * full strength the frame it mounted, ahead of everything around it and ahead
   * of its own contents: the container arriving after the text above it had been
   * written, with no motion of its own, which is what reads as popping in.
   *
   * So the box gets the one gesture that is not a reveal — the same short rise
   * `instant` gives a line of output — and the text then types inside it. The
   * container arrives, then its content, which is the order ANIMATION.md asks
   * for everywhere else.
   */
  function boxIn(node: HTMLElement) {
    // Same flood control as the reveal, and for the same reason: a `git diff`
    // mounts hundreds of these at once and all but a handful of them are
    // nowhere the reader can see.
    if (reduceMotion || !inView(node)) return;
    gsap.from(node, {
      autoAlpha: 0,
      y: INSTANT_RISE * window.innerHeight,
      duration: INSTANT_TIME,
      ease: "power3.out",
      clearProps: "opacity,transform,visibility",
    });
  }

  /**
   * The static reveal: labels sweep in by tier, the prose between them rises
   * character by character.
   *
   * Both start at zero. The element itself is not clipped here — that is the
   * whole reason this can order its tiers freely, where a single wipe over the
   * whole box could not: a clip on a parent hides its children whatever the
   * children are doing.
   */
  function revealStatic(node: HTMLElement, live = false) {
    // Held rather than skipped: the element is still owed its reveal, it just
    // cannot start inside a container that is itself still travelling.
    if (revealHeld) return;
    // Revealed once, whatever happens next. Dropping the entry here is what
    // makes a re-render cheap: the element animates on the chunk it mounted in
    // and later chunks only rewrite its text.
    revealed.delete(node);

    // **Off screen: shown, and nothing else happens.** This test used to sit
    // further down, after the tier walk and after the character split had
    // already run — so an element nobody could see paid for a DOM walk, had its
    // text replaced with hundreds of spans, and had them put back. A long `git
    // diff` is mostly off-screen elements, and that was the whole of its cost.
    // Preparing a reveal is not free, so the question has to be asked before any
    // of the preparation, not after it.
    if (!inView(node)) {
      show(node);
      return;
    }

    const tiers = labelsIn(node);
    const base = revealRank(node.classList) * LABEL_STEP;
    const clipped = tiers.flat();
    const labels = new Set<Element>(clipped);
    // The element being a label itself — a heading is one, whole — means there
    // is no prose left over to wave: it is all bar.
    //
    // **`live` is the DOM-safety switch, and it is not a style choice.** The
    // wave replaces the element's text nodes with per-character spans, and
    // Svelte re-renders an output element from the parser on every chunk of the
    // command that is still running. Splitting one of those hands its text to a
    // render that is about to throw it away — the element freezes at whatever it
    // held when the split ran, or the animation tears mid-flight. A pager makes
    // this constant rather than occasional: `less` repaints the *whole* block on
    // every keypress, so every element in it is changing, not just the last.
    // Live elements therefore rise as one piece and never get split. The bars
    // are safe either way — they are overlay divs, and the only thing they write
    // into the element is a `clipPath` that a re-render simply drops.
    //
    const split = live || labels.has(node) ? null : splitChars(node, labels);
    const bars: HTMLElement[] = [];

    function done() {
      revealing.delete(node);
      cleanups.delete(node);
      for (const bar of bars) bar.remove();
      for (const el of clipped) unclip(el);
      split?.restore();
      show(node);
      // `clearProps` on the spans is pointless — they are about to be thrown
      // away — but the element itself may have been faded as one unit.
      gsap.set(node, { clearProps: "opacity,transform" });
    }

    cleanups.set(node, () => {
      revealing.get(node)?.progress(1).kill();
      done();
    });

    // The clips are written before the element is shown, or a label is briefly
    // at full strength.
    for (const el of clipped) el.style.clipPath = HIDDEN_CLIP;

    if (split) gsap.set(split.chars, { autoAlpha: 0, y: WAVE_RISE });
    // Hidden since the action; from here the reveal's own hiding is in place
    // and the element can be shown without anything flashing.
    show(node);

    const tl = gsap.timeline({ onComplete: done });

    // The prose waits for every label. The tiers are a ranking of how much a run
    // of text means, and grey prose is the bottom of it — it is the material the
    // tokens sit in, so it arrives after them rather than alongside the first
    // tier. One beat past the last tier's start, which is inside that tier's own
    // retreat: the wave begins as the last bar is clearing its text, not after a
    // gap.
    //
    // `base` is the element's own place in the same ranking — a list row, then
    // prose, then a code block last of all — and it offsets the *whole* reveal,
    // labels included, so a block's flags and paths still sweep in tier order
    // inside its late slot rather than being flattened into it.
    const waveAt = base + tiers.length * LABEL_STEP;

    if (split) {
      tl.to(
        split.chars,
        {
          autoAlpha: 1,
          y: 0,
          duration: WAVE_CHAR,
          ease: "power2.out",
          // `amount`, not `each`: the wave's length is capped rather than being
          // the unit count times a constant. A code block is hundreds of units,
          // and at a flat 0.012s each the last one lands seconds after the first
          // — long past the point where anyone is still watching a wave.
          stagger: { amount: Math.min(split.chars.length * WAVE_STAGGER, WAVE_SPAN) },
        },
        waveAt,
      );
    } else if (!clipped.includes(node)) {
      // Not split — either still live, or too long to be worth it, and not a
      // label. It rises as one piece: the same gesture at the coarsest possible
      // resolution, which is what the wave already degrades to for a code block.
      tl.from(
        node,
        { autoAlpha: 0, y: WAVE_RISE, duration: WAVE_CHAR, ease: "power2.out" },
        waveAt,
      );
    }

    function bar(el: HTMLElement) {
      const made = barsFor(el);
      bars.push(...made);
      return made;
    }

    let at = base;
    for (const tier of tiers) {
      // ponytail: past this many labels the tier opens without bars. Fifty flags
      // in a `--help` dump is fifty absolutely positioned divs for half a
      // second, and at that density they read as one texture anyway — there is
      // no legibility left to buy.
      const drawBars = tier.length <= LABEL_MAX;
      for (const el of tier) wipeAt(tl, el, drawBars ? bar(el) : [], at);
      at += LABEL_STEP;
    }
    revealing.set(node, tl);
  }

  /**
   * A resize reflowed the text, so every tracked element has a new row count
   * for the same content — and rows that only exist because the window got
   * narrower have already been read. Without this, dragging the window edge
   * replays the reveal over output that has been on screen for minutes.
   */
  function settleReveals() {
    // A static reveal's own teardown restores its text and drops its bars — all
    // of it measured against a layout that no longer exists.
    landStatics();
    for (const [node, tween] of [...revealing]) {
      tween.progress(1).kill();
      unclip(node);
    }
    revealing.clear();
    dropBars();
    // Everything still registered is owed a reveal it has not started. A reflow
    // changes what those elements say nothing about, so they stay hidden and
    // stay queued; the next pass reveals them against the layout that exists.
    queueReveal();
  }

  /**
   * Lands every static reveal where it stands: text restored, bars gone, clips
   * cleared, element visible. A killed timeline's `onComplete` is owed to
   * nobody, so the teardown is held separately and called directly.
   */
  function landStatics() {
    for (const undo of [...cleanups.values()]) undo();
    cleanups.clear();
  }

  /**
   * The bars are pooled nowhere and owned by nothing — they are torn down
   * wholesale, because every path that ends a reveal ends all of them.
   */
  function dropBars() {
    barsEl?.replaceChildren();
  }

  /** Ctrl+C, `clear`, unmount. Every in-flight reveal lands and is dropped. */
  function killReveals() {
    landStatics();
    for (const [node, tween] of [...revealing]) {
      tween.progress(1).kill();
      unclip(node);
    }
    revealing.clear();
    dropBars();
    for (const node of revealed.keys()) {
      unclip(node);
      // Registered but never reached its pass: hidden by the action and owed a
      // reveal that is not coming.
      show(node);
    }
    revealed.clear();
    cancelAnimationFrame(revealFrame);
    revealFrame = 0;
    revealWaits = 0;
  }

  /**
   * Whether the view is still on its way somewhere.
   *
   * Every measurement in this region is a rect against the scrollport, so all of
   * them are wrong while the view is travelling: an element judged off-screen
   * gets shown outright, and the row clamp animates the wrong rows. That is what
   * "move down" was doing — the mode whose entire job is to move the view.
   *
   * **A tween in flight is not the whole question, and checking only that misses
   * the common case.** The reveal pass runs from `requestAnimationFrame`, and
   * the scroll is started from a `ResizeObserver`, whose callbacks are delivered
   * *after* rAF in the same frame. So on the frame a chunk lands, the pass runs
   * before the scroll it is supposed to wait for even exists. The second test
   * below is what covers that: in "move down" the tail is where the view is
   * headed, so any gap between the tail and the bottom edge means a move is
   * owed, whether or not anything is tweening yet.
   */
  function viewSettling() {
    if (!scrollEl) return false;
    if (scrollTween?.isActive()) return true;
    // Detached means the reader scrolled away and nothing is going to yank them
    // back, so the view is exactly where it is going to be.
    if (scrollMode !== "bottom" || tailDetached) return false;
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight > 1;
  }

  /**
   * Whether any part of `node` is on screen. The static reveal's own flood
   * control: it reveals the element as one unit, so it has no rows to clamp and
   * only needs the yes/no the row clamp derives from.
   */
  /**
   * The scrollport's rect for the duration of one pass. Read once rather than
   * per element: a pass over a long block asks this question hundreds of times,
   * and the answer cannot change while it is running.
   */
  let passView: DOMRect | undefined;

  function inView(node: HTMLElement) {
    if (!scrollEl) return false;
    const view = passView ?? scrollEl.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return rect.bottom > view.top && rect.top < view.bottom;
  }

  /**
   * The block that is still awaiting a response, if there is one — the only
   * block anything can still be appended to, and so the only one with a growing
   * edge to hold back.
   *
   * Asked here rather than at mount, because at mount nothing has arrived and
   * nothing is knowable.
   */
  function awaitingBlock(last: Element | null | undefined) {
    return last?.classList.contains("open") ? last : null;
  }

  function runReveals() {
    revealFrame = 0;
    if (reduceMotion) return;
    // Nothing is measured against a moving viewport. Re-queued rather than
    // hooked to the scroll tween's `onComplete`: a tween killed by the next one
    // never fires it, and a scroll that is owed but not yet started has no tween
    // to hook. Polling a frame at a time asks the same question the pass itself
    // asks, which cannot go stale.
    //
    // ponytail: capped, so a view that never settles cannot silently turn every
    // animation in the app off. Half a second of holding, then reveal against
    // whatever the rects say — by then the backlog is usually past the flood
    // threshold anyway, which reveals instantly and wants no measurement.
    if (viewSettling() && revealWaits < REVEAL_WAITS_MAX) {
      revealWaits++;
      queueReveal();
      return;
    }
    revealWaits = 0;
    // Only the last block can still be growing, so everything above it is
    // final and can stop being tracked — otherwise this map is one entry per
    // rendered node for the life of the session.
    const last = scrollEl?.querySelector("section:last-of-type");
    const open = awaitingBlock(last);
    // Which elements of an open block are unsafe to character-split, and it is
    // not all of them — treating it as all of them is what took the wave off
    // every code block in a running command.
    //
    // Two are unsafe, for two different reasons:
    //
    //  - **The last element**, because output is appended to it. Everything
    //    above it in the same block has been passed by the parser and only gets
    //    rewritten if the text itself changes, which for append-only output it
    //    does not.
    //  - **Every element of a block that has been seen to shrink.** A block only
    //    gets shorter when a program is redrawing its own screen, and a redraw
    //    rewrites all of it — `less` repaints on every keypress. Once a block
    //    has done that it is assumed to keep doing it, because it will.
    //
    // **And the tail is only held while its line is unfinished.** Appending is
    // the hazard, not being last, and a row that arrived with its newline is
    // not going to be appended to. Holding every tail is what left `ping` with
    // no wave on any row: each row is the tail at the instant it lands, so the
    // only one that ever waved was the last, revealed after the block had
    // closed and released them all. `tailComplete` is read off the same buffer
    // pass the text came from.
    const repainting = open?.hasAttribute("data-repaint") ?? false;
    const edge = open && !repainting && !tailComplete ? growingEdge(open) : null;
    passView = scrollEl?.getBoundingClientRect();
    try {
      for (const node of [...revealed.keys()]) {
        if (revealing.has(node)) continue;
        if (revealMode === "instant") {
          revealInstant(node);
          continue;
        }
        const unsafe = !!open?.contains(node) && (repainting || node === edge);
        revealStatic(node, unsafe);
      }
    } finally {
      passView = undefined;
    }
  }

  /**
   * The last tracked element of an open block in document order — the one
   * output is still being appended to.
   *
   * The command line is excluded: it is written once and never appended to, and
   * it is the *first* element in the block, so a command that has not produced
   * output yet would otherwise nominate it and lose its wave for no reason.
   *
   * Document position rather than insertion order, since the map is keyed by
   * mount and a re-render can register a node out of the order it appears in.
   */
  function growingEdge(open: Element) {
    let edge: HTMLElement | null = null;
    for (const node of revealed.keys()) {
      if (!open.contains(node) || node.classList.contains("head-text")) continue;
      if (!edge || edge.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        edge = node;
      }
    }
    return edge;
  }

  // #endregion ────────────────────────────────────────────────────────────────

  /**
   * The indeterminate bar shown at the foot of a block for as long as its
   * command runs.
   *
   * Ambient tier: it says "still working", it is not asking to be looked at, so
   * it is slow and low-contrast and never competes with output arriving beside
   * it. It also does not appear at all for the first third of a second — most
   * commands are finished by then, and a bar that flashes on every fast command
   * is worse than no bar.
   *
   * Loops forever by construction, so the kill path is not optional: the
   * element unmounts the moment output lands or the command exits, and
   * `destroy` is what stops the timeline. See ANIMATION.md's cleanup rule.
   */
  function runBar(node: HTMLElement) {
    if (reduceMotion) return;
    const head = document.createElement("span");
    head.className = "run-bar-head";
    node.append(head);
    const tl = gsap
      .timeline({ delay: 0.35 })
      .from(node, { autoAlpha: 0, duration: 0.25, ease: "power2.out" })
      // Travels the track and back rather than wrapping around: a bar that
      // teleports to the start reads as a stutter at this speed.
      .fromTo(
        head,
        { xPercent: 0 },
        { xPercent: 300, duration: 0.9, ease: "power1.inOut", repeat: -1, yoyo: true },
        0,
      );
    return {
      destroy() {
        tl.kill();
        head.remove();
      },
    };
  }

  /** Drawn, never widened — `scaleX` from the left, per ANIMATION.md. */
  function drawDivider(node: HTMLElement) {
    if (!reduceMotion) {
      gsap.from(node, {
        scaleX: 0,
        duration: 0.25,
        ease: "power2.inOut",
        transformOrigin: "left center",
        clearProps: "transform",
      });
    }
    return {
      destroy() {
        gsap.killTweensOf(node);
      },
    };
  }

  /**
   * How far the block leans toward the pointer when its text is copied, in
   * `dvw`. A fixed visual distance, not a fraction of the block: a block is
   * anything from two rows to a screenful, and a percentage of the element is a
   * percentage of a thing whose size this code does not control.
   */
  const COPY_PULL_DVW = 1.2;

  /** The copy gesture in flight, so an interrupt can kill it. */
  let copyPull: gsap.core.Timeline | undefined;

  /**
   * The block leans toward the cursor and shrinks as its text leaves for the
   * clipboard, then settles back.
   *
   * Same feel as the magnetic buttons in the portfolio, and the same reason it
   * works: the element acknowledges the pointer rather than a notification
   * appearing somewhere else to say it happened. The toast still fires, but it
   * is no longer the only thing that says the click landed.
   *
   * Focal, and the only focal thing in a copy — nothing else moves. The return
   * leg is the **discrete settle**, not an elastic one: the block has handed
   * its text over and is going back to rest, and per ANIMATION.md the spring
   * belongs to the element *gaining* focus. A smooth bounce here would read as
   * "still happening" after the copy was already done.
   */
  function pullToCursor(node: HTMLElement, e: MouseEvent) {
    if (reduceMotion) return;
    copyPull?.kill();
    const rect = node.getBoundingClientRect();
    // Direction only: the amplitude is the constant above, so a click at the
    // block's edge and one at its centre travel the same distance.
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const travel = (COPY_PULL_DVW / 100) * window.innerWidth;
    copyPull = gsap.timeline({
      // The transform is spent — leaving it behind would stale the rect the
      // hover ring is positioned against and keep a compositor layer alive.
      onComplete: () => {
        gsap.set(node, { clearProps: "transform" });
        hotRect = undefined;
        copyPull = undefined;
      },
    });
    copyPull.to(node, {
      x: (dx / distance) * travel,
      y: (dy / distance) * travel,
      scale: 0.97,
      duration: 0.12,
      // Accelerates away from rest: this leg is the block being taken, not
      // arriving anywhere.
      ease: "power2.in",
      // Never `true` — that kills every tween on the block, including an
      // entrance still running, which is how a block ends up stranded.
      overwrite: "auto",
    });
    copyPull.to(node, { x: 0, y: 0, duration: 0.16, ease: "power2.out" });
    settle(node, 0.97, { tl: copyPull, at: 0.12 });
  }

  // The copy itself, without the gesture: the pointer and the keyboard reach
  // this by different routes and acknowledge themselves differently, but what
  // lands on the clipboard is one decision in one place.
  //
  // The markdown form is reconstructed by the same parser that drives the
  // on-screen rendering — one source of truth for "what is a heading".
  //
  // A block being shown raw copies raw. Copying the rendering out of a block
  // that is on screen *as bytes* would be answering a different question than
  // the one the screen is currently asking — and the raw copy is what a bug
  // report needs. The full set of copy modes is phase-13's; this is the one
  // that has to exist the moment the toggle does.
  function copyText(block: Block, asMarkdown: boolean) {
    if (block.raw && !asMarkdown) {
      navigator.clipboard.writeText(rawText(block));
      return notify("Copied raw bytes");
    }
    const text = asMarkdown ? toMarkdown(blockNodes(block)) : block.buffer;
    navigator.clipboard.writeText(text);
    notify(asMarkdown ? "Copied as markdown" : "Copied output");
  }

  // Right-click copies a block's output. Shift+right-click copies it as
  // markdown. The pointer's copy also focuses the block: a block the user just
  // acted on is the block the next key should act on, and a second notion of
  // "the one I mean" is what phase-7-navigation.md exists to prevent.
  function copyBlock(e: MouseEvent, block: Block) {
    e.preventDefault();
    focusedId = block.id;
    pullToCursor(e.currentTarget as HTMLElement, e);
    copyText(block, e.shiftKey);
  }

  // #region Drag and drop ────────────────────────────────────────────────────
  // **Tauri's native drag-drop, never the HTML5 `drop` event.** That choice is
  // the whole fix, not an implementation preference.
  //
  // On Arch (and GTK generally) HTML5 file drops into a webview are the
  // unreliable path: webkit2gtk only surfaces a `File` for a drag whose source
  // offered `text/uri-list` in a form it recognises, and a great many editors
  // and file managers offer their own private target first. That is exactly the
  // "works in some apps, not others, sometimes" shape of the bug. Tauri does not
  // go through the webview's DOM at all — it registers a GTK drag destination on
  // the window itself (and the equivalent OLE drop target on Windows) and hands
  // the resolved paths over as an event. One code path, both platforms, and it
  // sees drags the DOM never gets told about.
  //
  // The webview's own handling has to stay off for this, which is Tauri's
  // default (`dragDropEnabled`); turning it on to get HTML5 drops back would
  // take these events away.

  /** True while a drag is over the window — the input bar lights up for it. */
  let dragOver = $state(false);

  /**
   * A drop is still an argument — nothing runs on its own. One file opens the
   * suggestion strip, which offers the ways that file is usually run alongside
   * the bare path; the user picks, and the line is theirs to submit. Several
   * files have no single sentence to offer, so they go in as arguments the way
   * they always did.
   */
  function dropPaths(paths: string[]) {
    if (!paths.length) return;
    refocus();
    if (paths.length === 1) {
      // Summoned, not typed: these are "how do you want to run this", so the
      // strip owns Enter for as long as they are up.
      menuAuto = false;
      openMenu(runOptions(paths[0], shellIsWindows()), cursorCol);
      return;
    }
    // Trailing space so the next drop, or the next word, does not run into it.
    invoke("pty_write", { data: paths.map((path) => quotePath(path)).join(" ") + " " });
  }

  function watchDrops() {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      dragOver = p.type === "over" || p.type === "enter";
      if (p.type === "drop") dropPaths(p.paths);
    });
    // The listener outlives an await, so a component torn down mid-registration
    // still detaches it.
    return () => unlisten.then((off) => off());
  }
  // #endregion ────────────────────────────────────────────────────────────────

  // #region Suggestion strip ─────────────────────────────────────────────────
  // A module fused to the top edge of the input bar — 60% of its width, a tenth
  // shorter, sharing that edge rather than floating above it. It is the input
  // bar wearing an extra row, not a popup, and it is deliberately **one line of
  // ghost text**: the selected option, cycled with the arrows. A scrolling list
  // would be a second surface to read; one line is the same information the eye
  // is already pointed at.
  //
  // Two sources, one strip, because they are the same computation: a dropped
  // file and a pressed Tab both end as *a list of texts, one of which gets
  // spliced into the shell's line editor*. The strip knows which is which only
  // through `menuStart` — the column the accepted text replaces from.
  //
  // Nothing here executes anything. Accepting writes the line at the prompt and
  // stops; Enter is still the user's to press. Same rule the drop already had.

  /** `start` is the column this item replaces from; absent means the strip's own. */
  type Suggestion = { text: string; hint: string; start?: number };

  let menuItems = $state<Suggestion[]>([]);
  let menuIndex = $state(0);
  let menuOpen = $state(false);
  let menuEl = $state<HTMLElement | undefined>();
  /** Column the accepted text replaces from — the start of the token under the cursor. */
  let menuStart = 0;
  /**
   * Whether the strip put itself up from what is being typed, rather than being
   * summoned by a drop or by Tab.
   *
   * One thing turns on it: an auto strip **never takes Enter**. It is up almost
   * all the time now, and a strip that is always up and owns Enter is a strip
   * that has quietly taken over submitting commands. Tab and → accept; Enter
   * runs the line, always.
   */
  let menuAuto = $state(false);

  /** How far the strip travels on enter and leave, as a fraction of the viewport. */
  const MENU_RISE = 0.02;

  /**
   * Which quoting rules the shell on the other end wants, read off the cwd it
   * reported. ponytail: the same guess `quotePath` makes, for the same reason —
   * the PTY does not report what it spawned. Phase 12's shell registry knows.
   */
  function shellIsWindows() {
    // Before the first OSC 7 there is no cwd to read, and a drop that early
    // would get POSIX escaping applied to a `C:\` path — which mangles it. The
    // host OS is the right guess for exactly that window.
    if (!promptCwd) return navigator.userAgent.includes("Windows");
    return /^[A-Za-z]:[\\/]/.test(promptCwd);
  }

  function openMenu(items: Suggestion[], start: number) {
    if (!items.length) {
      closeMenu();
      return;
    }
    // Re-entry during an exit: the node is still mounted and mid-fade, so it
    // has to be reset rather than left to inherit a half-faded state.
    if (menuEl) {
      gsap.killTweensOf(menuEl);
      gsap.set(menuEl, { autoAlpha: 1, y: 0 });
    }
    menuItems = items;
    menuStart = start;
    menuIndex = 0;
    menuOpen = true;
  }

  /**
   * The exit tween owns the unmount — clearing `menuOpen` from the caller would
   * animate a node Svelte has already torn out. It leaves *downward*, back into
   * the bar it is an extension of: unlike the settings panel, this one does have
   * an edge it belongs to.
   */
  function closeMenu() {
    if (!menuOpen) return;
    if (!menuEl || reduceMotion) {
      menuOpen = false;
      return;
    }
    gsap.killTweensOf(menuEl);
    gsap.to(menuEl, {
      autoAlpha: 0,
      y: MENU_RISE * window.innerHeight,
      duration: 0.16,
      ease: "power2.in",
      onComplete: () => (menuOpen = false),
    });
  }

  function menuIn(node: HTMLElement) {
    if (reduceMotion) {
      gsap.from(node, { autoAlpha: 0, duration: 0.1 });
    } else {
      // Chrome entrance, at the strip's scale: it rises out of the bar and the
      // opacity steps up on its own ease, the same pair the settings panel uses.
      // Shorter, because a strip appearing under the cursor is not a destination.
      gsap.from(node, { y: MENU_RISE * window.innerHeight, duration: 0.24, ease: GLITCH_IN });
      gsap.from(node, { autoAlpha: 0, duration: 0.2, ease: "steps(3)" });
    }
    return {
      destroy() {
        gsap.killTweensOf(node);
      },
    };
  }

  function moveMenu(delta: 1 | -1) {
    const next = step(menuIndex, delta, menuItems.length);
    if (next === menuIndex) return;
    menuIndex = next;
    const text = menuEl?.querySelector(".suggest-text");
    if (!text || reduceMotion) return;
    // Peripheral tier: the strip is not the subject, the line being built is.
    // No overshoot, and the new option enters from the side it came from.
    gsap.killTweensOf(text);
    gsap.from(text, { y: delta * 8, duration: 0.16, ease: "power2.out" });
  }

  /**
   * Splice the selected option into the shell's line editor.
   *
   * The shell has been receiving these keystrokes all along, so whatever is
   * being replaced already sits in its buffer and cannot be unsent — it is
   * erased a character at a time, the same mechanism `LOCAL_COMMANDS` uses.
   */
  function acceptMenu() {
    const item = menuItems[menuIndex];
    closeMenu();
    if (!item) return;
    // Per item, not per strip: a history match replaces the whole line while a
    // path match replaces one word, and they can be in the same list.
    //
    // Erasing back to the start and rewriting is also what makes the *case*
    // right. Appending only the missing characters left `cla` + `UDE.md` on
    // screen and, worse, sent that to the shell — a filename that does not
    // exist on a case-sensitive filesystem. The name on disk replaces the name
    // as typed.
    const back = Math.max(0, cursorCol - (item.start ?? menuStart));
    invoke("pty_write", { data: "\x7f".repeat(back) + item.text });
    refocus();
  }

  /**
   * Tab: everything in this directory the half-typed word could still become.
   *
   * ponytail: this takes Tab away from the shell's own completer, which knows
   * about commands, parameters and its own history and this does not. The trade
   * is deliberate — the shell's completion happens inside a line editor the
   * block renderer cannot see, so it was invisible here anyway. Hand Tab back
   * the day the input bar can render what PSReadLine predicts.
   */
  async function openCompletions() {
    const { token, start } = tokenAt(input, cursorCol);
    const { dir, base } = completionRequest(token);
    const path = resolveDir(promptCwd, dir);
    const entries = await invoke<{ name: string; dir: boolean }[]>("list_dir", { path }).catch(
      () => [] as { name: string; dir: boolean }[],
    );
    // The listing is a round trip; the prompt may have moved on inside it.
    if (!atPrompt) return;
    menuAuto = false;
    openMenu(completions(entries, base, dir, shellIsWindows()), start);
  }

  /**
   * Keys the strip owns. Tab always, since Tab is how a match is taken.
   *
   * Enter only when the strip was summoned deliberately. A strip that puts
   * itself up as you type is up for most of every line, and one that owned
   * Enter would have taken over running commands.
   */
  function menuOwns(key: string) {
    // Tab is not here: it is taken on the window, in the capture phase, so that
    // it cannot move focus into the output no matter what currently has it.
    if (!menuOpen) return false;
    if (key === "Enter") return !menuAuto;
    return key === "ArrowUp" || key === "ArrowDown";
  }
  // #endregion ────────────────────────────────────────────────────────────────

  onMount(() => {
    // The config is a round trip, so the first frame is always the defaults and
    // the restored values land a frame or two later. That is only visible as an
    // accent flicker on a non-default accent, and the alternative — holding the
    // whole terminal back on a file read — costs every launch to save one.
    invoke<Config>("config_load").then(applyConfig).catch(() => {});
    // The file half of the two-way sync. External edits arrive here; the app's
    // own writes never do, filtered in `config.rs` by comparing content.
    const unlistenConfig = listen<Config>("config-changed", (e) => applyConfig(e.payload));

    document.documentElement.style.setProperty("--accent", ACCENTS[accent].value);

    // Local alias keeps the non-undefined narrowing inside the callbacks below;
    // `term` stays module-scoped for refocus()/openBlock()/snapshot().
    const t = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 14,
      // Block text is read back from this buffer, so scrollback is the real
      // cap on how much of a long command's output survives.
      //
      // 10k rows is the figure docs/PERFORMANCE.md mandates, and this was at
      // twice it. A block older than the cap has already been snapshotted and
      // closed, so what it loses is the ability to be re-read — `snapshot`
      // already bails on a marker the buffer has trimmed out from under it.
      //
      // ponytail: this caps xterm's cell memory, not the block DOM, which is
      // still unbounded. Virtualisation is deliberately not written yet:
      // PERFORMANCE.md says to measure `content-visibility` alone at 100k lines
      // before adding a windowing layer, and that measurement has not happened.
      scrollback: 10000,
      theme: xtermTheme(),
    });
    term = t;
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(xtermHost);
    fit.fit();
    // xterm is the input engine even while visually hidden in block mode —
    // pointer-events:none means the user can never click it to focus, so it
    // must be focused programmatically or nothing they type goes anywhere.
    t.focus();

    // F2 is intercepted here rather than on window: xterm's own keydown
    // listener sits on its textarea and fires before anything bubbling up,
    // so a window handler would still let F2 through to the shell.
    // Returning false is xterm's documented "I handled this, you don't".
    t.attachCustomKeyEventHandler((e) => {
      // A selected line, and a key that would edit it. The selection is ours,
      // so the shell has no idea the line is selected and would treat every one
      // of these as an ordinary edit at the caret — which is exactly what "I
      // selected everything and pressed Backspace and one character went away"
      // was. Replayed as the keys that produce the edit instead; see
      // `eraseSelection`.
      if (mode !== "raw" && selectAll && e.type === "keydown") {
        const typed = e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
        if (e.key === "Backspace" || e.key === "Delete" || typed) {
          e.preventDefault();
          eraseSelection(typed ? e.key : "");
          return false;
        }
        // Anything else — an arrow, Enter, Home — is a move, and a move is what
        // ends a selection everywhere else. The key itself is the shell's.
        if (!/^(Shift|Control|Alt|Meta)$/.test(e.key)) selectAll = false;
      }
      // The suggestion strip owns these keys before the shell sees them. It has
      // to be here rather than on the window: xterm turns a keydown into bytes
      // on the wire from its own listener, so a handler that only stops the
      // event from bubbling still lets Tab complete and Enter submit behind the
      // strip. Returning false is xterm's "I handled this".
      if (mode !== "raw" && atPrompt && menuOwns(e.key)) {
        e.preventDefault();
        if (e.type === "keydown") {
          if (e.key === "Enter") acceptMenu();
          else moveMenu(e.key === "ArrowDown" ? 1 : -1);
        }
        return false;
      }
      // Any other key moves the line on, and the options were computed against
      // a token that no longer exists. Esc is excluded because the window's
      // capture handler has already closed the strip by the time this runs.
      if (menuOpen && e.type === "keydown" && e.key !== "Escape") closeMenu();

      // **Esc is not swallowed here any more, and that is the point.** It
      // belongs to the shell — PSReadLine clears the line with it, and in raw
      // mode it is how vim leaves insert mode. The panel moved to Shift+Esc,
      // and everything bare Esc still does (drop a selection, close the strip,
      // deselect a block, close the panel) is taken on the window in the
      // capture phase, which stops the event before it can reach this handler
      // at all. So an Esc that arrives here is one nothing above wanted.

      // Block navigation and the keyboard copy. Both are chords rather than
      // bare keys, and deliberately: a bare Up/Down is the shell's history and
      // the suggestion strip's selection, and a terminal that takes either has
      // broken something everybody already knows how to use. Ctrl+Shift+C is
      // the copy chord every terminal already uses, for the same reason.
      //
      // Raw mode is exempt throughout — a full-screen app owns its keyboard.
      if (mode !== "raw" && e.ctrlKey && !e.altKey) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          if (e.type === "keydown") moveFocus(e.key === "ArrowDown" ? 1 : -1);
          return false;
        }
        // The cwd panel. Ctrl+B costs readline's backward-char, which is the
        // left arrow with extra steps and the cheapest binding in the set to
        // lose; raw mode keeps it, so tmux's prefix is untouched. Recorded in
        // tasks.md alongside the Esc/clear-line trade rather than assumed.
        if (!e.shiftKey && /^[bB]$/.test(e.key)) {
          e.preventDefault();
          if (e.type === "keydown") togglePanel();
          return false;
        }
        // Two chords rather than one plus a modifier: the pointer's
        // shift+right-click has a base gesture to modify, and a chord does not.
        // `stopPropagation` as well, for the same reason F3 needs it: the
        // webview binds Ctrl+Shift+C itself and returning false only stops xterm.
        const copy = e.shiftKey && /^[cCmM]$/.test(e.key);
        if (copy) {
          e.preventDefault();
          e.stopPropagation();
          if (e.type === "keydown") copyFocused(e.key === "m" || e.key === "M");
          return false;
        }
        // The raw toggle. Taken outright for the same reason as the copies —
        // and more so here, because the webview binds Ctrl+Shift+R to a reload,
        // which would throw the session away rather than merely doing nothing.
        if (e.shiftKey && /^[rR]$/.test(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.type === "keydown") toggleRaw();
          return false;
        }
      }
      // Accept the ghost completion. → is free for this: with the caret at the
      // end of the line a right arrow moves nowhere, so nothing is taken from
      // the shell that it was doing anything with. The text is *sent to the
      // shell* rather than written into the mirror — the shell owns the line,
      // and the mirror is a reading of its screen. Typing it is what makes the
      // completion a real edit the user can then backspace through.
      if (mode !== "raw" && atPrompt && ghost && e.key === "ArrowRight" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (e.type === "keydown") acceptMenu();
        return false;
      }

      if (e.type === "keydown" && atPrompt && mode !== "raw") {
        if (e.key === "Backspace" && cursorCol === 0) nudgeCaret(-1);
        if (e.key === "Delete" && cursorCol >= input.length) nudgeCaret(1);
      }
      if (e.key !== "F2" && e.key !== "F3") return true;
      // Returning false stops *xterm* handling the key; it does not stop the
      // webview's own default. WebView2 binds F3 to find-next, which swallowed
      // the debug toggle entirely — the handler ran and the overlay still never
      // appeared. These keys belong to the app, so take them outright.
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "keydown") {
        if (e.key === "F2") {
          invoke<string>("screenshot")
            .then((name) => notify(`Saved demo/${name}`))
            .catch((err) => notify(`Screenshot failed: ${err}`));
        } else {
          debugOn = !debugOn;
          if (!debugOn) debugLog = [];
        }
      }
      return false;
    });

    // Shell-integration markers are parsed here, not in Rust. An OSC handler
    // runs mid-parse, so the cursor is exactly where the marker sat in the
    // stream — which is the whole point: a marker delivered out-of-band could
    // arrive before the output chunk it describes, and that output would then
    // be filed under the wrong command (or dropped as prompt noise).
    // Returning true consumes the sequence so it never reaches the screen.
    t.parser.registerOscHandler(133, (data) => {
      const b = t.buffer.active;
      debugPush(`133;${data}  y=${b.baseY + b.cursorY} x=${b.cursorX} blk=${currentBlock()?.id}`);
      if (data === "A") {
        atPrompt = true;
        betweenCommands = false;
        promptReady = false;
        input = "";
        shellSelFrom = 0;
        shellSelTo = 0;
        selectAll = false;
        pendingCommand = "";
        // The command that just finished is exactly the thing that creates and
        // deletes files, so a listing taken before it is not evidence about the
        // directory now.
        dirCache.clear();
        dirVersion++;
      } else if (data === "B") {
        promptReady = true;
        booted = true;
      } else if (data.startsWith("D")) {
        // Final snapshot must happen *here*, not in the write callback: the
        // same chunk usually carries the next prompt, and by the time that
        // callback runs the cursor has already moved onto the prompt row.
        const block = currentBlock();
        if (block && !block.closed) {
          // Re-read from the marker, not from where the last pass stopped. The
          // incremental read assumes a row behind the tail never changes again,
          // and a program with a progress line breaks exactly that: `npm ls`
          // draws a spinner, that row is committed as `\`, and then the line is
          // erased and rewritten with the real output — which the incremental
          // read never goes back for, so the block kept the spinner frame and
          // nothing else. One full pass at the end costs a single walk of the
          // block's rows, once per command, and makes the committed text right
          // whatever was drawn over it.
          snapshot(block, true);
          // The command is over, so there is provably nothing more to wait for.
          showNow(block);
        }
        closeBlock(Number(data.split(";")[1] ?? -1));
        betweenCommands = true;
        // A command that finishes inside one chunk writes its whole output
        // here, and the write callback's own sync runs before this handler has
        // added it. Without this the last block of a fast command never
        // reveals — which is most commands.
        queueReveal();
      }
      return true;
    });

    // OSC 7 reports the cwd as file://HOST/path — drop scheme and host, keep
    // the path, and undo percent-encoding.
    t.parser.registerOscHandler(7, (data) => {
      const path = data.split("://")[1] ?? data;
      const slash = path.indexOf("/");
      if (slash >= 0) {
        // Windows reports `/C:/Users/x` — the leading slash is part of the URL
        // path, not the filesystem path, and shows up in the prompt if kept.
        lastCwd = decodeURIComponent(path.slice(slash)).replace(/^\/(?=[A-Za-z]:)/, "");
        promptCwd = lastCwd;
      }
      // The raw payload, quoted. A capture showed the prompt path keeping the
      // leading slash OSC 7 puts before a Windows drive letter, but every
      // plausible `file://host/C:/…` shape strips correctly in isolation — so
      // the payload is not the shape it is assumed to be, and guessing at it
      // is what the last four attempts did.
      debugPush(`7 ${JSON.stringify(data)} -> ${JSON.stringify(lastCwd)}`);
      return true;
    });

    // Alt-screen apps (vim, htop, claude) get the raw xterm view. xterm tracks
    // the buffer swap itself, so there's nothing to sniff out of the stream.
    // `onBufferChange` is the signal, but it only fires on a real swap event;
    // the write callback re-checks the same flag every chunk so a swap that
    // lands without one still flips the view on the very next byte.
    function syncMode() {
      const next = t.buffer.active.type === "alternate" ? "raw" : "blocks";
      if (next === mode) return;
      debugPush(`mode ${mode} -> ${next}`);
      // The block that launched the app keeps its heading and result. Its rows
      // are gone from the buffer the marker points into, so anything read back
      // now would be the app's leftover screen, not the command's output.
      if (next === "raw") rawBlockId = currentBlock()?.id ?? -1;
      // The strip lives inside the block view. Dropped, not faded out: the whole
      // pane is being swapped, and a tween whose node the swap is about to
      // unmount would leave the flag set and the strip back on the next return.
      menuOpen = false;
      mode = next;
      // The two modes want different widths — the whole window for a full-screen
      // app, a block's inner width for everything else — so the swap is also a
      // resize, and the shell has to be told before it draws its first frame.
      syncSize();
      ready.then(() => invoke("pty_resize", { cols: t.cols, rows: t.rows }));
      t.focus();
    }
    t.buffer.onBufferChange(() => {
      debugPush(`onBufferChange -> ${t.buffer.active.type}`);
      syncMode();
    });

    // The decisive question the previous fixes could only guess at: does the
    // alt-screen enter/exit sequence reach us at all? ConPTY is known to
    // intercept and rewrite some private modes, so "vim didn't switch the view"
    // has two very different causes and they need telling apart. Returning
    // false leaves the sequence to xterm's own handler — this only watches.
    for (const final of ["h", "l"] as const) {
      t.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
        if (params.includes(1049) || params.includes(47) || params.includes(1047)) {
          debugPush(`CSI ?${params.join(";")}${final}  (alt-screen)`);
        }
        return false;
      });
    }

    // Raw bytes always go to xterm, even while it's visually hidden in block
    // mode: xterm's VT emulation is what answers control queries the shell
    // sends (cursor position reports, DSR, etc.) — without it those leak into
    // the block view as literal garbage and shells like PowerShell/PSReadLine
    // stall waiting for a reply nobody sent.
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (bytes) => {
      // Logged before the write, not inside the callback below: the callback
      // runs after xterm has parsed the chunk, and `133;D` firing mid-parse
      // closes the block — so by then the chunk that finished a command would
      // be filed under no block at all. The tail it carries is cut in
      // `rawText` instead, where a cut costs nothing.
      logRaw(new Uint8Array(bytes));
      // The callback runs once xterm has parsed the chunk — reading the buffer
      // before that would snapshot a stale screen, and the OSC handlers above
      // have all fired by then.
      t.write(new Uint8Array(bytes), () => {
        syncMode();
        if (debugOn) debugTick++;
        if (mode === "raw") return;
        const buf = t.buffer.active;

        if (atPrompt) {
          // Nothing to mirror yet if this chunk hasn't reached 133;B — the
          // row currently holds an unfinished prompt, not typed input.
          if (promptReady) {
            // The *logical* line, not the cursor's row: a command longer than
            // the terminal is wide wraps onto further rows, and reading one row
            // showed the tail with no prompt to strip — the input bar looked
            // like it had wiped itself at a fixed character count.
            const cursorRow = buf.baseY + buf.cursorY;
            let start = cursorRow;
            while (start > 0 && buf.getLine(start)?.isWrapped) start--;
            let row = "";
            // Which cells the shell has drawn as selected, in the same column
            // space as `row`. `translateToString` throws every attribute away,
            // so a selection reached the mirror as ordinary text and Ctrl+A
            // looked like it did nothing — the shell had it the whole time.
            // Read from the cells instead of from any one shell's key bindings,
            // so a mouse selection, Shift+arrow and Ctrl+A all arrive the same
            // way: as a run of cells with a background the rest of the row
            // does not have.
            //
            // ponytail: any background counts as selection. A shell that tints
            // a token's background for syntax rather than for selection would
            // read as selected here; no shell in tier 1 does. Narrow it to the
            // reported selection colour if one ever does.
            let selStart = -1;
            let selEnd = 0;
            const cell = buf.getNullCell();
            for (let y = start; y < buf.length; y++) {
              const line = buf.getLine(y);
              if (!line || (y > start && !line.isWrapped)) break;
              // Untrimmed: every row but the last is padded out to the full
              // width, and that padding is what makes the column maths below
              // line up with what the shell thinks the cursor offset is.
              row += line.translateToString(false);
              for (let x = 0; x < t.cols; x++) {
                line.getCell(x, cell);
                if (!cell.isInverse() && cell.getBgColorMode() === 0) continue;
                const col = (y - start) * t.cols + x;
                if (selStart < 0) selStart = col;
                selEnd = col + 1;
              }
            }
            const stripped = row.replace(PS_PROMPT, "");
            // No prompt on this row means the column maths below has nothing to
            // subtract, so `cursorCol` comes out carrying the prompt's own width
            // and `padEnd` fills the input bar with that many spaces — the caret
            // parks a prompt-width away from the start with no text in front of
            // it. That is what a cleared console and several commands left
            // behind. Mirroring a row the prompt is not on is never right, so
            // keep the last good state instead of inventing one.
            if (stripped === row) return;
            // The prompt's width is whatever the strip removed, so the caret
            // column survives a resize and a re-rendered prompt.
            const promptWidth = row.length - stripped.length;
            cursorCol = Math.max(0, (cursorRow - start) * t.cols + buf.cursorX - promptWidth);
            // Same offset for the selection: it was measured in screen columns
            // and the bar renders input columns.
            shellSelFrom = selStart < 0 ? 0 : Math.max(0, selStart - promptWidth);
            shellSelTo = selStart < 0 ? 0 : Math.max(0, selEnd - promptWidth);
            // The rows above are read untrimmed, so everything past the typed
            // text is the screen's own blank padding and has to come off. A
            // trailing space the user actually typed is indistinguishable from
            // that padding by looks — the cursor is what tells them apart, since
            // the shell has moved it past every space it accepted. Trim, then
            // put back exactly as much as the caret stands on: the caret sits
            // between two slices of this string, so a space it has moved over
            // but that isn't here leaves it parked on the last letter instead.
            const typed = stripped.replace(/\s+$/, "");
            input = typed.padEnd(cursorCol, " ");
          }
          return;
        }

        // Nothing to attribute output to: before the first prompt has ever
        // completed, or in the gap between one command ending and the next
        // prompt starting. Both windows carry shell bookkeeping, not command
        // output, and block-ifying it produces empty containers.
        if (!booted || betweenCommands) return;

        let block = currentBlock();
        if (!block || block.closed) {
          openBlock("");
          block = currentBlock()!;
        }
        snapshot(block);
        // Not `queueReveal` directly: the reveal pass follows whatever the
        // renderer took, and the renderer takes the buffer only once the stream
        // goes quiet. Revealing a structure that is about to be re-derived is
        // what animated nodes on their way to being thrown away.
        showSoon(block);
      });
    };

    // Attach, not spawn: the shell was started in Rust's `setup`, before the
    // webview finished booting, so its several-hundred-millisecond startup
    // overlaps the frontend's instead of queueing behind it. Everything it
    // wrote in the meantime is buffered and arrives here as the first chunk —
    // xterm parses it exactly as if it had been live, markers and all.
    const ready = invoke("pty_attach", {
      cols: t.cols,
      rows: t.rows,
      onData,
    });

    t.onData((data) => {
      lastSent = data;
      // The whole send sequence, not just the last event: a stray character
      // arriving as its own `onData` is invisible in a single-slot readout.
      debugPush(`key ${JSON.stringify(data)}`);
      // Ctrl+C. An abort is exactly the interrupt ANIMATION.md requires a kill
      // for: the output the reveal is walking through has stopped arriving, so
      // a tween still stepping a clip down that element is animating rows that
      // will never be completed by anything.
      if (data.includes("\x03")) killReveals();
      // Enter is the hand-off: the typed line stops being "input" and becomes
      // a block. Marking here (rather than on an OSC event) keeps the block's
      // marker on the prompt row — events arrive on a separate channel from
      // the bytes they describe, so they cannot be positioned against the screen.
      // A blank Enter just redraws the prompt — nothing ran, nothing to show,
      // and no block opens. `atPrompt` is left alone; the next 133;A resets it.
      if (atPrompt) {
        const nl = data.indexOf("\r");
        pendingCommand += nl === -1 ? data : data.slice(0, nl);
      }
      if (atPrompt && promptReady && data.includes("\r")) {
        // A plain word standing where a command goes is swapped for the command
        // as the line leaves — the one place VAD/OS edits what it sends, and it
        // edits exactly one word of it. See `wordCommand`.
        //
        // **Only when Enter arrived on its own.** A paste carries its whole line
        // in the same chunk as the `\r`, and the mirror is a keystroke behind it
        // — the fallback below exists for precisely that race. Rewriting from a
        // line we are not sure of would send something nobody typed, so the swap
        // is confined to the case where the screen is known to be current.
        const swap = data === "\r" ? wordCommand(input) : "";
        // Prefer the mirrored, edited screen text when it arrived in time;
        // fall back to the raw send buffer when it didn't (paste race above).
        const command = (swap.trim() || input.trim() || pendingCommand.trim());
        const local = command ? localCommand(command) : undefined;
        const typed = input.length || pendingCommand.length;
        const line = input;
        const col = cursorCol;
        if (command) {
          // Local commands too: `open` and `clear` are typed as often as
          // anything the shell runs, and a history that skips them is a history
          // with holes exactly where the app's own features are.
          remember(command);
          if (local) local();
          else {
            atPrompt = false;
            // Before the block exists: beat 1 has to be measured against the
            // input bar as the user left it, and the block picks the gesture up
            // when it mounts.
            startHandoff();
            openBlock(command);
          }
          // Both, always together: the caret is positioned by slicing `input` at
          // `cursorCol`, so clearing one without the other leaves it standing
          // where the command used to end.
          input = "";
          cursorCol = 0;
        }
        pendingCommand = "";
        if (local) {
          // The shell has been receiving these keystrokes all along, so the
          // line already sits in its line editor and cannot be unsent. Backspace
          // it away rather than cancelling: Ctrl+U is unbound in PSReadLine's
          // Windows editmode and arrives as a literal `^U`, and Ctrl+C files the
          // abandoned line in history — where it outlives the session, because
          // PSReadLine persists history to disk. Erasing leaves nothing behind.
          //
          // The Enter is deliberately not forwarded, and `atPrompt` stays true:
          // no command ran and no new prompt will be drawn, so the input bar has
          // to keep mirroring the same live row.
          invoke("pty_write", { data: "\x7f".repeat(typed) });
          return;
        }
        if (swap) {
          // The word was typed into the shell's line editor keystroke by
          // keystroke and cannot be unsent, so the line is erased the way a
          // selection is — back to the start, then forward — and the swapped
          // line is written in its place before the Enter that runs it. The
          // shell therefore echoes, records and reports the real command, and
          // the block head is the truth about what ran rather than a label.
          invoke("pty_write", {
            data:
              "\x7f".repeat(col) +
              "\x1b[3~".repeat(Math.max(0, line.length - col)) +
              swap +
              "\r",
          });
          return;
        }
      }
      invoke("pty_write", { data });
    });

    // The PTY's width is what the shell hard-wraps its own output at, and a
    // block renders in a narrower box than the window — the gutter, the block's
    // padding and its border all come off. Reporting the window width meant
    // every full row the shell emitted wrapped a second time in the DOM and
    // left a stub line behind it, which is what long output looked ragged from.
    // Sizing the PTY to what a block can actually show makes the shell's own
    // wrap land exactly where VAD/OS draws it. Raw mode is exempt: a full-screen
    // app draws into the whole window and must be told the whole window.
    const BLOCK_INSET = 30; // 14px padding + 1px border, both sides.

    function syncSize() {
      // Fit first regardless: it is what sets `rows`, and its column count is
      // the full-width one raw mode wants and the cell width is derived from.
      fit.fit();
      if (mode === "raw" || !scrollEl) return;
      const cell = wrapper.clientWidth / t.cols;
      const style = getComputedStyle(scrollEl);
      const inner =
        scrollEl.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        BLOCK_INSET;
      const cols = Math.max(20, Math.floor(inner / cell));
      if (cols !== t.cols) t.resize(cols, t.rows);
    }

    function afterResize() {
      syncSize();
      // The debug overlay reports window dimensions, and a resize is the one
      // thing that changes them without any PTY traffic to tick on.
      if (debugOn) debugTick++;
      // Reflow moved every row; re-read the open block at the new width.
      const block = currentBlock();
      // Reflow is not new output, so it is shown at once rather than waited on —
      // holding it back would leave the block laid out at the old width.
      if (block && !block.closed) {
        // Reflow rewrote every row, so the resumable read is worthless here.
        snapshot(block, true);
        showNow(block);
      }
      // Same reflow, other consumer: rows that appeared because the window
      // narrowed are not new content and must not be revealed again.
      settleReveals();
      // A cached rect from before the resize positions the hover ring wrong.
      hotRect = undefined;
      ready.then(() => invoke("pty_resize", { cols: t.cols, rows: t.rows }));
    }

    // Everything above runs once per observed change, and none of it is cheap:
    // it re-reads the open block out of xterm's buffer, re-renders it, walks
    // every tracked reveal and round-trips to Rust. The cwd panel tweens a
    // layout property, so without this guard all of that would run on every
    // frame of the band's 0.34s — thirty times, for a width that is still
    // moving. The tween calls it once when it lands, which is the only frame
    // the answer is final. `syncBand` is how it reaches back in here.
    syncBand = afterResize;
    const observer = new ResizeObserver(() => {
      if (bandMoving) return;
      afterResize();
    });
    observer.observe(wrapper);
    // The cwd panel narrows the scrollport without changing the window, so the
    // xterm wrapper above never moves and its observer never fires. `.scroll`'s
    // content box is what actually shrinks, and the PTY's column count is
    // derived from it — without this the shell keeps wrapping at the full
    // width and every long row grows a stub line behind it.
    observer.observe(scrollEl);
    const unwatchDrops = watchDrops();

    return () => {
      unwatchDrops();
      unlistenConfig.then((off) => off());
      clearTimeout(saveTimer);
      clearTimeout(showTimer);
      observer.disconnect();
      scrollTween?.kill();
      bandTween?.kill();
      killHandoff();
      killReveals();
      clearTimeout(noticeTimer);
      mm.revert();
      t.dispose();
    };
  });
</script>

<!-- Esc is handled here rather than in xterm's key handler: that one only runs
     while xterm's textarea has focus, so any click inside the panel silently
     disarmed the key. `capture` so a focused control inside the panel cannot
     consume it first. -->
<svelte:window onfocus={refocus} onfocusoutcapture={keepFocus} onkeydowncapture={onAppKey} />

<!-- The font mode resolves to two custom properties here and nothing reads the
     mode itself, so every consumer below is `var(--font-outside)` or
     `var(--font-inside)` and stays unaware of how many modes exist. -->
<div
  class="app"
  bind:this={appEl}
  style:--font-outside={FONT_MODES[fontMode].outside}
  style:--font-inside={FONT_MODES[fontMode].inside}
  onclick={clickAway}
  role="presentation"
>
  {#if notice}
    <div class="notice" bind:this={noticeEl} use:noticeFade>{notice}</div>
  {/if}
  <div class="stage">
    <!-- One delegated pointer listener for the whole scrollback's hover rings.
         A listener per block is a leak per command — see `hoverMove`. -->
    <div
      class="scroll"
      class:visible={mode === "blocks"}
      bind:this={scrollEl}
      onscroll={onScroll}
      onpointermove={hoverMove}
      onpointerleave={hoverLeave}
      role="presentation"
    >
      {#each blocks as block (block.id)}
        {#if !block.md}
          <div class="banner-center">
            <pre class="banner">{block.buffer}</pre>
          </div>
          <div class="banner-divider" use:drawDivider>{dividerLine}</div>
          <div class="banner-sub">
            <div>VAD/OS | Terminal</div>
            <div>/help for commands</div>
          </div>
        {:else}
          <!-- `data-id` is how the focus model finds an element for a block:
               the blocks are keyed data and the DOM node is created by an
               `{#each}`, so there is nothing to hold a ref on. Clicking selects
               the same one notion of focus the keyboard moves — a pointer and a
               keyboard growing separate ideas of "the one I mean" is exactly
               what phase-7-navigation.md says breaks every later consumer.

               The a11y suppression is the one case the rule cannot see: the
               keyboard path for this exists and is Ctrl+Up / Ctrl+Down, but it
               is a global chord on xterm's key handler rather than a listener
               on this element, because xterm owns focus for the whole app and a
               focusable block would take the keyboard away from the shell. A
               `<button>` here would be worse on both counts — it is a region of
               output, and it would be a tab stop per command. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <section
            class="block"
            class:open={!block.closed}
            class:focused={focusedId === block.id}
            data-id={block.id}
            role="group"
            use:blockEnter
            use:anchorNewBlock
            use:growBlock
            onclick={() => (focusedId = block.id)}
            oncontextmenu={(e) => copyBlock(e, block)}
          >
            <!-- The pointer-tracked ring. A sibling layer rather than a border
                 image: the gradient has to be masked to the ring only, and a
                 mask on the block itself would take the content with it. -->
            <div class="block-hue"></div>
            {#if block.cwd}
              <!-- The reveal goes on the inner span, never on the head itself:
                   the head carries the block's own chrome (it is the sticky
                   pinned line and paints a background), and clipping that
                   would animate the chrome rather than the text. -->
              <div class="block-head" use:stickyHead><span class="head-text" use:reveal>&gt; {block.cwd}{#if block.command}<span class="block-sep">&nbsp;|&nbsp;</span><span class="block-command">{block.command}</span>{/if}</span></div>
            {/if}
            {#if block.raw}
              <!-- The bytes, as themselves. No reveal: this is a state change
                   on a block already on screen, and the crossfade in
                   `toggleRaw` is that gesture — a reveal here would animate the
                   text a second time as though it had just arrived. Control
                   characters are shown as glyphs, so an escape sequence in here
                   cannot still be acting as one. -->
              <pre class="raw-view">{visibleCtrl(rawText(block))}</pre>
              {#if rawLogs.get(block.id)?.dropped}
                <div class="raw-note">Truncated — this block passed the raw log's size cap.</div>
              {/if}
            {:else}
            {#each blockNodes(block) as node}
              {#if node.kind === "heading"}
                {#if node.level === 3}
                  <h3 class="md-heading md-heading-3" class:warn={node.tone === "warn"} class:ok={node.tone === "ok"} use:reveal>{node.text}</h3>
                {:else}
                  <h2 class="md-heading" class:warn={node.tone === "warn"} class:ok={node.tone === "ok"} use:reveal>{node.text}</h2>
                {/if}
              {:else if node.kind === "list"}
                <!-- The row is the reveal unit, not the list. A list grows a row
                     at a time — `ping` adds one a second — and a reveal attached
                     to the `<ul>` fires once, on the chunk the list first mounted
                     in, so every row after that appeared with no animation at
                     all. One action per `<li>` means a row animates when it
                     arrives, which is the same rule everything else in a block
                     follows. The row waves like any other prose, one rank ahead
                     of it (`waveRank`). -->
                <ul class="md-list">
                  {#each node.items as item}
                    <li class="md-row" use:reveal>{item}</li>
                  {/each}
                </ul>
              {:else if node.kind === "code"}
                <!-- One span per token run, no whitespace between them: any
                     newline the template introduced would land inside a `pre`
                     and become a real line break.

                     The reveal is on the inner `<code>`, never on the `<pre>`:
                     the box, its background and its border are chrome and are
                     already on screen — only the text inside is animated. Both
                     reveals depend on this equally. Clipping the container
                     would animate the box in, and the bar wipe would paint over
                     a box that was never hidden.

                     The box still animates — `boxIn` rises it into place before
                     the code types inside it. Unanimated, it was the one thing
                     in a block that simply appeared. -->
                <pre class="code-block" use:boxIn><code class="code-text" use:reveal>{#each node.spans as span}{#if span.token}<span class="tok-{span.token}">{span.text}</span>{:else}{#each tint(span.text, span.at, blockRuns(block.id), block.runShift) as piece}{#if piece.style}<span style={piece.style}>{piece.text}</span>{:else}{piece.text}{/if}{/each}{/if}{/each}</code></pre>
                <!-- Trailing spacer, not margin on .code-block itself — a
                     margin would also apply above the block, doubling up
                     against the block-entrance gap already set by .scroll's
                     flex `gap`. -->
                <div class="code-spacer"></div>
              {:else}
                <!-- A link is the one token that is also a control, so it is an
                     `<a>` rather than a styled `<code>`. `href` is the matched
                     text itself and the match starts at `http`, so a scheme
                     Tauri would refuse to open cannot get in here.

                     **The reveal is per line, not on the `<pre>`.** An element
                     animates once, on the chunk it mounted in, so a paragraph
                     rendered as one element animated when its first line landed
                     and every line after that simply appeared — which is what a
                     loop printing a number a second looked like. A line is what
                     arrives, so a line is what animates; the `<pre>` is the box
                     around them and is already on screen. The newline between
                     two lines is a real character because they sit in a `pre` —
                     a margin would be a different layout. -->
                <pre class="block-body" class:bold={node.bold}>{#each lineParts(node.parts) as parts, i}{#if i}{"\n"}{/if}{#if parts.length}<span class="md-line" use:reveal>{#each parts as part}{#if part.kind === "link"}<a class="inline-link" href={part.text} target="_blank" rel="noreferrer">{part.text}</a>{:else if part.code}<code class="inline-code {part.kind ?? ''}">{part.text}</code>{:else}{#each tint(part.text, part.at, blockRuns(block.id), block.runShift) as piece}{#if piece.style}<span style={piece.style}>{piece.text}</span>{:else}{piece.text}{/if}{/each}{/if}{/each}</span>{/if}{/each}</pre>
              {/if}
            {/each}
            {/if}
            {#if block.closed && block.cwd}
              <!-- Swept, not pulsed: this is the one fully saturated run of
                   text in the block, which is tier 0's definition, and it says
                   the same kind of thing a status heading says. The line only
                   ever mounts when the command finishes, so its reveal is the
                   completion pulse — one gesture, not a second one invented for
                   this slot. Success and failure animate identically; the
                   colour already carries the difference. -->
              <div class="block-result" class:ok={block.exitCode === 0} class:err={block.exitCode !== 0} use:reveal>{exitLabel(block.exitCode ?? 0)}</div>
            {:else if block.cwd}
              <!-- The result line's slot before there is a result: what the
                   command is doing, and how to get out of it. A pager is the
                   case that earns this — `less` takes the keyboard and only
                   answers to `q`, and nothing on screen says so, which is how a
                   terminal ends up feeling stuck. Read off the pager's own
                   prompt rather than the command's name; see `runHint`. -->
              <div class="block-running">
                <!-- Shown for as long as the command runs, not only while the
                     box is empty. Output is evidence that something *happened*,
                     not that anything is still happening — a command that
                     printed two lines and then stalled looks identical to one
                     that finished, and the block's foot is where the reader is
                     already looking for the result. The bar occupies that slot
                     until the result replaces it. -->
                <span class="run-bar" use:runBar></span>
                <span>{runHint(block.buffer, block.command)}</span>
              </div>
            {/if}
          </section>
        {/if}
      {/each}
      <!-- There used to be a mirror of the docked input bar here, so the stream
           carried a live "> " line of its own. It was written while `atPrompt`
           was a plain `let` — which Svelte 5 compiles as a constant read — so it
           never rendered once, and nobody saw that it says exactly what the
           docked bar an inch below it says. Two identical controls one above the
           other make the reader work out which one they are typing into, and the
           answer is always the bar: it owns the caret, the selection, and the
           suggestion strip, and the handoff measures its rect. The stream shows
           what has happened; the bar is where things are said. -->
      <!-- Height is written directly by `syncTail`, not bound to state: the
           scroll position is read back in the same call, and a reactive update
           would not be in the layout yet. -->
      <div class="tail-space" bind:this={spacerEl}></div>
      <!-- The reveal bars' host. Absolutely positioned, so it is out of the
           flex flow and adds no height, and inside `.scroll` so its children
           scroll with the content they are drawn over. Svelte never renders
           anything into it — see `barFor` for why that matters. -->
      <div class="reveal-bars" bind:this={barsEl}></div>
    </div>

    <!-- Drawn over the output container, not inside it: a scrollbar in flow
         takes width on one side only and decentres every module. -->
    {#if mode === "blocks"}
      <div class="scrollbar">
        <div class="scroll-thumb" bind:this={thumbEl} use:thumbDrag></div>
      </div>
    {/if}

    <div class="xterm-wrap" class:visible={mode === "raw"} bind:this={wrapper}>
      <div class="xterm-host" bind:this={xtermHost}></div>
    </div>
  </div>

  <!-- One row per entry, recursing into whatever is expanded. A snippet calling
       itself is what a tree is, and it keeps the expansion state in one flat
       array instead of a node type that has to carry its own children.

       Indent is `padding-left` on the row rather than a nested container: the
       rows stay siblings, so the hover target is the panel's full width at
       every depth and nothing at depth six is one pixel wide. -->
  {#snippet panelRows(rel: string, depth: number)}
    <!-- Up. Only at the root, because that is the only level where "up" is not
         already on screen — the parent of anything deeper is the row above it.

         It is the one row with a single gesture: a tree cannot expand upward
         (the parent contains the folder you are looking at, so opening it in
         place is a loop), so `..` writes `cd ..` on a plain click, and shift
         does the same rather than being a second answer to nothing. It also
         does not run — the same rule as every other row here.

         Not in `list_dir`: `..` is not a fact about a directory. `completions`
         in input.js adds it at the same layer and for the same reason. -->
    {#if !rel}
      <div class="cwd-row">
        <span class="cwd-twist empty" aria-hidden="true"></span>
        <button
          class="cwd-entry dir up"
          title="Go up one folder — puts `cd ..` at the prompt"
          onclick={() => replaceLine("cd ..")}>..</button
        >
      </div>
    {/if}
    {#each tree[rel] ?? [] as entry (entry.name)}
      {@const child = joinRel(rel, entry.name)}
      {@const open = expanded.includes(child)}
      <div class="cwd-row" style:padding-left="{depth * 11}px">
        {#if entry.dir}
          <button
            class="cwd-twist"
            class:open
            aria-label={open ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
            onclick={() => toggleDir(child)}>▸</button
          >
        {:else}
          <!-- The twisty's width, kept, so file names line up with the folder
               names above them rather than sliding under the arrows. -->
          <span class="cwd-twist empty" aria-hidden="true"></span>
        {/if}
        <button
          class="cwd-entry"
          class:dir={entry.dir}
          onpointerdown={(e) => panelDragStart(e, child)}
          title={entry.dir
            ? `${entry.name} — click to open, shift+click for cd`
            : `${entry.name} — click or drag for how to run it`}
          onclick={(e) => panelPick(e, entry, child)}>{entry.name}</button
        >
      </div>
      {#if entry.dir && open}
        {@render panelRows(child, depth + 1)}
      {/if}
    {/each}
  {/snippet}

  <!-- Ctrl+B. The one surface that takes width rather than covering it, so it
       has no backdrop and no scrim: nothing behind it is being suspended.
       Raw mode is exempt — a full-screen app owns the whole window. -->
  {#if panelOpen && mode !== "raw"}
    <aside class="cwd-panel" bind:this={panelEl} use:panelSlide>
      <div class="cwd-panel-title" title={promptCwd}>{promptCwd || "—"}</div>
      <div class="cwd-panel-list">
        {@render panelRows("", 0)}
        {#if !(tree[""] ?? []).length}
          <div class="cwd-panel-empty">empty</div>
        {/if}
      </div>
    </aside>
  {/if}

  <!-- Esc. Every value it shows lives here and every apply happens here; the
       panel owns the markup, the CSS and both halves of its animation. -->
  {#if settingsOpen}
    <Settings
      bind:this={settingsPanel}
      {fontMode}
      {scrollMode}
      {revealMode}
      {accent}
      {startupDir}
      {startAsAdmin}
      {reduceMotion}
      isWindows={IS_WINDOWS}
      onFont={setFontMode}
      onScroll={setScrollMode}
      onReveal={setRevealMode}
      onAccent={setAccent}
      onStartupDir={setStartupDir}
      onBrowse={pickStartupDir}
      onAdmin={setStartAsAdmin}
      onDismiss={closeSettings}
    />
  {/if}

  <!-- F3. Sits above both panes on purpose: half of what it exists to diagnose
       only happens in raw mode, where the block view is not on screen. F2
       captures it like anything else, so a report is one keypress each. -->
  {#if debugOn}
    <div class="debug">
      <div class="debug-head">F3 · debug</div>
      {#each debugState() as [key, value]}
        <div class="debug-row"><span class="debug-key">{key}</span><span class="debug-val">{value}</span></div>
      {/each}
      <div class="debug-head">events</div>
      {#each debugLog as line}
        <div class="debug-line">{line}</div>
      {/each}
    </div>
  {/if}

  <!-- Docked, always visible. Not `position: fixed` — it has to resize cleanly
       and must not fight the settings overlay's stacking context later. -->
  {#if mode === "blocks"}
    <!-- Fused to the bar's top edge rather than floating over it: 60% of its
         width, a tenth shorter, and its bottom border *is* the bar's top one. -->
    {#if menuOpen}
      <div class="suggest" bind:this={menuEl} use:menuIn>
        <span class="suggest-text">{menuItems[menuIndex]?.text ?? ""}</span>
        <span class="suggest-meta"
          >{menuItems[menuIndex]?.hint ?? ""} · {menuIndex + 1}/{menuItems.length} · ↑↓</span
        >
      </div>
    {/if}
    <!-- Double-click selects the line. The bar is a mirror of the shell's
         screen, not a text field, so the browser's own double-click selection
         is a selection of *rendered text* — it looks right, and then Backspace
         deletes one character at the caret because that is all the shell was
         ever told. Ours is the one the keys act on, so the browser's is
         collapsed on the way past. -->
    <div
      class="input-bar ghost"
      class:drop={dragOver}
      bind:this={inputBarEl}
      use:growUpward
      ondblclick={selectInput}
      role="presentation"
    >
      <!-- The path is its own span so the handoff can clip it without clipping
           the mark, which lives in the same box and is the thing doing the
           clipping. -->
      <!-- Shortened, and the whole thing on the title: the bar is where the
           path competes for room with what is being typed, so it shows the end
           that answers "where am I". The block heads keep the full path — those
           are the record of what ran and where. -->
      <span class="input-cwd"><span class="ghost-mark">&gt;</span> <span class="cwd-text" title={promptCwd}>{shortCwd(promptCwd)}</span></span><span class="block-sep">&nbsp;|&nbsp;</span><span class="input-text">{#each headSegments as part}<span class:sel={part.sel}>{part.text}</span>{/each}<span
          class="caret"
          class:idle={!atPrompt}
          class:typing
          bind:this={caretEl}
        ></span>{#each tailSegments as part}<span class:sel={part.sel}>{part.text}</span>{/each}{#if ghost}<span class="ghost-suggest">{ghost}</span>{/if}</span>
    </div>
  {/if}
</div>

<style>
  @font-face {
    font-family: "Space Mono";
    src: url("../lib/fonts/SpaceMono-Regular.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
    /* `block` over `swap`: this is a monospace grid, and a swap from a
       fallback with different metrics reflows every row of the scrollback. */
    font-display: block;
  }

  /* The token layer. This is a contract, not an implementation detail — the
     theme engine (phase 11) exposes these names to users, so a token added
     carelessly here is one that cannot be renamed later without breaking every
     theme. Two rules: name a token for what it *is*, never for where it is
     used, and derive anything accent-tinted with color-mix rather than
     hand-picking a second value that then has to be kept in sync.

     Lives on :root rather than .app because html/body read from it too. The
     font slots stay on .app — those are assigned per font mode, not global. */
  :global(:root) {
    --accent: #7e55dd;

    /* Surfaces, darkest to lightest. "raised" is a module, "inset" is a
       control sitting inside one. */
    --surface-sunken: #07070a;
    --surface-base: #0a0a0c;
    --surface-code: #0d0d11;
    --surface-raised: #101014;
    --surface-inset: #141419;
    --surface-overlay: #1a1922;
    --scrim: rgba(6, 6, 9, 0.55);
    --shadow-float: 0 1.6dvh 4dvh rgba(0, 0, 0, 0.55);

    --border: #201f26;
    --border-strong: #2a2833;
    --border-bright: #3a3745;
    --border-overlay: #34313f;
    --rule: rgba(244, 244, 245, 0.09);
    --separator: #45424f;

    --text-strong: #e4e4e7;
    --text: #d4d4d8;
    --text-muted: #a1a1aa;
    --text-dim: #9a9aa2;
    --text-faint: #6a6a72;
    /* "ghost" is the mirrored, not-yet-committed input — readable, visibly
       not the record yet. Three weights of the same idea. */
    --text-ghost: rgba(244, 244, 245, 0.45);
    --text-ghost-faint: rgba(244, 244, 245, 0.35);
    --text-ghost-weak: rgba(244, 244, 245, 0.28);

    /* Derived from --accent, so swapping the accent carries them along.
       These replaced hand-picked violets (#a78bfa, #c4b5fd, #17141f, #1c1b23)
       that were tuned against indigo and would have gone wrong on the other
       three accents — the exact failure mode phase 4 called out. */
    --accent-text: color-mix(in srgb, var(--accent) 58%, #ffffff);
    --accent-text-soft: color-mix(in srgb, var(--accent) 38%, #ffffff);
    --accent-surface: color-mix(in srgb, var(--accent) 10%, var(--surface-inset));
    --accent-surface-strong: color-mix(in srgb, var(--accent) 14%, var(--surface-raised));
    --accent-border-soft: color-mix(in srgb, var(--accent) 30%, var(--border-strong));
    /* Selected text, wherever it is selected — the shell's own selection in the
       input bar and the browser's in the scrollback are the same idea and must
       not be two different colours. Translucent so it tints whatever surface it
       lands on rather than punching a solid block through it. */
    --selection: color-mix(in srgb, var(--accent) 38%, transparent);

    /* Half a turn around the wheel from whatever the accent is — derived, so it
       follows an accent swap like everything above rather than being a fifth
       colour someone has to remember to update. Relative colour syntax does the
       rotation in CSS; the alternative was a hex-to-HSL conversion in JS run on
       every accent change, which is twenty lines to compute what one
       declaration already knows. */
    --complement: hsl(from var(--accent) calc(h + 180) s l);
    --complement-text: color-mix(in srgb, var(--complement) 58%, #ffffff);
    --complement-surface: color-mix(in srgb, var(--complement) 14%, var(--surface-raised));

    /* Exempt from theming by decision: a red that shifted with the accent
       would stop meaning "failed". */
    --ok: #4ade80;
    --err: #f87171;
    --neutral: #9ca3af;

    /* The sixteen a program means when it says "red".

       These are the terminal's palette, not the app's — a program picked one of
       them, so what it resolves to is the terminal's answer and belongs in the
       token layer where a theme can move it. The 216-colour cube and the
       greyscale ramp above these are arithmetic and are computed in `ansi.js`;
       only these sixteen are anyone's choice.

       Tuned to sit in this palette rather than being the VGA originals, which
       are far too saturated against these surfaces. Normal first, bright after,
       in the order a program indexes them. */
    --ansi-0: #16161c;
    --ansi-1: #e05561;
    --ansi-2: #62c073;
    --ansi-3: #d5a458;
    --ansi-4: #5a8ce8;
    --ansi-5: #b57cdb;
    --ansi-6: #48b0bd;
    --ansi-7: #a1a1aa;
    --ansi-8: #4a4a55;
    --ansi-9: #f87171;
    --ansi-10: #4ade80;
    --ansi-11: #f0b429;
    --ansi-12: #7aa2f7;
    --ansi-13: #d4a3f5;
    --ansi-14: #5ed4e0;
    --ansi-15: #e4e4e7;
  }

  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: var(--surface-base);
  }

  /* The webview's default selection colour is a system blue that belongs to no
     part of this theme, and against these surfaces it was near-invisible —
     selecting output looked like nothing had happened. Global on purpose: it
     applies to block text, the banner and the settings panel alike. */
  :global(::selection) {
    background: var(--selection);
    color: var(--text-strong);
  }

  /* The two real fonts. Everything else refers to --font-outside /
     --font-inside, which the font mode assigns from these.
     ponytail: --font-sans is a system stack standing in for Claude Sans
     Modern until the file lands; swapping it is this one line. The cost until
     then is that Windows and Arch render it differently. */
  .app {
    --font-mono: "Space Mono", Consolas, "DejaVu Sans Mono", monospace;
    --font-sans: "Segoe UI", Inter, system-ui, -apple-system, sans-serif;
  }

  .app {
    /* The cwd panel's width, and the band it takes out of everything else.
       Two properties rather than one so the consumers below can stay a single
       `calc` that is simply zero while the panel is shut.

       `clamp` for the same reason the settings panel uses one: a flat `dvw`
       goes unreadable long before it goes small, because the file names in it
       do not shrink with the window. */
    --panel-w: clamp(180px, 18dvw, 300px);
    --panel-open-w: 0px;
    position: relative;
    height: 100vh;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    /* The shell is exactly the window. Anything that overflows it is a bug in
       the pane that overflowed, and a scrollbar here only hides it — `.scroll`
       owns the one scrollport this app has. */
    overflow: hidden;
  }

  /* `--panel-open-w` is written as an inline style by `moveBand`, never by a
     class: it is tweened, and the whole point is the values between 0 and the
     panel's width. The declaration above is only the resting state. */

  /* Both panes are stacked and always full-size, even while "hidden" — that
     keeps xterm's dimensions (and therefore the PTY size it reports) correct
     at all times instead of collapsing to 0x0 when display:none would apply. */
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .scroll,
  .xterm-wrap {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    opacity: 0;
    pointer-events: none;
    /* The mode switch is a crossfade, never a hard swap. A CSS transition
       rather than a GSAP tween: ANIMATION.md's ban is on CSS *keyframe*
       animations for stateful things, and this is one property with two states
       driven by a class the template already toggles — the same reasoning that
       makes the hover ring's own fade a transition. A tween here would need a
       reactive effect and would have to fight these declarations for ownership
       of `opacity`. Timing is ANIMATION.md's raw/block crossfade row. */
    transition: opacity 0.2s ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .scroll,
    .xterm-wrap {
      transition: none;
    }
  }

  .scroll.visible,
  .xterm-wrap.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .scroll {
    overflow-y: auto;
    /* Symmetric side gap. With the scrollbar overlaid rather than in flow,
       both sides are free to be equal — and `dv` keeps the gap proportional
       to the window instead of vanishing on a wide monitor. */
    /* The bottom pad is the room the docked bar is sitting over, given back so
       the last block can still be scrolled clear of it. `--input-h` is written
       by the bar's own resize observer; the fallback is its one-row height. */
    padding: 12px 3dvw calc(24px + var(--input-h, 42px));
    /* The panel's band, given back. `padding` rather than a narrower box, so
       the scrollbar overlay and the reveal's bar overlay keep the coordinates
       they were already positioned in. */
    padding-right: calc(3dvw + var(--panel-open-w));
    display: flex;
    flex-direction: column;
    gap: 10px;
    /* The browser's own scroll-anchoring keeps adjusting scrollTop to "stay
       stable" as a growing command's output streams in below the fold — that
       fights anchorNewBlock's deliberate top-anchor and is what was dragging
       the view to the bottom on long output. This is the standard fix for
       that class of bug in any growing scroll feed. */
    overflow-anchor: none;
    /* Native scrollbar off entirely — `.scrollbar` below draws over the content
       instead. A classic scrollbar takes layout width on the right only, which
       decentres every module by exactly its width. */
    scrollbar-width: none;
  }

  .scroll::-webkit-scrollbar {
    display: none;
  }

  /* Host for the reveal bars. Zero-size and out of flow: it exists only to be a
     coordinate origin and a parent that Svelte will never rewrite. */
  .reveal-bars {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    z-index: 4;
    pointer-events: none;
  }

  /* The character wave's split. `:global` for the same reason as the bar: these
     are built in JS and never carry Svelte's scoping class.

     `inline-block` on the character is what makes it transformable at all — a
     transform does not apply to a non-replaced inline box. The word wrapper is
     there to undo what that costs: a run of inline-blocks can break between any
     two of them, so without it a split line wraps mid-word and re-wraps when the
     text is put back. */
  :global(.wave-word) {
    display: inline-block;
    white-space: pre;
    /* `text-indent` is inherited and applies to the first line of every block
       container — and an inline-block is one. A list item's hanging indent was
       therefore re-applied inside every split span, pulling each one 14px left
       over its neighbour, so a split line stacked on itself and only landed
       correctly when the original text was restored. */
    text-indent: 0;
  }

  :global(.wave-char) {
    display: inline-block;
    text-indent: 0;
    /* The wave is the only thing moving these, and they exist for a third of a
       second. Nothing here should be promoted to its own layer — four hundred
       of those is the cost this animation is trying not to pay. */
    white-space: pre;
  }

  /* One sweep of the wipe. `:global` because these are built in JS and so never
     carry Svelte's scoping class — a scoped selector would match nothing and
     the bar would be an invisible rectangle animating perfectly. */
  :global(.reveal-bar) {
    position: absolute;
    background: var(--accent);
    /* The portfolio's bar glows; at scrollback scale that glow is a paint cost
       on every row of output, so it is a flat fill here. */
    will-change: transform;
  }

  /* `warn` covers `.err` as well — one class for "the bad colour", since the
     bar has no third state to tell them apart with. */
  :global(.reveal-bar.warn) {
    background: var(--err);
  }

  :global(.reveal-bar.ok) {
    background: var(--ok);
  }

  /* The typing indicator, riding the wipe's leading edge. Deliberately the same
     object as the input bar's caret — same width, same fill — because that is
     the statement: the bar handed its cursor to the block and the block is
     writing with it. It never blinks: it is moving, and a blink on a moving
     caret reads as two effects, not one. `:global` for the same reason as the
     bar — built in JS, so it never carries Svelte's scoping class. */
  /* Overlay track. `pointer-events: none` so the whole right edge of the output
     container does not stop swallowing clicks meant for the modules under it —
     only the thumb itself is interactive. */
  .scrollbar {
    position: absolute;
    top: 12px;
    right: 0.8dvw;
    bottom: 12px;
    width: 6px;
    z-index: 5;
    pointer-events: none;
  }

  .scroll-thumb {
    width: 100%;
    border-radius: 3px;
    background: var(--border);
    opacity: 0;
    pointer-events: none;
    transition: background 0.25s ease, opacity 0.25s ease;
  }

  /* Set from `syncThumb` once there is anything to scroll. */
  .scroll-thumb:global(.on) {
    opacity: 1;
    pointer-events: auto;
    cursor: grab;
  }

  .scroll-thumb:global(.on):hover,
  .scroll-thumb:global(.on):active {
    background: var(--border-bright);
  }

  .xterm-wrap {
    padding: 8px;
  }

  .xterm-host {
    height: 100%;
  }

  /* #region ── cwd panel ────────────────────────────────────────────────── */
  .cwd-panel {
    position: absolute;
    top: 12px;
    right: 12px;
    bottom: 12px;
    width: var(--panel-w);
    box-sizing: border-box;
    /* Above the input bar (6) and the scrollbar (5), below the settings
       overlay (30): settings suspends everything, this sits beside it. */
    z-index: 8;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 10px;
    /* Same chrome as the settings panel — border on all four sides and a real
       shadow. It takes layout width, but it is still a surface resting over
       the app rather than a region welded into the frame. */
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    box-shadow: var(--shadow-float);
    font-family: var(--font-outside);
    font-size: 12px;
    color: var(--text);
    overflow: hidden;
  }

  .cwd-panel-title {
    /* The path, elided from the left: the tail is the part that identifies
       where you are, and a drive letter is the part nobody is reading. */
    direction: rtl;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-strong);
    color: var(--text-ghost-weak);
    font-family: var(--font-inside);
  }

  .cwd-panel-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
  }

  .cwd-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .cwd-twist {
    flex: none;
    width: 14px;
    height: 18px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-ghost-weak);
    font: inherit;
    line-height: 1;
    cursor: pointer;
    /* One property, two states, driven by a class the template already
       toggles — the same case the raw/block crossfade is a CSS transition for.
       Nothing else writes this element's transform, so GSAP has nothing to own
       here and a tween would need a reactive effect to drive it. */
    transition: transform 0.15s ease, color 0.15s ease;
  }

  .cwd-twist.open {
    transform: rotate(90deg);
    color: var(--accent-text);
  }

  .cwd-twist.empty {
    cursor: default;
  }

  .cwd-entry {
    display: block;
    /* The row is a flex line now, so the name takes what the twisty leaves
       rather than the panel's full width. */
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 3px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    font: inherit;
    font-family: var(--font-inside);
    color: var(--text);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    /* Ambient tier — a hover is not an action, so it never tweens. */
    transition: background 0.15s ease;
  }

  .cwd-entry:hover,
  .cwd-entry:focus-visible,
  .cwd-twist:not(.empty):hover {
    background: var(--surface-inset);
  }

  .cwd-entry.dir {
    color: var(--accent-text);
  }

  .cwd-panel-empty {
    padding: 3px 6px;
    color: var(--text-ghost-weak);
  }
  /* #endregion */


  /* Deliberately unstyled beyond legibility — it is a diagnostic, not chrome,
     and it should never be mistaken for part of the app in a screenshot. */
  .debug {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 20;
    max-width: 46dvw;
    max-height: 80dvh;
    overflow-y: auto;
    padding: 8px 10px;
    background: var(--surface-sunken);
    border: 1px solid var(--accent);
    border-radius: 8px;
    /* Fixed mono regardless of mode — it dumps quoted rows and column numbers
       that only line up in a grid. A diagnostic does not follow taste. */
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text);
    white-space: pre;
  }

  .debug-head {
    margin: 6px 0 2px;
    color: var(--accent);
    letter-spacing: 0.12em;
  }

  .debug-head:first-child {
    margin-top: 0;
  }

  .debug-row {
    display: flex;
    gap: 8px;
  }

  .debug-key {
    flex: 0 0 12rem;
    color: var(--text-faint);
  }

  .debug-val,
  .debug-line {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .debug-line {
    color: var(--text-dim);
  }

  /* Border radius is a flat placeholder for a true squircle (superellipse) —
     see tasks.md. Note the ring below inherits this radius, so a `clip-path`
     squircle has to carry the ring with it rather than replacing this alone. */
  .block {
    position: relative;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 14px;
    /* This is *the* container. Everything inside inherits from here, so the
       inside/outside split is one declaration rather than a rule per node. */
    font-family: var(--font-inside);
    font-size: 14px;
    color: var(--text);
    /* Explicit, not `normal`. The typewriter reveal derives a rendered-row
       count from height ÷ line box, and `normal` resolves per font — so the
       row cadence would drift with the font mode and be unmeasurable in JS on
       the browsers that report the keyword back verbatim. */
    line-height: 1.5;
  }

  /* The pointer-tracked hover ring, ported from `Module.vue`. The gradient
     fills the whole box and is then masked to the padding ring: two stacked
     masks, one clipped to the content box, composited to exclude — what is
     left is the 1.5px frame. Purely a paint; it never takes layout and never
     takes pointer events, so `closest()` in the delegated handler still
     resolves to the block under it. */
  .block-hue {
    position: absolute;
    inset: 0;
    padding: 1.5px;
    border-radius: inherit;
    pointer-events: none;
    /* Above the sticky command line (z-index 1), which is pulled out to the
       block's edges and paints its own background over the ring's band. */
    z-index: 2;
    background: radial-gradient(
      11rem circle at var(--mx, 50%) var(--my, 50%),
      color-mix(in srgb, var(--accent) 95%, transparent),
      color-mix(in srgb, var(--accent) 50%, transparent) 45%,
      color-mix(in srgb, var(--accent) 20%, transparent) 100%
    );
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.25s ease;
  }

  /* The spawn border. `:global` and `inset: -1px` are both structural: the node
     is created by `blockEnter` so Svelte cannot see the class, and an absolutely
     positioned child resolves against the padding box — so -1px lands the frame
     exactly on the block's own border, which is transparent for the duration.
     Above the hue ring, and gone the moment the draw completes.

     `--gap` is the one number the draw writes: it is the clip's inset from each
     side and the x of each glowing head, so the bright end of the border is the
     end of the border by construction rather than by two values agreeing.

     The ring is the same masked-padding trick as `.block-hue` — a background
     clipped to a 1px frame — because a `border` cannot carry a gradient that
     tracks a moving point. */
  .block :global(.block-frame) {
    position: absolute;
    inset: -1px;
    /* 13px, not the block's 12: the frame's box is 1px outside it on every
       side, and a concentric corner is one radius larger, not the same one. */
    border-radius: 13px;
    padding: 1px;
    pointer-events: none;
    z-index: 3;
    background:
      /* The two heads. Tall and narrow, so the glow covers the whole clip edge
         — top, side and bottom — for the part of the draw where the edge has
         turned the corner and is no longer only along the top. */
      radial-gradient(3rem 140% at var(--gap, 50%) 50%, var(--accent), transparent 70%),
      radial-gradient(3rem 140% at calc(100% - var(--gap, 50%)) 50%, var(--accent), transparent 70%),
      /* The line already drawn, dimmer than its heads but still clearly the
         accent — at the block's own border colour there is nothing to watch. */
      color-mix(in srgb, var(--accent) 65%, transparent);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    clip-path: inset(0 var(--gap, 50%) 0 var(--gap, 50%) round 13px);
    filter: drop-shadow(0 0 5px color-mix(in srgb, var(--accent) 55%, transparent));
    /* The draw is the only thing on screen for 0.24s and it repaints every
       frame. Dropped with the element. */
    will-change: clip-path;
  }

  /* Everything inside a block that is still being drawn, except the frame doing
     the drawing. The reveal hides text only, so the chrome — a code block's box,
     its background, its border — would otherwise be on screen before the
     container enclosing it. `:global` on both halves: the class is added by
     `blockEnter` and the children are the block's own template. */
  .block:global(.spawning) > :global(*:not(.block-frame)) {
    visibility: hidden;
  }

  /* The focused block: a rail down its left edge, the same affordance an editor
     uses for the active line.

     Not a border colour, and that is not a style preference — the hover ring
     tweens `border-color` as an *inline* style, which outranks any rule here
     for the rest of that block's life the moment a pointer has crossed it. Not
     the ring's own gradient either: that one means "the pointer is here" and
     would be saying two things at once. Focus lasts, so it also cannot animate
     — a state that persists has nothing to animate towards. */
  .block.focused::after {
    content: "";
    position: absolute;
    left: 0;
    /* Clear of the corner radius at both ends rather than running into it. */
    top: 10px;
    bottom: 10px;
    width: 2px;
    border-radius: 2px;
    /* Above the head, which is pulled out to the block's edges and paints its
       own background over anything at the block's inner boundary. */
    z-index: 2;
    background: var(--accent);
    pointer-events: none;
  }

  /* `:global` because `hot` is set by the delegated pointer handler rather than
     by the template, so Svelte cannot see it referenced and would prune these.

     `will-change` lives here and nowhere else: on the hovered block only, for
     as long as it is hovered. Declared at rest — as `Module.vue` does it — it
     is a GPU layer per block, and this app has a scrollback rather than the
     portfolio's ten modules. Kept even under reduced motion: the ring tracks a
     pointer the user is already moving; it is not motion imposed on them. */
  .block:global(.hot) .block-hue {
    opacity: 1;
    will-change: opacity;
  }

  .block-head {
    color: var(--accent);
    margin-bottom: 6px;
    /* A command long enough to wrap has no space to break at, so without this
       the head ran straight out past the block's right edge. */
    overflow-wrap: anywhere;
  }

  /* Only the head of a real block, never the live ghost line — that one is a
     direct child of `.scroll` and would pin to the top of the whole stream. */
  .block > .block-head {
    position: sticky;
    /* Sticky offsets resolve against the scrollport's *padding* box, so `0`
       parks the pinned line 12px down inside `.scroll` with output visible in
       the band above it. Cancelling that padding puts it on the real top edge
       — which is also what `syncStuck` measures against. */
    top: -12px;
    z-index: 1;
    /* Pulled out to the block's edges so the pinned line covers the output
       sliding under it, then padded back in to sit where it did before. */
    margin: -10px -14px 10px;
    padding: 10px 14px 6px;
    /* 11px, not the block's 12px: the border sits outside this box. */
    border-radius: 11px 11px 0 0;
    background: var(--surface-raised);
  }

  /* `:global` because `stuck` is toggled by the observer rather than by the
     template, so Svelte cannot see it referenced and would prune this rule. */
  .block > .block-head:global(.stuck)::after {
    content: "";
    position: absolute;
    /* 90% of the container, centred — a rule under the line, not a full-width
       bar butting into the block's own border. */
    left: 5%;
    right: 5%;
    bottom: 0;
    height: 1px;
    background: var(--rule);
  }

  /* Reserved room under the last block so its head can reach the anchor line.
     `flex: none` because a flex column would otherwise collapse it back to
     its content height, which is zero. */
  .tail-space {
    flex: none;
  }

  /* Parent centers the atomic inline-block as one unit — the pre's own
     lines never reflow relative to each other, only the whole block moves. */
  .banner-center {
    text-align: center;
  }

  /* The scroll region is a flex column, and flex items shrink below their
     content by default — on a short window that clipped the divider and the
     subtitle instead of scrolling them. These three keep their height and let
     the scroll container do its job. */
  .banner-center,
  .banner-divider,
  .banner-sub {
    flex: none;
  }

  .banner-center .banner {
    display: inline-block;
    text-align: left;
  }

  .banner-divider {
    width: 80dvw;
    max-width: 100%;
    margin: 4px auto 2px;
    overflow: hidden;
    white-space: nowrap;
    text-align: left;
    color: var(--accent);
    /* ASCII, like the banner above it — the "except code blocks etc." case.
       A proportional font turns a repeated `<<>>` rule into ragged noise. */
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1;
  }

  .banner {
    margin: 0;
    padding: 10px 14px;
    color: var(--accent);
    white-space: pre;
    /* ASCII art. Never follows the font mode — this is the single most
       likely thing to break, per phase-3's gotchas. */
    font-family: var(--font-mono);
    font-size: 14px;
  }

  .banner-sub {
    padding: 4px 14px 0;
    color: var(--text-ghost);
    font-family: var(--font-outside);
    font-size: 13px;
    line-height: 1.5;
    text-align: center;
  }

  /* Centered per the concept: a short rule, not a full-width bar. */
  .divider {
    width: 60%;
    max-width: 320px;
    height: 1px;
    margin: 2px auto;
    background: var(--border);
  }

  /* Mirrored, not authoritative — this is a reflection of xterm's cursor row,
     and it stops existing the moment Enter commits it to a real block. Dull
     translucent white says that: present and readable, visibly not yet the
     record. `.block-command` is the same text after it commits, at full weight. */
  .input-text {
    color: var(--text-ghost);
  }

  .block-command {
    color: var(--text);
  }

  .block-sep {
    color: var(--separator);
  }

  .block-body {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* One line of prose, and the reveal's unit. `inline-block` because the live
     line rises into place with a transform, and a transform does nothing at all
     to a non-replaced inline box — the rise silently degraded to a fade the
     moment the reveal moved off the `<pre>`. Atomic for line-breaking, so the
     newline characters between lines still do the breaking; `max-width` is what
     lets a line longer than the block wrap inside its own box rather than
     running off the edge. */
  .md-line {
    display: inline-block;
    max-width: 100%;
    vertical-align: top;
    white-space: inherit;
  }

  .block-body.bold {
    font-weight: 600;
    color: var(--text-strong);
  }

  /* Placeholder markdown styling — Phase 4 replaces these with tokens. */
  .md-heading {
    margin: 12px 0 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--accent-text);
  }

  .md-heading:first-child {
    margin-top: 0;
  }

  .md-heading-3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--neutral);
  }

  /* Same colors as .block-result — one red, one green, used everywhere a
     status reads as pass/fail. */
  .md-heading.warn {
    color: var(--err);
  }

  .md-heading.ok {
    color: var(--ok);
  }

  .md-list {
    margin: 0 0 6px;
    padding-left: 18px;
    list-style: none;
  }

  .md-list li {
    /* Output is monospace and often column-aligned — keep the alignment. */
    white-space: pre-wrap;
    word-break: break-word;
    text-indent: -14px;
  }

  .md-list li::before {
    content: "- ";
    color: var(--accent);
  }

  /* The reveal's target inside the box above. `block` so it has a height and a
     width of its own to clip against, and it inherits the `pre` wrapping
     rather than restating it. The box, its background and its border are not
     part of the reveal — they are there before the text starts arriving. */
  .code-text,
  .head-text {
    display: block;
    white-space: inherit;
    word-break: inherit;
    overflow-wrap: inherit;
  }

  .code-block {
    margin: 4px 0;
    padding: 8px 10px;
    background: var(--surface-code);
    border: 1px solid var(--border);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-muted);
    /* The explicit exception in the brief. Code is mono in every mode,
       including the two where its container is not. */
    font-family: var(--font-mono);
  }

  /* The raw view. Monospace unconditionally, for the same reason a code block
     is: this is a byte-for-byte reading and alignment is the whole point of it.
     No background and no border — it is the block's body in this state, not a
     box sitting inside the body. Muted, because a raw view is a diagnostic
     rather than the thing you are meant to be reading. */
  .raw-view {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .raw-note {
    margin-top: 6px;
    color: var(--err);
    font-size: 12px;
  }

  /* Colour only. A code block's columns line up because every glyph is the
     same width, so padding, background, weight, or letter-spacing on a token
     inside one would shift every character after it on that row. This is the
     same carve-out that keeps code monospace in every font mode, applied to
     highlighting: tint the token, never resize it. */
  .tok-flag {
    color: var(--accent-text);
  }

  .tok-var {
    color: var(--accent-text-soft);
  }

  .tok-str {
    color: var(--text-strong);
  }

  /* The same three meanings the prose tokens carry, in the same two hues — but
     tint only. An `.inline-code.path` gets a surface and padding; a path inside
     a block cannot, or every character after it on that row shifts. */
  .tok-path {
    color: var(--complement-text);
  }

  .tok-link {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* A timestamp is a stamp, not content. Grey rather than tinted so a log's
     structure reads before its text without every line carrying an accent. */
  .tok-time {
    color: var(--text-ghost);
  }

  .code-spacer {
    height: 8px;
  }

  .inline-code {
    padding: 1px 5px;
    background: var(--accent-surface-strong);
    border-radius: 4px;
    color: var(--accent-text-soft);
    /* Was `inherit`, which made inline code sans inside a sans container —
       the same exception as .code-block applies at token level. */
    font-family: var(--font-mono);
  }

  /* A path is the token most often sitting next to a flag or a URL, and telling
     the three apart at a glance is the whole point of tinting them. The
     complement is the one hue guaranteed to stay distinct from the accent
     whichever accent is picked. */
  .inline-code.path {
    background: var(--complement-surface);
    color: var(--complement-text);
  }

  /* A timestamp is a stamp, not content — grey chrome, and the accent only on
     the digits so a log line's structure reads before its text does. */
  .inline-code.time {
    background: var(--surface-inset);
    color: var(--accent-text);
  }

  .inline-link {
    color: var(--accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .inline-link:hover {
    color: var(--accent);
  }

  .block-result {
    margin-top: 6px;
    font-size: 12px;
  }

  .block-result.ok {
    color: var(--ok);
  }

  .block-result.err {
    color: var(--err);
  }

  /* Sits in the result line's slot and must not read as one: this is chrome
     telling the reader how to operate the thing that is running, not something
     the command said. Dimmer than any output, and never tinted with a status
     colour, because it is not reporting one. */
  .block-running {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-ghost-faint);
  }

  /* The track. Fixed width so the row's layout does not depend on the bar being
     there — the hint beside it sits in the same place either way. */
  .run-bar {
    position: relative;
    flex: none;
    width: 48px;
    height: 2px;
    overflow: hidden;
    border-radius: 1px;
    background: rgba(244, 244, 245, 0.08);
  }

  .run-bar-head {
    position: absolute;
    inset: 0 auto 0 0;
    width: 25%;
    border-radius: inherit;
    background: var(--accent);
    opacity: 0.55;
  }

  .notice {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    padding: 6px 14px;
    background: var(--surface-overlay);
    border: 1px solid var(--border-overlay);
    border-radius: 8px;
    font-family: var(--font-outside);
    font-size: 12px;
    color: var(--text);
    pointer-events: none;
  }

  .input-bar {
    /* Laid over the stage, not in flow above it: in flow, every row the bar
       gained came off the stage's height, and the stage's height is what sets
       the PTY's rows. See `growUpward`. */
    position: absolute;
    left: 12px;
    right: calc(12px + var(--panel-open-w));
    bottom: 12px;
    /* Above the scrollbar overlay (5), below the settings panel (30) and the
       toast (10) — output scrolls under the bar, chrome still lands on top. */
    z-index: 6;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 12px 14px;
    background: var(--surface-inset);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    font-family: var(--font-outside);
    font-size: 14px;
    color: var(--text);
    transition: border-color 0.25s ease, background 0.25s ease;
  }

  /* The suggestion strip. Sized off the bar it belongs to rather than off the
     window: 60% of its width, a tenth shorter, and pulled down by one pixel so
     the bar's top border serves as this strip's bottom edge. That overlap is
     what makes the two read as one control instead of a popup that happens to
     be nearby. `--input-h` is written by `growUpward`, so the strip follows the
     bar as it grows to two and three rows. */
  .suggest {
    position: absolute;
    /* Centred over the bar by the two insets plus `auto` margins, never by a
       translate: the enter and leave tweens own this element's transform, and a
       `translateX(-50%)` in the stylesheet is the first thing GSAP overwrites
       when it writes `y`. An absolutely positioned box with both insets, a
       width, and auto margins centres in the box they describe — same result,
       and it leaves the transform free. */
    left: 12px;
    right: calc(12px + var(--panel-open-w));
    margin-inline: auto;
    bottom: calc(12px + var(--input-h, 44px) - 1px);
    /* Centred in the band the bar actually occupies, so it stays centred over
       the bar rather than over the window once the panel has taken a slice. */
    width: calc((100% - 24px - var(--panel-open-w)) * 0.6);
    height: calc(var(--input-h, 44px) * 0.9);
    /* Same layer as the bar — they are one control. */
    z-index: 6;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: var(--surface-inset);
    border: 1px solid var(--border-strong);
    border-bottom: none;
    border-radius: 12px 12px 0 0;
    font-family: var(--font-outside);
    font-size: 14px;
    /* Ghost, like the mirrored line below it: this is not the record either. */
    color: var(--text-ghost);
    overflow: hidden;
  }

  .suggest-text {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    /* A long path is truncated rather than wrapped — the strip is one line by
       design, and a second row would break the height it is sized to. */
    text-overflow: ellipsis;
  }

  .suggest-meta {
    flex: none;
    font-size: 11px;
    color: var(--text-ghost-weak);
  }

  /* A drag is over the window. The bar is the drop's destination — the paths
     land at the prompt — so it is the bar that has to say so. Ambient tier: a
     border and a tint, no motion. */
  .input-bar.drop {
    border-color: var(--accent);
    background: var(--accent-surface);
  }

  .input-cwd {
    flex: none;
  }

  /* Both are clipped by the handoff as the mark sweeps over them, and a
     `clip-path` on a non-replaced inline box has no defined box to clip to.
     `inline-block` changes no metric on either — one is a path, the other three
     characters — and is what makes the erase possible. */
  .cwd-text,
  .block-sep {
    display: inline-block;
  }

  /* The ghost line is one uniform dull white — path, separator and mirrored
     text all read as the same not-yet-committed thing. The `>` is the only
     accent on it: it marks where the line begins and it is the one part that
     is not a reflection of anything. */
  .ghost,
  .ghost .input-cwd {
    color: var(--text-ghost);
  }

  .ghost .block-sep {
    color: var(--text-ghost-weak);
  }

  /* The inline completion. Dimmer than the mirrored input, which is itself
     dimmer than a committed command — three weights for three degrees of
     "this is real": typed and run, typed and not yet run, not typed at all.
     No animation: it changes on every keystroke, and something that flickers
     under the caret is unreadable at typing speed.

     It renders *inside* `.input-text`, which is the box that wraps. As a flex
     sibling it would be its own item, with the bar's 8px gap in front of it and
     its own line to wrap onto. The cost of being inside is that `startHandoff`
     has to take its width back off everything it measures from that box, and
     drop it from the frozen copy the way it already drops the caret — text
     nobody typed is not part of the gesture that hands typed text to a block. */
  .ghost-suggest {
    color: var(--text-ghost-weak);
    white-space: pre;
    pointer-events: none;
  }

  .ghost-mark {
    color: var(--accent);
    /* The handoff translates this on submit, and a transform does not apply to
       an inline box at all. `inline-block` on a single glyph changes no metric
       here and is what makes the gesture possible. */
    display: inline-block;
  }

  .input-text {
    /* `min-height` keeps the line's box real while the input is still empty. */
    min-height: 18px;
    white-space: pre-wrap;
    /* A flex item refuses to shrink below its min-content width by default, and
       a typed command is one unbroken run with no space to break at — so the
       bar overflowed sideways and the window grew a scrollbar instead of the
       text wrapping. `anywhere` is the one wrap mode that also *lowers*
       min-content width, which is what lets `min-width: 0` take effect. */
    min-width: 0;
    overflow-wrap: anywhere;
    /* The caret carries a negative margin so it takes no advance width (see
       `.caret`), which means at the end of a line it paints past where the text
       ends. Text wraps against the content box, so without room reserved here
       that last caret lands under the clip below and gets cut in half — and
       `scrollIntoView` then treats it as out of view and scrolls the whole
       line to chase it. The caret overhangs by its own 0.65ch, and the tween
       that lands it there overshoots (`back.out`) past the column before
       settling, so the room reserved covers the bounce as well as the caret —
       on both sides, since a delete overshoots left off column zero. */
    padding-right: 1.6ch;
    padding-left: 0.5ch;
    /* Keeps the text where it was before that left padding — the mirrored line
       has to sit on the same column as the committed one above it. */
    margin-left: -0.5ch;
    /* Growth stops at three rows and the text scrolls inside them. An input bar
       that keeps growing eventually owns the window, and the full line is
       already readable in the live prompt line up in the stream. Stated as a
       row count times an explicit line-height, so the cap stays exactly three
       rows if either changes. */
    line-height: 18px;
    max-height: calc(3 * 18px);
    overflow-y: auto;
    /* Explicit, not left to the default: a box with one axis `auto` computes
       the other from `visible` to `auto` as well, so every keystroke that
       briefly overflowed sideways flashed a horizontal scrollbar mid-reflow.
       Nothing here ever needs to scroll horizontally — the text wraps. */
    overflow-x: hidden;
  }

  /* The shell's own selection, mirrored. Not `::selection` — that styles the
     browser's selection, and this run is ordinary text that the shell has told
     us is selected. Same colour as the real one, so the two are one idea. */
  .input-text .sel {
    background: var(--selection);
    color: var(--text-strong);
  }

  /* The bar's own scrollbar. Drawn rather than hidden — this is a box the user
     can genuinely scroll, so it has to say so — but sized and tinted to read as
     part of the input chrome instead of a window scrollbar that wandered in. */
  .input-text::-webkit-scrollbar {
    width: 6px;
  }

  .input-text::-webkit-scrollbar-track {
    background: transparent;
  }

  .input-text::-webkit-scrollbar-thumb {
    border-radius: 3px;
    background: var(--accent-border-soft);
  }

  .input-text::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }

  /* Decorative, never interrupted, never coordinated — the one case where a
     CSS keyframe animation is allowed instead of GSAP. See ANIMATION.md.
     Width is 0.65ch — narrower than a cell, so it reads as a caret sitting at
     the column rather than a block overhanging the text to its right. */
  .caret {
    /* In flow, between the two halves of the text, rather than absolutely
       positioned at `col * 1ch`: that only ever addressed a single line, so it
       ran off the end as soon as the input wrapped. The negative margin gives
       it zero advance width, so it overlays the column it marks and never
       shifts the text after it or changes where the line breaks. */
    display: inline-block;
    vertical-align: text-bottom;
    width: 0.65ch;
    margin-right: -0.65ch;
    height: 15px;
    background: var(--accent);
    animation: caret-blink 1s step-end infinite;
  }

  .caret.idle {
    opacity: 0.25;
    animation: none;
  }

  .caret.typing {
    opacity: 1;
    animation: none;
  }

  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }
</style>
