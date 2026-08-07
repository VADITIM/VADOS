<script lang="ts">
  import { onMount } from "svelte";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { Terminal, type IMarker } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import gsap from "gsap";
  import { ScrollToPlugin } from "gsap/ScrollToPlugin";
  import { RoughEase } from "gsap/EasePack";
  import banner from "$lib/banner.txt?raw";
  import { parse, toMarkdown } from "$lib/parse.js";
  // The reveal's geometry lives in its own module so it can be checked without
  // a browser: `node src/lib/reveal.check.mjs`.
  import { revealClip, revealStagger } from "$lib/reveal.js";

  type Node = ReturnType<typeof parse>[number];

  // `rough` ships inside the gsap package but is not part of the core ease set,
  // so it has to be registered like any plugin — an unregistered ease string
  // silently degrades to `power2.out` rather than erroring, which is the worst
  // possible failure mode for an effect whose whole point is the jitter.
  gsap.registerPlugin(ScrollToPlugin, RoughEase);

  // Repeated enough to cover 80dvw at any reasonable window width; the
  // divider element clips it to width, so overshoot is free and safe.
  const dividerLine = "<<>>".repeat(60);

  // #region ── font modes ─────────────────────────────────────────────────────
  // Two slots, not four font stacks: text *outside* a module and text *inside*
  // one (see the glossary in .claude/architecture.md). Every mode is a pair of
  // assignments to those two slots, so adding a mode is a row here and nothing
  // else. Code blocks and the raw view ignore both and stay mono
  // unconditionally — alignment is load-bearing there.
  const FONT_MODES = {
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

  type FontMode = keyof typeof FONT_MODES;

  // Where the view lands when a new block opens. The two answers are genuinely
  // a preference rather than a right and a wrong: anchoring the head near the
  // top lets a long command read as a document from its first line, and jumping
  // to the tail gets you to the newest output without waiting for it.
  const SCROLL_MODES = {
    top: {
      label: "Stay on top",
      hint: "Anchor the command line near the top",
    },
    bottom: {
      label: "Move down",
      hint: "Follow the newest output",
    },
  } as const;

  type ScrollMode = keyof typeof SCROLL_MODES;

  // One value drives the whole accent surface — every tint, border and hover
  // state derives from it with color-mix in the token layer, so a new accent
  // is one row here and nothing else. Each is picked to be vibrant in its own
  // right rather than a hue rotation of the indigo, which is why they are not
  // all the same saturation.
  const ACCENTS = {
    indigo: { label: "Indigo", value: "#7e55dd" },
    blue: { label: "Blue", value: "#4d7cfe" },
    yellow: { label: "Yellow", value: "#f0b429" },
    orange: { label: "Orange", value: "#fb7a2a" },
  } as const;

  type Accent = keyof typeof ACCENTS;

  // How far down the viewport a newly anchored block head sits, in `dv` terms
  // per ANIMATION.md — a fraction of the scrollport, not a pixel constant.
  const ANCHOR_TOP = 0.05;

  // ponytail: localStorage, not the TOML config — Phase 6 owns real settings
  // and will supersede this wholesale. Two keys are cheaper than half a config
  // system that gets thrown away.
  function restore<T extends string>(key: string, valid: Record<T, unknown>, fallback: T): T {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw !== null && raw in valid ? (raw as T) : fallback;
  }

  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode or a locked-down webview. The setting still applies for
      // this session; failing to remember it is not worth an error path.
    }
  }

  let fontMode = $state<FontMode>(restore("vados.fontMode", FONT_MODES, "mixed"));
  let scrollMode = $state<ScrollMode>(restore("vados.scrollMode", SCROLL_MODES, "top"));
  let accent = $state<Accent>(restore("vados.accent", ACCENTS, "indigo"));

  // The label of the row that was clicked is handed in so the character
  // flicker can play on it — a toggle changing state is the one place in this
  // app the glitch is allowed, and the label is the element whose job at that
  // moment is to say *this changed*. See `glitchLabel`.
  function setFontMode(next: FontMode, label?: HTMLElement | null) {
    fontMode = next;
    remember("vados.fontMode", next);
    glitchLabel(label);
  }

  function setScrollMode(next: ScrollMode, label?: HTMLElement | null) {
    scrollMode = next;
    remember("vados.scrollMode", next);
    resyncTail();
    glitchLabel(label);
  }

  function setAccent(next: Accent) {
    accent = next;
    remember("vados.accent", next);
    // Written to :root rather than a Svelte style: prop so the token layer
    // stays the single source, and everything derived from --accent updates
    // with it. applyTokens() carries it to whatever cannot read CSS.
    document.documentElement.style.setProperty("--accent", ACCENTS[next].value);
    applyTokens();
  }

  let settingsOpen = $state(false);
  let settingsBackdrop = $state<HTMLElement | undefined>();
  // #endregion ────────────────────────────────────────────────────────────────

  type Block = {
    id: number;
    cwd: string;
    /** The typed command line. Always plain text, never markdown-rendered. */
    command: string;
    buffer: string;
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
  };

  /** Rendering, clipboard, and export all read a block through this one call. */
  function blockNodes(block: Block): Node[] {
    return block.nodes ?? parse(block.buffer);
  }

  let wrapper: HTMLDivElement;
  let xtermHost: HTMLDivElement;
  let scrollEl: HTMLDivElement;
  let term: Terminal | undefined;

  // Clicking anywhere must refocus xterm — it's the input engine even though
  // it's invisible here, and it silently loses focus to any other element the
  // user clicks (devtools, address bar, etc.).
  function refocus() {
    term?.focus();
  }

  let mode = $state<"blocks" | "raw">("blocks");
  let blocks = $state<Block[]>([
    { id: 0, cwd: "", command: "", buffer: banner, closed: true, exitCode: null, md: false },
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
  const PS_PROMPT = /^PS\s+\S.*?>\s?/;
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
    const id = nextId++;
    const marker = term?.registerMarker(0);
    if (marker) markers.set(id, marker);
    blocks.push({ id, cwd: lastCwd, command, buffer: "", closed: false, exitCode: null, md: true });
  }

  /**
   * Commands VAD/OS answers itself instead of handing to the shell. The `/`
   * prefix is optional on every one of them: `clear` is muscle memory, `/clear`
   * is what anyone who has used a chat client tries first, and neither should
   * be the wrong guess.
   */
  const LOCAL_COMMANDS: Record<string, () => void> = {
    clear: clearBlocks,
    cls: clearBlocks,
    help: showHelp,
  };

  function localCommand(command: string): (() => void) | undefined {
    return LOCAL_COMMANDS[command.trim().replace(/^\/\s*/, "").toLowerCase()];
  }

  function clearBlocks() {
    // A gesture whose destination is about to be unmounted has nothing left to
    // hand off to, and a pending one would be claimed by the next block to
    // mount — which would be a different command entirely.
    killHandoff();
    killReveals();
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
    markers.forEach((m) => m.dispose());
    markers.clear();
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
      ],
    },
    { kind: "heading", level: 2, text: "Keys", tone: null },
    {
      kind: "list",
      items: [
        "Esc — open or close settings",
        "F2 — capture a screenshot",
        "F3 — toggle the debug overlay",
        "Right-click a block — copy its output",
        "Shift + right-click a block — copy it as markdown",
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
    });
  }

  function closeBlock(exitCode: number) {
    const last = currentBlock();
    if (last && !last.closed) {
      last.closed = true;
      last.exitCode = exitCode;
    }
  }

  function rowText(y: number): string {
    return term?.buffer.active.getLine(y)?.translateToString(true) ?? "";
  }

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
  function snapshot(block: Block) {
    if (block.id === rawBlockId) return;
    const marker = markers.get(block.id);
    if (!marker || marker.line < 0 || !term) return;
    const buf = term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    let out = "";
    const cols = term.cols;
    let glued = false;
    for (let y = marker.line; y <= end; y++) {
      if (!buf.getLine(y)) continue;
      const row = rowText(y);
      out += row;
      // A wrapped row continues the same logical line — no newline, otherwise
      // long output gains a break at every terminal width.
      glued = splitWord(row, rowText(y + 1), cols, glued);
      if (!buf.getLine(y + 1)?.isWrapped && !glued) out += "\n";
    }
    // The block starts on the prompt row, so its first logical line is the
    // echoed command — already captured in `block.command`, drop it here.
    block.buffer = out.split("\n").slice(block.command ? 1 : 0).join("\n").replace(/\s+$/, "");
  }

  // Scrolling is motion, so it goes through GSAP like everything else (see
  // ANIMATION.md) — a bare scrollTop assignment teleports.
  const mm = gsap.matchMedia();
  let reduceMotion = false;
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
  type SyncIntent = "grow" | "open" | "switch";

  function syncTail(node: HTMLElement, intent: SyncIntent = "grow") {
    if (!scrollEl || !spacerEl || !isLastBlock(node)) return;
    const anchor = intent !== "grow";
    if (anchor) tailDetached = false;
    // Growth moves every head below it, so the pinned set is stale by now.
    queueStuck();
    const view = scrollEl.clientHeight;

    if (scrollMode === "bottom") {
      // No reservation in this mode — the tail is the target, and spare room
      // under it would mean scrolling to the bottom landed on empty space.
      spacerEl.style.height = "0px";
      const target = scrollEl.scrollHeight - view;
      const distance = target - scrollEl.scrollTop;
      if (distance <= 0) return;
      // Scrolling up is how output that already passed gets read; yanking the
      // view back down on the next chunk would make that impossible.
      if (!anchor && tailDetached) return;
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
    if (reduceMotion) {
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

  function anchorNewBlock(node: HTMLElement) {
    growth ??= new ResizeObserver((entries) => {
      for (const e of entries) syncTail(e.target as HTMLElement);
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

  // The live prompt line is a *sibling* of the output modules, so it appearing
  // grows the output container without resizing anything the observer watches
  // — no sync fires. That is one line of height arriving after the last one,
  // which is exactly the gap that kept "move down" short of the bottom.
  function tailNudge(_node: HTMLElement) {
    requestAnimationFrame(() => syncLast());
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

  /**
   * Resolved value of a design token. The one place JS reads the token layer:
   * xterm keeps its own theme object and does not read CSS variables, and
   * mermaid will join it later, so this is a function from the start rather
   * than a line inside whatever swaps the accent.
   */
  function token(name: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function xtermTheme() {
    return { background: token("--surface-base"), foreground: token("--text") };
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

  /**
   * The stuttered entrance, ported from `Classified-Section.vue`. Position drags
   * in on a jitter ease while opacity blinks up on a *different*, stepped one —
   * the two not tracking each other is the entire effect. Retuned from the
   * portfolio's `strength: 2.4, points: 24` over 0.7s: a section entrance there
   * is a destination, a panel here is on the way to something.
   *
   * `randomize: true` so no two openings stutter identically, `clamp: true` so
   * the jitter never overshoots past the resting position.
   */
  const GLITCH_IN =
    "rough({ template: power2.out, strength: 1.6, points: 14, taper: out, randomize: true, clamp: true })";

  // Panel entrance at ANIMATION.md's settings timing (0.34s). The backdrop and
  // the panel are two tweens over one gesture: the backdrop simply fades, the
  // panel is the focal element and carries the glitch.
  function panelIn(node: HTMLElement) {
    const panel = node.querySelector(".settings");
    gsap.from(node, { autoAlpha: 0, duration: reduceMotion ? 0.1 : 0.34, ease: "power3.out" });
    // Rises into place rather than sliding in from the right. A lateral entry
    // is the tell of a drawer, and this is not one — see decisions.md. The
    // amplitude is a `dv` distance.
    if (panel) {
      const rise = window.innerHeight * 0.02;
      if (reduceMotion) {
        // Skipped, not shortened. Simulated malfunction is exactly the class of
        // motion that reads as a real fault to someone who cannot filter it,
        // and this is a terminal, where a real fault is plausible.
        gsap.from(panel, { autoAlpha: 0, duration: 0.1 });
      } else {
        // Travel and opacity are deliberately two tweens with two eases and two
        // durations. Putting them on one tween is the version of this effect
        // that reads as a plain fade with a wobble.
        gsap.from(panel, { y: rise, duration: 0.35, ease: GLITCH_IN });
        gsap.from(panel, { autoAlpha: 0, duration: 0.28, ease: "steps(3)", delay: 0.05 });
      }
    }
    return {
      destroy() {
        gsap.killTweensOf([node, panel]);
      },
    };
  }

  // #region Character flicker ─────────────────────────────────────────────────
  // The portfolio's per-word glitch, spent where it does work. There is no idle
  // glitch in this app: the original is an infinite CSS animation idle 97% of
  // its cycle, which is a permanently non-idle compositor, and PERFORMANCE.md
  // budgets idle CPU at literally zero. Fired once on a real state change it is
  // the same look for none of the cost, and it lands on the one element whose
  // job at that moment is to say *this changed*.

  /** Roll per character. Floored at one, or a short label silently does nothing. */
  const GLITCH_CHANCE = 0.1;

  /**
   * Flicker a toggle's own label. **Only ever call this on static text.** It
   * rebuilds the element's children, which detaches any text node Svelte is
   * holding a reference to — safe for these labels, which come from the frozen
   * `FONT_MODES` / `SCROLL_MODES` tables and are written once at mount, and
   * never safe for command output, which Svelte updates on every PTY chunk.
   */
  function glitchLabel(label: HTMLElement | null | undefined) {
    if (!label || reduceMotion) return;
    const text = label.textContent ?? "";
    const chars = [...text];
    if (!chars.length) return;

    const picked = new Set<number>();
    chars.forEach((_, i) => Math.random() < GLITCH_CHANCE && picked.add(i));
    if (!picked.size) picked.add(Math.floor(Math.random() * chars.length));

    label.textContent = "";
    const spans: HTMLElement[] = [];
    for (const [i, ch] of chars.entries()) {
      if (!picked.has(i)) {
        label.append(ch);
        continue;
      }
      const span = document.createElement("span");
      span.className = "glitch-char";
      span.textContent = ch;
      label.append(span);
      spans.push(span);
    }

    // The RGB split rides on the class for the duration rather than being
    // tweened: `text-shadow` interpolates as a string, and a stepped ease over a
    // value GSAP cannot interpolate is a snap dressed up as an animation. The
    // motion is the stepped `x`; the split is what it is stepping through.
    gsap.to(spans, {
      keyframes: [
        { x: 2, duration: 0.06 },
        { x: -1, duration: 0.06 },
        { x: 0, duration: 0.06 },
      ],
      ease: "steps(1)",
      stagger: 0.01,
      // Tear the wrappers down on completion — same rule as reverting a split.
      // The effect is over; the DOM cost is not.
      onComplete: () => (label.textContent = text),
    });
  }

  /** The label inside a settings row, which is what the flicker is played on. */
  function optionLabel(button: EventTarget | null) {
    return (button as HTMLElement | null)?.querySelector<HTMLElement>(".settings-option-label");
  }
  // #endregion ────────────────────────────────────────────────────────────────

  // Svelte tears an `{#if}` block out the instant the flag flips, so an exit
  // tween started from the click handler would animate a node that is already
  // gone. The tween owns the flag instead: it clears `settingsOpen` when it
  // lands. Every close path goes through here — there is no other way to shut
  // the panel, by design.
  function closeSettings() {
    const panel = settingsBackdrop?.querySelector(".settings");
    if (!settingsBackdrop || !panel) {
      settingsOpen = false;
      return;
    }
    gsap.killTweensOf([settingsBackdrop, panel]);
    // Faster than the entrance and eased *in*, so it accelerates away. The
    // panel is losing focus, so it gets no overshoot — see ANIMATION.md.
    gsap.to(panel, { autoAlpha: 0, y: window.innerHeight * 0.02, duration: 0.2, ease: "power2.in" });
    gsap.to(settingsBackdrop, {
      autoAlpha: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => (settingsOpen = false),
    });
  }

  function toggleSettings() {
    if (settingsOpen) closeSettings();
    else settingsOpen = true;
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
  // one timeline — the input retracts (anticipation), the new block pops out of
  // that same retracted size, then travels to its resting place. The size
  // continuity between beat 1 and beat 2 is the entire trick; it is what says
  // "this came from that" rather than "a thing appeared".
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
   * Retract distance, in `dvw`. A constant `scaleX` is wrong here: the same
   * factor is a small pull on a narrow window and a slapstick squash on a wide
   * one. The gesture is a fixed visual distance and the scale is derived from
   * it, so it looks identical at every width.
   *
   * ponytail: 6dvw and the 0.6 floor are both guesses carried over from
   * ANIMATION.md's own "Open" section — tune against the real bar, not here.
   */
  const RETRACT_DVW = 6;

  /**
   * How late a block may mount and still be treated as the one the user just
   * submitted. Past this the gesture is stale — the bar has settled and the
   * scroll has moved, so flying in from a remembered position would land wrong.
   * The block gets the plain entrance instead, which is always correct.
   */
  const HANDOFF_STALE_MS = 250;

  let inputBarEl: HTMLDivElement | undefined = $state();
  /** Every animation in the current gesture, so an interrupt kills them together. */
  let handoffParts: gsap.core.Animation[] = [];
  /** Set by beat 1, claimed by the next block to mount. */
  let handoffPending = false;
  let handoffAt = 0;

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

    const width = inputBarEl.getBoundingClientRect().width;
    const retract = (RETRACT_DVW / 100) * window.innerWidth;
    // Floored: on a narrow window the retract must not eat the whole bar.
    const scaleX = Math.max(0.6, (width - retract) / width);

    const tl = gsap.timeline({ onComplete: () => gsap.set(inputBarEl!, { clearProps: "scale,scaleX" }) });
    // Beat 1 — focal. `back.in` compresses past the target and releases.
    tl.to(inputBarEl, { scaleX, duration: 0.12, ease: "back.in(2.4)" }, 0);
    // The source returns to rest at the instant the block leaves it —
    // simultaneous is what makes the two read as one gesture rather than two
    // things that happened. `scaleX` only: a plain `scale` would squash the
    // bar's height, which never retracted.
    settle(inputBarEl, scaleX, { prop: "scaleX", tl, at: 0.09 });
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
        // The block spawns *at the input bar*, small, and travels up to its own
        // slot growing as it goes. Both numbers are read off the bar rather
        // than picked: the spawn size is a proportion of the source, which is
        // what makes the size continuity read as "this came out of that".
        const bar = inputBarEl.getBoundingClientRect();
        const rest = node.getBoundingClientRect();
        const from = {
          x: bar.left + bar.width / 2 - (rest.left + rest.width / 2),
          y: bar.top + bar.height / 2 - (rest.top + rest.height / 2),
          scaleX: (bar.width * 0.4) / rest.width,
          scaleY: (bar.height * 0.9) / rest.height,
        };
        // The block's clock starts at its own mount, so the beat-2 offset is
        // whatever is left of the 0.09s the bar needed — not the full 0.09
        // again, which would drift the two halves apart by however long the
        // mount took.
        const at = Math.max(0, 0.09 - (performance.now() - handoffAt) / 1000);
        const scrollTop0 = scrollEl.scrollTop;
        const tl = gsap.timeline({
          // The transform is scaffolding. Left behind it makes the block a
          // containing block for anything positioned inside it, and an
          // identity matrix is not free to leave on a scrollback's worth of
          // sections.
          onComplete: () => {
            gsap.set(node, { clearProps: "transform,opacity,visibility" });
            // The block has landed, so its content may start arriving.
            releaseReveal();
          },
        });
        tl
          // Beats 2 and 3 are one movement, not two: the travel and the growth
          // run together, and the pop is where they land. Separating them read
          // as a thing appearing and then moving.
          .fromTo(node, { ...from, autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1, ease: "power1.out" }, at)
          .to(
            node,
            {
              x: 0,
              y: 0,
              duration: 0.22,
              ease: "power3.out",
              // The bar is fixed to the window; the block lives in the scroll
              // container. `from.y` was measured across that boundary, so every
              // pixel the container scrolls mid-flight moves the block's real
              // start point away from the bar — which is why scrolling during a
              // handoff made the gesture fly in from nowhere. Re-add the scroll
              // that has happened since, faded out by the tween's own remaining
              // distance so it still converges on 0 rather than landing offset.
              modifiers: {
                y: (value: string) => {
                  const y = parseFloat(value);
                  const left = from.y ? y / from.y : 0;
                  return `${y + (scrollEl.scrollTop - scrollTop0) * left}px`;
                },
              },
            },
            at,
          )
          // The pop is the arrival, so it is the scale that overshoots and it
          // finishes last. Focal, hence the elastic — the eye follows it in.
          .to(node, { scaleX: 1, scaleY: 1, duration: 0.26, ease: "back.out(2)" }, at);
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

  // #region Typewriter reveal ─────────────────────────────────────────────────
  // The signature animation. Output arrives one *rendered row* at a time — a
  // visual line as the browser laid it out, so a logical line that wraps across
  // three rows produces three reveals — each wiped left to right and quantized
  // to a character grid, which is what makes a smooth wipe read as typing.
  //
  // **This deviates from ANIMATION.md's prescribed mechanism, deliberately.**
  // That file specifies `SplitText` with `type: "lines"`. SplitText works by
  // replacing an element's `innerHTML` with one wrapper per row, and `revert()`
  // restores a saved HTML *string* — which detaches every text node Svelte is
  // holding a reference to. Output elements are re-rendered from the parser on
  // every PTY chunk, so the first reveal of a still-streaming element would be
  // the last update that element ever received: the block would freeze at
  // whatever text it happened to hold when the split ran, while the shell went
  // on producing output nobody could see. That is a lifecycle conflict, not a
  // tuning problem, and it only appears on streaming content — which is all of
  // this app's content.
  //
  // So the reveal is a `clip-path` staircase written on the element itself:
  // rows above the cursor fully visible, the cursor's row wiped to a character
  // boundary, rows below it clipped away. Nothing in the DOM is touched, which
  // means there is nothing to revert and nothing to leak — ANIMATION.md's
  // "revert splits after reveal" guard stops being a requirement rather than
  // going unmet. It is also one tween per element instead of one per row, with
  // the 0.12s row cadence expressed as the tween's duration.
  //
  // Two properties this depends on, both easy to break:
  //
  //  - **The clip is permanent while the element can still grow**, not applied
  //    for a tween and cleared after. Cleared, the next chunk's text is on
  //    screen for the frame between Svelte writing it and this pass running —
  //    text appearing at full strength, vanishing, then typing itself in. It is
  //    also why the hide happens in the action rather than in the pass: an
  //    action runs during Svelte's mount flush, before the first paint.
  //  - **The reveal never targets an element carrying chrome.** A code block's
  //    box, its background and its border are already there and stay there;
  //    only the text inside it types. Clipping the container would animate the
  //    box in, which is a different (and wrong) statement about what happened.
  //
  // What is preserved exactly: the row is the unit, the wipe is a `clipPath`
  // and never a slide, and the wipe is stepped rather than smooth.
  //
  // The one thing genuinely lost is the overlap. ANIMATION.md's numbers are a
  // 0.225s wipe every 0.096s, so consecutive rows are in flight together; a
  // single cursor cannot be on two rows at once, so each row's wipe here lasts
  // one stagger interval instead. The last row still gets its full 0.225s: the
  // duration is `(pending - 1) * stagger + REVEAL_ROW`, so a one-row reveal —
  // a heading, a result line, the echoed command — is exactly the tween the
  // table specifies.

  /** Row cadence — how long the cursor takes to move from one row to the next. */
  const REVEAL_STAGGER = 0.096;
  /** The wipe across a single row, per ANIMATION.md's table. */
  const REVEAL_ROW = 0.225;
  /** Past this many rows pending, reveal instantly — see flood control below. */
  const FLOOD_ROWS = 40;

  /** Every element under reveal → how many of its rows are already revealed. */
  const revealed = new Map<HTMLElement, number>();
  /** In-flight reveals, so an interrupt can kill them and `clear` can bin them. */
  const revealing = new Map<HTMLElement, gsap.core.Tween>();
  let revealFrame = 0;
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
   */
  function reveal(node: HTMLElement) {
    revealed.set(node, 0);
    if (!reduceMotion) rest(node, 0);
    queueReveal();
    return {
      destroy() {
        revealing.get(node)?.kill();
        revealing.delete(node);
        revealed.delete(node);
      },
    };
  }

  function queueReveal() {
    revealFrame ||= requestAnimationFrame(runReveals);
  }

  /**
   * Row geometry for one element, measured fresh — the wrap it has *now*, at
   * the width it has *now*. Rows are visual rows, so the same text at half the
   * width is twice as many of them and gets twice as many reveals.
   *
   * The row band is the real height divided by the row count, not the computed
   * `line-height`. The two are the same number for uniform text, and where
   * they are not — a list with per-item spacing — dividing the real height is
   * what guarantees the last row's bottom edge lands on the element's bottom
   * edge. That is load-bearing: the resting clip below sits at exactly that
   * edge, and a band even a pixel short would clip the final row forever.
   */
  function metricsOf(node: HTMLElement) {
    const style = getComputedStyle(node);
    const size = parseFloat(style.fontSize);
    const line = parseFloat(style.lineHeight) || size * 1.5;
    const height = node.scrollHeight;
    const rows = Math.max(1, Math.round(height / line));
    // Character cells across the element — how finely the wipe is quantized.
    // Approximate on a proportional font by design: a cell too many or too few
    // is invisible. Floored so a narrow element still steps rather than sliding.
    const cells = Math.max(8, Math.round(node.clientWidth / (size * 0.6)));
    return { rows, row: height / rows, cells };
  }

  /**
   * Park an element at `count` revealed rows: everything above visible,
   * everything below clipped away.
   *
   * **The clip persists between chunks.** It is not applied for the duration of
   * a tween and cleared afterwards — cleared, the next chunk's text is on
   * screen for the frame between Svelte writing it and the reveal pass running,
   * which is the flash this whole design exists to avoid. An element only stops
   * being clipped when it can no longer grow.
   */
  function rest(node: HTMLElement, count: number, m = metricsOf(node)) {
    node.style.clipPath = revealClip(count, m.row, m.cells);
  }

  /** Nothing more can arrive in this element, so nothing more may be hidden. */
  function unclip(node: HTMLElement) {
    node.style.clipPath = "";
  }

  /**
   * A resize reflowed the text, so every tracked element has a new row count
   * for the same content — and rows that only exist because the window got
   * narrower have already been read. Without this, dragging the window edge
   * replays the reveal over output that has been on screen for minutes.
   */
  function settleReveals() {
    for (const [node, tween] of [...revealing]) tween.progress(1).kill();
    revealing.clear();
    for (const node of revealed.keys()) {
      const m = metricsOf(node);
      revealed.set(node, m.rows);
      rest(node, m.rows, m);
    }
  }

  /** Ctrl+C, `clear`, unmount. Every in-flight reveal lands and is dropped. */
  function killReveals() {
    for (const [node, tween] of [...revealing]) {
      tween.progress(1).kill();
      unclip(node);
    }
    revealing.clear();
    for (const node of revealed.keys()) unclip(node);
    revealed.clear();
    cancelAnimationFrame(revealFrame);
    revealFrame = 0;
  }

  /**
   * The rows of `node` that intersect the scroll viewport right now, as a
   * half-open `[from, to)` range of row indices.
   *
   * The reveal is only ever allowed to animate inside this window. Rows above
   * it have scrolled past and rows below it are off the bottom edge — animating
   * either burns a tween on something nobody can see, and on a long command
   * that is most of the output. `from >= to` means the element is entirely off
   * screen.
   */
  function visibleRows(node: HTMLElement, m: { rows: number; row: number }) {
    if (!scrollEl) return { from: 0, to: 0 };
    const view = scrollEl.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const from = Math.max(0, Math.floor((view.top - rect.top) / m.row));
    const to = Math.min(m.rows, Math.ceil((view.bottom - rect.top) / m.row));
    return { from, to };
  }

  function runReveals() {
    revealFrame = 0;
    if (reduceMotion) return;
    // Only the last block can still be growing, so everything above it is
    // final and can stop being tracked — otherwise this map is one entry per
    // rendered node for the life of the session.
    const last = scrollEl?.querySelector("section:last-of-type");
    for (const node of [...revealed.keys()]) {
      if (revealing.has(node)) continue;
      if (last && !last.contains(node)) {
        // Final content: it can never grow again, so it must never be clipped
        // again either. This is also the only place a partially revealed
        // element gets shown in full, which is the safety net under every
        // row-count assumption in this region.
        unclip(node);
        revealed.delete(node);
        continue;
      }
      revealElement(node);
    }
  }

  function revealElement(node: HTMLElement) {
    const done = revealed.get(node) ?? 0;
    const m = metricsOf(node);
    const rows = m.rows;
    if (rows - done <= 0) return;
    // Held rather than skipped: the rows are still owed, they just cannot start
    // until the container has arrived. The handoff re-queues on landing.
    if (revealHeld) return;

    // The animated span is the intersection of what is owed with what is on
    // screen. Rows above the viewport have already been scrolled past and rows
    // below it are off the bottom edge, so both are simply shown: a reveal
    // nobody can watch is cost with no effect, and on a long command it is
    // nearly all of the output. This is also what makes "move down" cheap —
    // the tail is the only thing on screen, so the tail is the only thing that
    // ever animates, however many rows the command produced.
    const win = visibleRows(node, m);
    const start = Math.max(done, win.from);
    const target = Math.min(rows, win.to);
    const pending = target - start;
    // Flood control, and the same treatment for a block nobody is looking at.
    // At 0.096s a row, forty rows is already ~3.8s of backlog — past that the
    // terminal is lying about what has finished. `npm install` emits thousands.
    if (pending <= 0 || pending > FLOOD_ROWS) {
      revealed.set(node, rows);
      // Parked at the full row count, which shows everything — but still
      // *clipped*, so the next chunk's rows are hidden the frame they land.
      rest(node, rows, m);
      return;
    }
    // "Move down" exists for the reader who wants to be current, so playing the
    // reading-paced cadence there contradicts the point of the mode. The
    // stagger scales with the backlog instead, converging on instant and
    // hitting the flood threshold at the same place it would anyway. The wipe
    // and the stepping are identical in both modes — only the rate changes, or
    // the setting becomes a choice between two different products.
    const stagger = revealStagger(pending, REVEAL_STAGGER, FLOOD_ROWS, scrollMode === "bottom");

    // One tween walks a row cursor from `done` to `rows` and the clip is
    // written from it: everything above the cursor at full width, the cursor's
    // own row wiped to the nearest character boundary, everything below hidden.
    // Rows that arrive mid-flight are simply below the cursor, so they are
    // already clipped and get picked up by the pass that follows.
    const at = { row: start };
    // Re-parked synchronously against *this* pass's metrics. The element was
    // already clipped — it has been since it mounted — but a chunk that
    // changed the wrap changed the row band with it.
    rest(node, start, m);
    const tween = gsap.to(at, {
      row: target,
      duration: (pending - 1) * stagger + REVEAL_ROW,
      ease: "none",
      onUpdate() {
        node.style.clipPath = revealClip(at.row, m.row, m.cells);
      },
      onComplete() {
        revealing.delete(node);
        revealed.set(node, rows);
        // Parked, not cleared. The element may still grow, and an unclipped
        // element shows the next chunk's text for the frame before the reveal
        // pass runs — which is the flash this design exists to avoid. The clip
        // at the full row count hides nothing, because the row band is the
        // element's own height divided by its own row count.
        rest(node, rows, m);
        queueReveal();
      },
    });
    revealing.set(node, tween);
  }
  // #endregion ────────────────────────────────────────────────────────────────

  /**
   * A block's result line, which only ever mounts when the command finishes —
   * so the entrance *is* the completion pulse. Success and failure get the same
   * motion; the colour already carries the difference, and making failure
   * animate harder would be saying it twice.
   */
  function resultPulse(node: HTMLElement) {
    if (!reduceMotion) {
      gsap.from(node, {
        autoAlpha: 0,
        scale: 1.16,
        duration: 0.3,
        ease: "power2.out",
        transformOrigin: "left center",
        clearProps: "transform,opacity,visibility",
      });
    }
    return {
      destroy() {
        gsap.killTweensOf(node);
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

  // Right-click copies a block's output. Shift+right-click copies it
  // reconstructed as real markdown syntax, via the same parser that drives
  // the on-screen rendering — one source of truth for "what is a heading".
  function copyBlock(e: MouseEvent, block: Block) {
    e.preventDefault();
    const asMarkdown = e.shiftKey;
    const text = asMarkdown ? toMarkdown(blockNodes(block)) : block.buffer;
    navigator.clipboard.writeText(text);
    notify(asMarkdown ? "Copied as markdown" : "Copied output");
  }

  onMount(() => {
    // Before the terminal exists: the token layer defaults to indigo, so a
    // restored accent has to land before anything reads a resolved value.
    document.documentElement.style.setProperty("--accent", ACCENTS[accent].value);

    // Local alias keeps the non-undefined narrowing inside the callbacks below;
    // `term` stays module-scoped for refocus()/openBlock()/snapshot().
    const t = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 14,
      // Block text is read back from this buffer, so scrollback is the real
      // cap on how much of a long command's output survives.
      // ponytail: fixed 20k rows; virtualise blocks if memory ever matters.
      scrollback: 20000,
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
      // Esc belongs to the shell first. In raw mode it is how you leave vim's
      // insert mode, so it is never intercepted there — a terminal that eats
      // Esc is broken in a way no settings panel pays for. In block mode it
      // opens the panel, which costs PSReadLine's clear-line binding; see
      // tasks.md, that trade is recorded rather than assumed.
      if (e.key === "Escape" && mode !== "raw") {
        if (e.type === "keydown") {
          e.preventDefault();
          toggleSettings();
        }
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
        pendingCommand = "";
      } else if (data === "B") {
        promptReady = true;
        booted = true;
      } else if (data.startsWith("D")) {
        // Final snapshot must happen *here*, not in the write callback: the
        // same chunk usually carries the next prompt, and by the time that
        // callback runs the cursor has already moved onto the prompt row.
        const block = currentBlock();
        if (block && !block.closed) snapshot(block);
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
            for (let y = start; y < buf.length; y++) {
              const line = buf.getLine(y);
              if (!line || (y > start && !line.isWrapped)) break;
              // Untrimmed: every row but the last is padded out to the full
              // width, and that padding is what makes the column maths below
              // line up with what the shell thinks the cursor offset is.
              row += line.translateToString(false);
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
            cursorCol = Math.max(
              0,
              (cursorRow - start) * t.cols + buf.cursorX - (row.length - stripped.length),
            );
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
        // New rows may have landed. The pass itself runs on the next frame, by
        // which point Svelte has flushed this buffer change into the DOM —
        // measuring rows before that would measure the previous chunk's layout.
        queueReveal();
      });
    };

    const ready = invoke("pty_spawn", {
      cols: t.cols,
      rows: t.rows,
      cwd: null,
      onData,
    });

    t.onData((data) => {
      lastSent = data;
      // The whole send sequence, not just the last event: a stray character
      // arriving as its own `onData` is invisible in a single-slot readout.
      debugPush(`key ${JSON.stringify(data)}`);
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
        // Prefer the mirrored, edited screen text when it arrived in time;
        // fall back to the raw send buffer when it didn't (paste race above).
        const command = (input.trim() || pendingCommand.trim());
        const local = command ? localCommand(command) : undefined;
        const typed = input.length || pendingCommand.length;
        if (command) {
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

    const observer = new ResizeObserver(() => {
      syncSize();
      // The debug overlay reports window dimensions, and a resize is the one
      // thing that changes them without any PTY traffic to tick on.
      if (debugOn) debugTick++;
      // Reflow moved every row; re-read the open block at the new width.
      const block = currentBlock();
      if (block && !block.closed) snapshot(block);
      // Same reflow, other consumer: rows that appeared because the window
      // narrowed are not new content and must not be revealed again.
      settleReveals();
      // A cached rect from before the resize positions the hover ring wrong.
      hotRect = undefined;
      ready.then(() => invoke("pty_resize", { cols: t.cols, rows: t.rows }));
    });
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
      scrollTween?.kill();
      killHandoff();
      killReveals();
      clearTimeout(noticeTimer);
      mm.revert();
      t.dispose();
    };
  });
</script>

<svelte:window onfocus={refocus} />

<!-- The font mode resolves to two custom properties here and nothing reads the
     mode itself, so every consumer below is `var(--font-outside)` or
     `var(--font-inside)` and stays unaware of how many modes exist. -->
<div
  class="app"
  style:--font-outside={FONT_MODES[fontMode].outside}
  style:--font-inside={FONT_MODES[fontMode].inside}
  onclick={refocus}
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
          <section
            class="block"
            class:open={!block.closed}
            role="group"
            use:blockEnter
            use:anchorNewBlock
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
            {#each blockNodes(block) as node}
              {#if node.kind === "heading"}
                {#if node.level === 3}
                  <h3 class="md-heading md-heading-3" class:warn={node.tone === "warn"} class:ok={node.tone === "ok"} use:reveal>{node.text}</h3>
                {:else}
                  <h2 class="md-heading" class:warn={node.tone === "warn"} class:ok={node.tone === "ok"} use:reveal>{node.text}</h2>
                {/if}
              {:else if node.kind === "list"}
                <ul class="md-list" use:reveal>
                  {#each node.items as item}
                    <li>{item}</li>
                  {/each}
                </ul>
              {:else if node.kind === "code"}
                <!-- One span per token run, no whitespace between them: any
                     newline the template introduced would land inside a `pre`
                     and become a real line break. -->
                <pre class="code-block"><code class="code-text" use:reveal>{#each node.spans as span}{#if span.token}<span class="tok-{span.token}">{span.text}</span>{:else}{span.text}{/if}{/each}</code></pre>
                <!-- Trailing spacer, not margin on .code-block itself — a
                     margin would also apply above the block, doubling up
                     against the block-entrance gap already set by .scroll's
                     flex `gap`. -->
                <div class="code-spacer"></div>
              {:else}
                <!-- A link is the one token that is also a control, so it is an
                     `<a>` rather than a styled `<code>`. `href` is the matched
                     text itself and the match starts at `http`, so a scheme
                     Tauri would refuse to open cannot get in here. -->
                <pre class="block-body" class:bold={node.bold} use:reveal>{#each node.parts as part}{#if part.kind === "link"}<a class="inline-link" href={part.text} target="_blank" rel="noreferrer">{part.text}</a>{:else if part.code}<code class="inline-code {part.kind ?? ''}">{part.text}</code>{:else}{part.text}{/if}{/each}</pre>
              {/if}
            {/each}
            {#if block.closed && block.cwd}
              <div class="block-result" class:ok={block.exitCode === 0} class:err={block.exitCode !== 0} use:resultPulse>
                {block.exitCode === 0 ? "done" : `exit ${block.exitCode}`}
              </div>
            {/if}
          </section>
        {/if}
      {/each}
      {#if atPrompt}
        <!-- Mirrors the docked input bar into the scroll stream, so the very
             first prompt (and every prompt) has a live "> " line here too,
             not only in the fixed bar. Becomes a real block on Enter. -->
        <div class="block-head live ghost" use:tailNudge>
          <span class="ghost-mark">&gt;</span> {promptCwd}<span class="block-sep">&nbsp;|&nbsp;</span><span class="live-text">{input}</span>
        </div>
      {/if}
      <!-- Height is written directly by `syncTail`, not bound to state: the
           scroll position is read back in the same call, and a reactive update
           would not be in the layout yet. -->
      <div class="tail-space" bind:this={spacerEl}></div>
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

  <!-- Esc. Overlay in place over the terminal with a blurred backdrop, per
       decisions.md — not a window, and not an extension surface. -->
  {#if settingsOpen}
    <div
      class="settings-backdrop"
      bind:this={settingsBackdrop}
      use:panelIn
      onclick={(e) => { e.stopPropagation(); closeSettings(); }}
      role="presentation"
    >
      <div class="settings" onclick={(e) => e.stopPropagation()} role="presentation">
        <div class="settings-title">Settings</div>
        <div class="settings-group">Font</div>
        {#each Object.entries(FONT_MODES) as [key, def]}
          <button
            class="settings-option"
            class:active={fontMode === key}
            onclick={(e) => setFontMode(key as FontMode, optionLabel(e.currentTarget))}
          >
            <!-- The label renders in the font that mode gives to text outside
                 a container, so the row is its own sample. Bound to the data
                 rather than matched by position — an added mode would break a
                 nth-child mapping silently. -->
            <span class="settings-option-label" style:font-family={def.outside}>{def.label}</span>
            <span class="settings-option-hint">{def.hint}</span>
          </button>
        {/each}
        <div class="settings-group">Accent</div>
        <!-- Swatches, not labelled rows: the value being chosen is a colour,
             so the control should be the colour. -->
        <div class="swatches">
          {#each Object.entries(ACCENTS) as [key, def]}
            <button
              class="swatch"
              class:active={accent === key}
              style:background={def.value}
              title={def.label}
              aria-label={def.label}
              onclick={() => setAccent(key as Accent)}
            ></button>
          {/each}
        </div>
        <div class="settings-group">On a new command</div>
        {#each Object.entries(SCROLL_MODES) as [key, def]}
          <button
            class="settings-option"
            class:active={scrollMode === key}
            onclick={(e) => setScrollMode(key as ScrollMode, optionLabel(e.currentTarget))}
          >
            <span class="settings-option-label">{def.label}</span>
            <span class="settings-option-hint">{def.hint}</span>
          </button>
        {/each}
        <div class="settings-foot">Esc to close</div>
      </div>
    </div>
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
    <div class="input-bar ghost" bind:this={inputBarEl} use:growUpward>
      <span class="input-cwd"><span class="ghost-mark">&gt;</span> {promptCwd}</span><span class="block-sep">&nbsp;|&nbsp;</span><span class="input-text">{input.slice(0, cursorCol)}<span
          class="caret"
          class:idle={!atPrompt}
          class:typing
          bind:this={caretEl}
        ></span>{input.slice(cursorCol)}</span>
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
  }

  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: var(--surface-base);
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

  /* #region ── settings overlay ─────────────────────────────────────────── */
  .settings-backdrop {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    /* Inset on every side: the panel is a module resting over the terminal,
       not a drawer welded to the frame. See decisions.md. */
    padding: 4dvh 3dvw;
    background: var(--scrim);
    backdrop-filter: blur(6px);
  }

  .settings {
    /* Both bounds are viewport units, so nothing here is a fixed minimum:
       30dvw is the floor on a wide window, 88dvw the ceiling on a narrow one,
       and the middle term is only a preference between the two. A flat 30dvw
       failed the other way — the panel's own text does not shrink with the
       window, so a purely proportional width goes unreadable well before it
       goes small. See decisions.md. */
    width: clamp(30dvw, 32rem, 88dvw);
    max-height: 88dvh;
    box-sizing: border-box;
    padding: 18px 16px;
    background: var(--surface-raised);
    /* Border on all four sides and a real shadow — a floating surface has to
       read as lifted off the background, or the inset just looks like a gap. */
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    box-shadow: var(--shadow-float);
    font-family: var(--font-outside);
    font-size: 13px;
    color: var(--text);
    overflow-y: auto;
  }

  .settings-title {
    margin-bottom: 18px;
    color: var(--accent);
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .settings-group {
    margin-bottom: 8px;
    color: var(--text-ghost);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-size: 11px;
  }

  .settings-option {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    width: 100%;
    margin-bottom: 6px;
    padding: 9px 12px;
    background: var(--surface-inset);
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.25s ease, background 0.25s ease;
  }

  .settings-option:hover {
    border-color: var(--accent-border-soft);
  }

  .settings-option.active {
    border-color: var(--accent);
    background: var(--accent-surface);
  }

  /* One character of a toggle's label, mid-flicker. The RGB split is static for
     the 0.18s the wrapper exists — the motion is the stepped `x` GSAP writes,
     and `text-shadow` is not a value worth tweening (see `glitchLabel`). The
     wrapper is torn down on completion, so this only ever matches during it. */
  /* `:global` is load-bearing, not defensive: these spans are built in JS, so
     they never carry Svelte's scoping class and a scoped selector would miss
     them entirely — silently, with the flicker reduced to a stepped nudge. */
  :global(.glitch-char) {
    display: inline-block;
    text-shadow:
      -1.5px 0 var(--err),
      1.5px 0 var(--accent);
  }

  .settings-option-hint {
    flex: none;
    color: var(--text-ghost-faint);
    font-size: 11px;
  }

  .swatches {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }

  .swatch {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    cursor: pointer;
    /* The selected ring is drawn with box-shadow, not a thicker border — a
       border change would resize the swatch and shift the row. */
    box-shadow: none;
    transition: box-shadow 0.25s ease;
  }

  .swatch.active {
    box-shadow: 0 0 0 2px var(--surface-raised), 0 0 0 3px var(--text);
  }

  .settings-foot {
    margin-top: 14px;
    color: var(--text-ghost-weak);
    font-size: 11px;
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

  .block-head.live {
    padding: 2px 2px;
    /* Outside a container, so it follows the outside slot rather than the
       block chrome it visually rhymes with. */
    font-family: var(--font-outside);
    line-height: 18px;
  }

  /* The uncapped copy of the input: the bar stops at three rows, this shows the
     whole command however long it runs. `pre-wrap` belongs on the text span and
     never on the line's container — on the container it also preserves the
     template's own newline and indentation, which is what knocked this line out
     of alignment with the bar below it. */
  .live-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Mirrored, not authoritative — this is a reflection of xterm's cursor row,
     and it stops existing the moment Enter commits it to a real block. Dull
     translucent white says that: present and readable, visibly not yet the
     record. `.block-command` below is the same text after it commits, at full
     weight. Same treatment in the docked bar, since it is the same text. */
  .live-text,
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
    right: 12px;
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
  }

  .input-cwd {
    flex: none;
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

  .ghost-mark {
    color: var(--accent);
  }

  .input-text {
    /* Colour is set with .live-text above — same text, same treatment. */
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
