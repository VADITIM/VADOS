<script lang="ts">
  import { onMount } from "svelte";
  import { Channel, invoke } from "@tauri-apps/api/core";
  // Tauri's own drag-and-drop, never the HTML5 `drop` event. See `watchDrops`.
  import { getCurrentWebview } from "@tauri-apps/api/webview";
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
  import { revealClip, revealHead, revealStagger } from "$lib/reveal.js";
  // Which reveal a run of parsed text gets, and in what order — read off the
  // classes the parser's own decisions put on it. Checked without a browser:
  // `node src/lib/reveal-plan.check.mjs`.
  import { labelGroups } from "$lib/reveal-plan.js";
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
    step,
    tokenAt,
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

  /**
   * Where each font mode sits on the settings X, in the table's own order.
   * Positional by index rather than by name so the two lists cannot drift
   * apart quietly: a fifth mode reads `undefined` here and the wedge is visibly
   * unstyled, which is the failure anyone would rather have.
   */
  const WEDGES = ["wedge-tl", "wedge-tr", "wedge-bl", "wedge-br"] as const;

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

  // Which reveal a piece of output gets is decided by whether it can still
  // change. The typewriter is right for text that is *still arriving* — it is a
  // picture of a program writing, and it is only honest while something is being
  // written. It is wrong for text that was complete before it reached the
  // screen, and running it there is what made it look messy: it was animating
  // the wrong thing, not animating wrongly.
  //
  // So the typewriter is the rule *within* one setting rather than the setting
  // itself: finished text gets the label reveal (a bar sweeps the coloured
  // tokens, staggered by how much they matter) with a character wave under the
  // grey prose between them, and only the one element still growing gets typed.
  //
  // The switch is whether any of that runs at all. `instant` is the answer for
  // a reader who wants the output and not the picture of it: every element
  // rises into place as one, the same gesture the settings panel enters with,
  // and no text is ever typed or waved. It governs command output only — chrome
  // (the panel, the suggestion strip, a block's border draw) is a response to a
  // gesture the user just made and keeps its animation either way.
  const REVEAL_MODES = {
    typewriter: {
      label: "Typewriter",
      hint: "Type live output, sweep what is final",
    },
    instant: {
      label: "Instant",
      hint: "Output rises into place, no typing",
    },
  } as const;

  type RevealMode = keyof typeof REVEAL_MODES;

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
    red: { label: "Red", value: "#e5484d" },
    green: { label: "Green", value: "#30c98d" },
    pink: { label: "Pink", value: "#ef5da8" },
    // Not #fff: the accent is a *tint* source — every border and surface derives
    // from it with color-mix, and pure white washes those out to grey. A hair
    // off neutral keeps the derived layer readable.
    white: { label: "White", value: "#e8e8ec" },
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
  let revealMode = $state<RevealMode>(restore("vados.revealMode", REVEAL_MODES, "typewriter"));

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

  // Only what mounts after the switch changes: an element's reveal is decided
  // once, in the action, and re-deciding it for text already on screen would
  // replay output the reader has read.
  function setRevealMode(next: RevealMode, label?: HTMLElement | null) {
    revealMode = next;
    remember("vados.revealMode", next);
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
  /**
   * The selected run of the mirrored input, `[from, to)` in input columns.
   * Empty when `to <= from`. Read off the screen cells, not off any shell's
   * key bindings — see the scan in the write callback.
   */
  let selFrom = $state(0);
  let selTo = $state(0);
  // The caret splits the line into two runs, and each is segmented against the
  // same absolute range so the selection cannot swallow the caret between them.
  const headSegments = $derived(segments(input.slice(0, cursorCol), 0, selFrom, selTo));
  const tailSegments = $derived(segments(input.slice(cursorCol), cursorCol, selFrom, selTo));
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
        "Tab — list what this folder offers for the word being typed",
        "Up / Down — pick a suggestion, Enter accepts it",
        "Esc — dismiss a suggestion, or open and close settings",
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

  /**
   * How far below its resting place the panel starts, as a fraction of the
   * viewport — a `dv` distance per ANIMATION.md, not a pixel constant.
   *
   * 6dvh rather than the 2dvh it was: the panel is centred now, so the travel
   * has to read as coming *from* somewhere. At 2dvh a centred panel just
   * appears with a twitch.
   */
  const PANEL_RISE = 0.06;

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
      const rise = PANEL_RISE * window.innerHeight;
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

  /**
   * The label inside a settings row, which is what the flicker is played on.
   * A switch row carries one label per side, so the caller says which one is
   * about to become the current state — the flicker belongs on the value being
   * moved *to*, and the class that marks it has not been applied yet at click
   * time.
   */
  function optionLabel(button: EventTarget | null, index = 0) {
    const labels = (button as HTMLElement | null)?.querySelectorAll<HTMLElement>(
      ".settings-option-label",
    );
    return labels?.[index] ?? null;
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
    //
    // It leaves *upward*, against the direction it arrived from. Enter and
    // leave being a mirror pair here is what stops the panel reading as
    // dropping back into a drawer it never came out of.
    gsap.to(panel, { autoAlpha: 0, y: -PANEL_RISE * window.innerHeight, duration: 0.2, ease: "power2.in" });
    gsap.to(settingsBackdrop, {
      autoAlpha: 0,
      duration: 0.2,
      ease: "power2.in",
      onComplete: () => {
        settingsOpen = false;
        // The panel took focus from xterm when it opened, and xterm is the
        // input engine — without this the user is typing into nothing.
        refocus();
      },
    });
  }

  function toggleSettings() {
    if (settingsOpen) closeSettings();
    else settingsOpen = true;
  }

  /**
   * The one Esc handler. Raw mode is exempt — Esc is how you leave vim's insert
   * mode, and a terminal that eats it is broken in a way no settings panel pays
   * for.
   */
  function onEscape(e: KeyboardEvent) {
    if (e.key !== "Escape" || mode === "raw") return;
    e.preventDefault();
    // Innermost thing first. Esc with the suggestion strip open means "not that
    // one", not "open the settings" — dismissing it must not also cost a panel.
    if (menuOpen) {
      closeMenu();
      return;
    }
    toggleSettings();
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

    // The mark and the text it is about to hand over. Measured rather than
    // assumed: the run is however wide the command is, so a one-word command
    // gets a short throw and a long pipeline a long one — the gesture reports
    // what was submitted.
    const mark = inputBarEl.querySelector(".ghost-mark");
    const text = inputBarEl.querySelector(".input-text");
    if (!mark || !text) return;
    const dx = Math.max(0, text.getBoundingClientRect().right - mark.getBoundingClientRect().right);

    const tl = gsap.timeline({ onComplete: () => gsap.set(mark, { clearProps: "x,scale" }) });
    // Beat 1 — focal. The mark runs to the end of the command; where it stops
    // is where the block's border starts drawing from.
    tl.to(mark, { x: dx, duration: 0.16, ease: "power2.inOut" }, 0);
    // Meanwhile the source returns to rest, under the border draw rather than
    // after it. Peripheral: it is the thing being left behind.
    tl.to(mark, { x: 0, duration: 0.14, ease: "power2.in" }, 0.2);
    settle(mark, 0.9, { tl, at: 0.34 });
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
        // it is supposed to be the end of. Same reason `reveal.js` writes its
        // staircase by hand.
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
  // Two animations and one rule for choosing between them.
  //
  //   typewriter — for the one element that can still grow. See below.
  //   static     — for everything else: the label reveal over the coloured
  //                tokens, the character wave under the grey prose. See
  //                `revealStatic`.
  //
  // The rule is `awaitingBlock`: everything inside a block still waiting on its
  // command types itself, everything in a block that has already returned does
  // not. Nothing is decided at mount — at mount nothing has arrived, so nothing
  // is known.
  //
  // ── The typewriter ──────────────────────────────────────────────────────────
  // Output arrives one *rendered row* at a time — a visual line as the browser
  // laid it out, so a logical line that wraps across three rows produces three
  // reveals — each wiped left to right and quantized to a character grid, which
  // is what makes a smooth wipe read as typing.
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
  // ── The unit is the block, not the row ──────────────────────────────────────
  // The cursor still walks rows — that is the mechanism, and a wrapped logical
  // line still produces one wipe per visual row. What changed is the *pacing*:
  // the whole element is typed in one short burst, and the stagger the eye reads
  // is between one element and the next rather than between two rows of the same
  // one.
  //
  // Reading-paced rows (0.096s each) were right when exactly one element typed
  // and everything above it was already final. Everything inside a block that is
  // still awaiting a response now types, so a per-row pace would put a block of
  // eight lines four times behind the shell that wrote it. A block is a thought;
  // the beat belongs between thoughts.
  //
  // One element types at a time, in document order, and the next starts when the
  // one before it lands — so an element never begins mid-way down a block whose
  // earlier lines are still being written.

  /** Per row while a block types. Fast — the row is no longer the beat. */
  const TYPE_ROW = 0.028;
  /** Floor and ceiling on one block's burst, whatever its row count. */
  const TYPE_MIN = 0.12;
  const TYPE_MAX = 0.26;
  /** Past this many rows pending, reveal instantly — see flood control below. */
  const FLOOD_ROWS = 40;
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
   * Drops the action's pre-paint hide. Called only once the reveal's own hiding
   * is in place — the clip for the typewriter, the per-character `autoAlpha` and
   * the label clips for the static reveal. Called any earlier and the whole
   * element is briefly on screen at full strength, which is the flash both
   * reveals exist to avoid.
   */
  function show(node: HTMLElement) {
    node.style.visibility = "";
  }

  /**
   * The typing indicator — the input bar's caret, riding the wipe's leading
   * edge.
   *
   * The typewriter is a picture of a program writing, and until now the only
   * evidence of the writer was the text arriving. The caret is the same object
   * the user was just typing into: the bar hands its cursor to the block, the
   * block writes with it, and it goes out when the block is done.
   *
   * It lives in the bars overlay for the same two reasons the bars do — Svelte
   * rewrites an output element's children on every chunk, and a clip on the
   * element applies to anything inside it, so a caret in there would be wiped
   * by the very wipe it is supposed to be leading.
   */
  let typeCaret: HTMLElement | undefined;

  /**
   * An element's top-left corner in the scroll container's own coordinates —
   * what the caret's per-frame position is offset from. The overlay is inside
   * the scrollport, so a caret placed in these coordinates scrolls with the text
   * it is writing rather than sliding off it when the view moves mid-burst.
   */
  function caretOrigin(node: HTMLElement) {
    if (!scrollEl) return null;
    const s = scrollEl.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    return { x: r.left - s.left + scrollEl.scrollLeft, y: r.top - s.top + scrollEl.scrollTop };
  }

  /** Put the caret at a point in the scroll container's own coordinates. */
  function caretTo(x: number, y: number, h: number) {
    if (!barsEl) return;
    if (!typeCaret) {
      typeCaret = document.createElement("div");
      typeCaret.className = "type-caret";
      barsEl.append(typeCaret);
    }
    typeCaret.style.height = `${h}px`;
    gsap.set(typeCaret, { x, y, autoAlpha: 1 });
  }

  /** Nothing is being written. The caret is not idling anywhere — it is gone. */
  function caretOff() {
    if (typeCaret) gsap.set(typeCaret, { autoAlpha: 0 });
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
      // A warning is red whatever the accent is: the one colour in the app that
      // is not the user's to theme, because it is the colour of the thing it
      // reports and not of the terminal. `closest`, so a warning *block* paints
      // every bar inside it, not only the heading that carries the class.
      if (node.closest(".warn")) bar.classList.add("warn");
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
    if (reduceMotion) return;
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
  function revealStatic(node: HTMLElement) {
    // Held rather than skipped, exactly as the typewriter is: the element is
    // still owed its reveal, it just cannot start inside a container that is
    // itself still travelling.
    if (revealHeld) return;
    // A static element is final by definition — there is no next chunk to hide
    // from, so nothing here needs the persistent clip the typewriter keeps.
    revealed.delete(node);

    const tiers = labelsIn(node);
    const clipped = tiers.flat();
    const labels = new Set<Element>(clipped);
    // The element being a label itself — a heading is one, whole — means there
    // is no prose left over to wave: it is all bar.
    const split = labels.has(node) ? null : splitChars(node, labels);
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

    // Nothing on screen animates. The clips have to be written before the
    // element is shown either way, or a label is briefly at full strength.
    for (const el of clipped) el.style.clipPath = HIDDEN_CLIP;
    if (!inView(node)) {
      done();
      return;
    }

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
    const waveAt = tiers.length * LABEL_STEP;

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
      // Too long to split, and not a label: it rises as one piece. The gesture
      // is the same, the resolution is coarser.
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

    let at = 0;
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
      // Cleared, not left at the tween's end value: the loop below re-parks
      // every typewriter element against the new layout.
      unclip(node);
    }
    revealing.clear();
    dropBars();
    for (const node of revealed.keys()) {
      const m = metricsOf(node);
      revealed.set(node, m.rows);
      rest(node, m.rows, m);
    }
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
    // The caret is in there too, so it went with them. Forgetting the reference
    // would leave every later reveal writing to a detached node.
    typeCaret = undefined;
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
  function inView(node: HTMLElement) {
    if (!scrollEl) return false;
    const view = scrollEl.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return rect.bottom > view.top && rect.top < view.bottom;
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

  /**
   * The block that is still awaiting a response, if there is one.
   *
   * This is what decides which reveal an element gets, and deciding it *here*
   * rather than at mount is the point — at mount nothing has arrived yet, so
   * nothing is known. The typewriter is a picture of a program writing, and it
   * is only honest while something is being written, so **everything inside the
   * open block types** and everything outside it — a block whose command has
   * already returned — gets the static reveal.
   *
   * The narrower rule this replaces gave the typewriter to the last registered
   * element only, which meant a line typed itself and then the lines that
   * arrived under it in the same command swept in on bars instead: two
   * animations inside one block, deciding between themselves on the accident of
   * which chunk boundary fell where. One block, one animation.
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
    // One element types at a time. The stagger the eye reads is between one
    // block and the next, so a second burst starting under the first would be
    // the two beats collapsing back into one.
    let typing = false;
    for (const node of [...revealed.keys()]) {
      if (revealing.has(node)) {
        // A static reveal drops its entry from `revealed`, so an element in both
        // maps is a typewriter still running — which is the thing being waited
        // on, and the only thing that has a caret.
        typing = true;
        continue;
      }
      if (revealing.has(node)) continue;
      // `instant` takes the element out of the reveal system entirely: one rise
      // and it is done, including the live one. An element that already has
      // rows on screen was mid-typewriter when the mode changed — it is shown
      // where it stands rather than replayed, under the same rule the split
      // below follows, since re-revealing text the reader has read is the exact
      // thing that reads as messy.
      if (revealMode === "instant") {
        if ((revealed.get(node) ?? 0) > 0) {
          unclip(node);
          show(node);
          revealed.delete(node);
          continue;
        }
        revealInstant(node);
        continue;
      }
      if (!open || !open.contains(node)) {
        // The command has returned, so this element can never grow again — and
        // therefore must never be clipped again either. This is also the only
        // place a partially revealed element gets shown in full, which is the
        // safety net under every row-count assumption in this region.
        if ((revealed.get(node) ?? 0) > 0) {
          // Already typed. It has been read once; revealing it a second time in
          // a different animation is the "messy" this whole split exists to
          // remove. Show it and let it go.
          unclip(node);
          show(node);
          revealed.delete(node);
          continue;
        }
        revealStatic(node);
        continue;
      }
      // Inside the block still awaiting a response: it types. Off-screen
      // elements are let through even while something else is typing — they
      // have nothing to animate, and holding them behind a burst nobody can see
      // them under is a queue that only ever grows.
      if (typing && inView(node)) continue;
      revealElement(node);
      if (revealing.has(node)) typing = true;
    }
    if (!typing) caretOff();
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
    // Forty rows is more than a screenful and more than one burst can carry —
    // past that the terminal is lying about what has finished. `npm install`
    // emits thousands.
    if (pending <= 0 || pending > FLOOD_ROWS) {
      revealed.set(node, rows);
      // Parked at the full row count, which shows everything — but still
      // *clipped*, so the next chunk's rows are hidden the frame they land.
      rest(node, rows, m);
      show(node);
      return;
    }
    // One burst for the whole element, floored and capped: a one-line result and
    // an eight-line block are both a single beat, which is what makes the block
    // the unit rather than the row.
    const burst = gsap.utils.clamp(TYPE_MIN, TYPE_MAX, pending * TYPE_ROW);
    // "Move down" exists for the reader who wants to be current, so playing the
    // reading pace there contradicts the point of the mode. The burst shortens
    // with the backlog instead, converging on instant and hitting the flood
    // threshold at the same place it would anyway. The wipe and the stepping are
    // identical in both modes — only the rate changes, or the setting becomes a
    // choice between two different products.
    const duration = revealStagger(pending, burst, FLOOD_ROWS, scrollMode === "bottom");

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
    show(node);
    // The caret's origin, measured once. The element can grow under it, but only
    // downward and only into rows this burst is not writing — a re-measure per
    // frame would be a forced layout on every frame of every reveal.
    // ponytail: origin taken at the start; a mid-burst reflow would drag the
    // caret off the text. Re-measure per row if wrapping mid-command shows up.
    const origin = caretOrigin(node);
    const tween = gsap.to(at, {
      row: target,
      duration,
      ease: "none",
      onUpdate() {
        node.style.clipPath = revealClip(at.row, m.row, m.cells);
        if (origin) {
          const head = revealHead(at.row, m.row, m.cells);
          caretTo(origin.x + head.x * node.clientWidth, origin.y + head.y, m.row);
        }
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

  // Right-click copies a block's output. Shift+right-click copies it
  // reconstructed as real markdown syntax, via the same parser that drives
  // the on-screen rendering — one source of truth for "what is a heading".
  function copyBlock(e: MouseEvent, block: Block) {
    e.preventDefault();
    pullToCursor(e.currentTarget as HTMLElement, e);
    const asMarkdown = e.shiftKey;
    const text = asMarkdown ? toMarkdown(blockNodes(block)) : block.buffer;
    navigator.clipboard.writeText(text);
    notify(asMarkdown ? "Copied as markdown" : "Copied output");
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

  type Suggestion = { text: string; hint: string };

  let menuItems = $state<Suggestion[]>([]);
  let menuIndex = $state(0);
  let menuOpen = $state(false);
  let menuEl = $state<HTMLElement | undefined>();
  /** Column the accepted text replaces from — the start of the token under the cursor. */
  let menuStart = 0;

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
    const back = Math.max(0, cursorCol - menuStart);
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
    openMenu(completions(entries, base, dir, shellIsWindows()), start);
  }

  /** Keys the strip owns while it is open. Tab opens it, so it always owns Tab. */
  function menuOwns(key: string) {
    return key === "Tab" || (menuOpen && (key === "ArrowUp" || key === "ArrowDown" || key === "Enter"));
  }
  // #endregion ────────────────────────────────────────────────────────────────

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
      // The suggestion strip owns these keys before the shell sees them. It has
      // to be here rather than on the window: xterm turns a keydown into bytes
      // on the wire from its own listener, so a handler that only stops the
      // event from bubbling still lets Tab complete and Enter submit behind the
      // strip. Returning false is xterm's "I handled this".
      if (mode !== "raw" && atPrompt && menuOwns(e.key)) {
        e.preventDefault();
        if (e.type === "keydown") {
          if (e.key === "Tab") openCompletions();
          else if (e.key === "Enter") acceptMenu();
          else moveMenu(e.key === "ArrowDown" ? 1 : -1);
        }
        return false;
      }
      // Any other key moves the line on, and the options were computed against
      // a token that no longer exists. Esc is excluded because the window's
      // capture handler has already closed the strip by the time this runs.
      if (menuOpen && e.type === "keydown" && e.key !== "Escape") closeMenu();

      // Esc belongs to the shell first. In raw mode it is how you leave vim's
      // insert mode, so it is never intercepted there — a terminal that eats
      // Esc is broken in a way no settings panel pays for. In block mode it
      // opens the panel, which costs PSReadLine's clear-line binding; see
      // tasks.md, that trade is recorded rather than assumed.
      //
      // Only the swallow lives here. The toggle itself is on `svelte:window`,
      // because this handler sits on xterm's textarea and therefore does
      // nothing at all whenever xterm is not the focused element — which is
      // every moment after a click inside the settings panel, and is exactly
      // why Esc "sometimes" did not close it.
      if (e.key === "Escape" && mode !== "raw") {
        if (e.type === "keydown") e.preventDefault();
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
        selFrom = 0;
        selTo = 0;
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
            selFrom = selStart < 0 ? 0 : Math.max(0, selStart - promptWidth);
            selTo = selStart < 0 ? 0 : Math.max(0, selEnd - promptWidth);
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

    // Attach, not spawn: the shell was started in Rust's `setup`, before the
    // webview finished booting, so its several-hundred-millisecond startup
    // overlaps the frontend's instead of queueing behind it. Everything it
    // wrote in the meantime is buffered and arrives here as the first chunk —
    // xterm parses it exactly as if it had been live, markers and all.
    const ready = invoke("pty_attach", {
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
    const unwatchDrops = watchDrops();

    return () => {
      unwatchDrops();
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

<!-- Esc is handled here rather than in xterm's key handler: that one only runs
     while xterm's textarea has focus, so any click inside the panel silently
     disarmed the key. `capture` so a focused control inside the panel cannot
     consume it first. -->
<svelte:window onfocus={refocus} onkeydowncapture={onEscape} />

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
                <pre class="code-block" use:boxIn><code class="code-text" use:reveal>{#each node.spans as span}{#if span.token}<span class="tok-{span.token}">{span.text}</span>{:else}{span.text}{/if}{/each}</code></pre>
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
        <div class="settings-top">
          <!-- The font modes as an X. Four wedges around one centre, because
               that is what the four modes are: two slots, each pointing one of
               two ways. A vertical list of four rows says nothing about the
               shape of the choice; the X says it before the labels are read.
               Order is the table's order — the four corners, reading like text:
               top-left, top-right, bottom-left, bottom-right — and the wedge
               classes are indexed off it rather than matched by nth-child, so
               an added mode fails loudly instead of silently rotating the map. -->
          <section class="settings-card">
            <h2 class="card-title">Font</h2>
            <div class="font-x">
              <!-- The X itself, drawn once behind the four hit areas. Decoration
                   only: it must never eat a click meant for a wedge. -->
              <span class="x-mark" aria-hidden="true"></span>
              {#each Object.entries(FONT_MODES) as [key, def], i}
                <button
                  class="wedge {WEDGES[i]}"
                  class:active={fontMode === key}
                  title={def.hint}
                  onclick={(e) => setFontMode(key as FontMode, optionLabel(e.currentTarget))}
                >
                  <!-- Rendered in the font that mode gives to text outside a
                       container, so each wedge is its own sample. -->
                  <span class="settings-option-label" style:font-family={def.outside}
                    >{def.label}</span
                  >
                </button>
              {/each}
            </div>
          </section>

          <!-- Swatches, not labelled rows: the value being chosen is a colour,
               so the control should be the colour. -->
          <section class="settings-card">
            <h2 class="card-title">Color</h2>
            <div class="swatch-grid">
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
          </section>
        </div>

        <!-- Both of these are two-state, so they are switches rather than a pair
             of rows each — and both ends are on screen, with the knob between
             them, because the choice is between two named things rather than an
             on and an off. The lit side is the current state, and it is the
             element `glitchLabel` fires on: the one thing on screen whose job at
             that moment is to say *this changed*. -->
        <section class="settings-card switch-card">
          <div class="switch-group">
            <h2 class="card-title card-title-center">Window Behavior</h2>
            <button
              class="switch-row"
              title={SCROLL_MODES[scrollMode].hint}
              onclick={(e) =>
                setScrollMode(
                  scrollMode === "top" ? "bottom" : "top",
                  optionLabel(e.currentTarget, scrollMode === "top" ? 1 : 0),
                )}
            >
              <span class="switch-side" class:on={scrollMode === "top"}>
                <span class="settings-option-label">{SCROLL_MODES.top.label}</span>
              </span>
              <span class="switch" class:on={scrollMode === "bottom"}
                ><span class="switch-knob"></span></span
              >
              <span class="switch-side" class:on={scrollMode === "bottom"}>
                <span class="settings-option-label">{SCROLL_MODES.bottom.label}</span>
              </span>
            </button>
          </div>

          <div class="switch-group">
            <h2 class="card-title card-title-center">Text Animations</h2>
            <button
              class="switch-row"
              title={REVEAL_MODES[revealMode].hint}
              onclick={(e) =>
                setRevealMode(
                  revealMode === "typewriter" ? "instant" : "typewriter",
                  optionLabel(e.currentTarget, revealMode === "typewriter" ? 1 : 0),
                )}
            >
              <span class="switch-side" class:on={revealMode === "typewriter"}>
                <span class="settings-option-label">{REVEAL_MODES.typewriter.label}</span>
              </span>
              <span class="switch" class:on={revealMode === "instant"}
                ><span class="switch-knob"></span></span
              >
              <span class="switch-side" class:on={revealMode === "instant"}>
                <span class="settings-option-label">{REVEAL_MODES.instant.label}</span>
              </span>
            </button>
          </div>
        </section>

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
    <div class="input-bar ghost" class:drop={dragOver} bind:this={inputBarEl} use:growUpward>
      <span class="input-cwd"><span class="ghost-mark">&gt;</span> {promptCwd}</span><span class="block-sep">&nbsp;|&nbsp;</span><span class="input-text">{#each headSegments as part}<span class:sel={part.sel}>{part.text}</span>{/each}<span
          class="caret"
          class:idle={!atPrompt}
          class:typing
          bind:this={caretEl}
        ></span>{#each tailSegments as part}<span class:sel={part.sel}>{part.text}</span>{/each}</span>
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

  :global(.reveal-bar.warn) {
    background: var(--err);
  }

  /* The typing indicator, riding the wipe's leading edge. Deliberately the same
     object as the input bar's caret — same width, same fill — because that is
     the statement: the bar handed its cursor to the block and the block is
     writing with it. It never blinks: it is moving, and a blink on a moving
     caret reads as two effects, not one. `:global` for the same reason as the
     bar — built in JS, so it never carries Svelte's scoping class. */
  :global(.type-caret) {
    position: absolute;
    top: 0;
    left: 0;
    width: 0.65ch;
    background: var(--accent);
    will-change: transform;
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
    /* Centred, not docked to an edge. The panel is a module resting over the
       terminal; an edge-docked one reads as a drawer, which is the exact thing
       decisions.md rules out. */
    justify-content: center;
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

  /* The X and the swatches share a row: both are pickers of a fixed, small set,
     and stacking them made the panel a column of headings. Each sits in its own
     titled card, so the two pickers read as two things rather than as one wide
     control with a colour block stuck to its side. The X gets the wider column
     because it is square and carries four labels; the swatches only need three
     across. */
  .settings-top {
    display: grid;
    grid-template-columns: 1.35fr 1fr;
    align-items: start;
    gap: 14px;
    margin-bottom: 14px;
  }

  .settings-card {
    padding: 12px;
    background: var(--surface-inset);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
  }

  .card-title {
    margin: 0 0 10px;
    color: var(--accent);
    font: inherit;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .card-title-center {
    text-align: center;
    color: var(--text-ghost);
  }

  /* Four quadrants around one centre, with the X drawn through them. A quadrant
     rather than a triangle wedge so every label sits horizontally at its own
     outer corner — the triangle version had to turn two of the four labels on
     their side to fit, which made the two horizontal ones read as the real
     options and the vertical ones as an afterthought. */
  .font-x {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    width: 100%;
    aspect-ratio: 1;
  }

  /* Two rounded bars crossed at the centre. Decoration, and `pointer-events`
     off so it can sit over the wedges without stealing their clicks. */
  .x-mark {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .x-mark::before,
  .x-mark::after {
    content: "";
    position: absolute;
    top: 8%;
    left: 50%;
    width: 26px;
    height: 84%;
    margin-left: -13px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
  }

  .x-mark::before {
    transform: rotate(45deg);
  }

  .x-mark::after {
    transform: rotate(-45deg);
  }

  .wedge {
    position: relative;
    display: flex;
    padding: 4px;
    background: transparent;
    border: 0;
    font: inherit;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.25s ease;
  }

  .wedge:hover {
    color: var(--text);
  }

  .wedge.active {
    color: var(--accent-text);
  }

  /* The mark of the selection is a blob on the X's arm, not a fill of the
     quadrant: the quadrant is the hit area, the arm is what the reader is
     picking. Positioned toward the centre of its own corner's arm, which is why
     each quadrant places it on a different pair of edges. */
  .wedge::after {
    content: "";
    position: absolute;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0;
    transition: opacity 0.25s ease;
  }

  .wedge.active::after {
    opacity: 1;
  }

  .wedge-tl {
    align-items: flex-start;
    justify-content: flex-start;
  }

  .wedge-tl::after {
    right: 12%;
    bottom: 12%;
  }

  .wedge-tr {
    align-items: flex-start;
    justify-content: flex-end;
  }

  .wedge-tr::after {
    left: 12%;
    bottom: 12%;
  }

  .wedge-bl {
    align-items: flex-end;
    justify-content: flex-start;
  }

  .wedge-bl::after {
    right: 12%;
    top: 12%;
  }

  .wedge-br {
    align-items: flex-end;
    justify-content: flex-end;
  }

  .wedge-br::after {
    left: 12%;
    top: 12%;
  }

  /* The label sits above its own blob, or the accent fill swallows it. */
  .wedge .settings-option-label {
    position: relative;
    z-index: 1;
  }

  /* Both switches live in one card — they are the same kind of question asked
     twice, and two separate bordered rows made the panel a stack of frames. */
  .switch-card {
    display: grid;
    gap: 14px;
  }

  /* Name above, the two states either side of the knob. Centred, because
     neither end is the default and an off-centre one would say otherwise. */
  .switch-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    width: 100%;
    padding: 0;
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  .switch-side {
    flex: 1;
    color: var(--text-ghost);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition: color 0.25s ease;
  }

  /* The left state reads toward the knob and the right one away from it, so the
     pair reads as one control rather than two labels that happen to be near a
     switch. */
  .switch-side:first-child {
    text-align: right;
  }

  .switch-side:last-child {
    text-align: left;
  }

  /* The current state, marked by colour and an underline rather than by weight:
     a weight change reflows the row every time the switch is flipped. */
  .switch-side.on {
    color: var(--text);
  }

  .switch-side.on .settings-option-label {
    border-bottom: 1px solid var(--accent);
    padding-bottom: 2px;
  }

  .switch-row:hover .switch {
    border-color: var(--accent-border-soft);
  }

  .switch {
    flex: none;
    width: 38px;
    height: 20px;
    padding: 2px;
    box-sizing: border-box;
    background: var(--surface-base);
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    transition: background 0.25s ease, border-color 0.25s ease;
  }

  .switch.on {
    background: var(--accent-surface);
    border-color: var(--accent);
  }

  .switch-knob {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text-faint);
    /* A CSS transition, not a tween: one property, two states, driven by a class
       the template already toggles — the same reasoning that leaves the
       raw/block crossfade and the hover ring to CSS. ANIMATION.md's ban is on
       CSS *keyframe* animations for stateful things. */
    transition: transform 0.25s ease, background 0.25s ease;
  }

  .switch.on .switch-knob {
    transform: translateX(18px);
    background: var(--accent);
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

  /* A grid, not a row: eight accents in one line either overflow the panel or
     shrink each swatch below the size at which its colour is legible. Three
     columns keeps them at a readable size beside the square X. */
  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    justify-items: center;
  }

  /* Round, like the blob on the font X — the two pickers are the same gesture,
     so they get the same mark. */
  .swatch {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    cursor: pointer;
    /* The selected ring is drawn with box-shadow, not a border — a border would
       resize the swatch and shift the whole grid on every pick. */
    box-shadow: none;
    transition: box-shadow 0.25s ease;
  }

  .swatch.active {
    box-shadow: 0 0 0 3px var(--surface-inset), 0 0 0 4px var(--text);
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
    left: 12px;
    bottom: calc(12px + var(--input-h, 44px) - 1px);
    width: calc((100% - 24px) * 0.6);
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
    /* The handoff translates this on submit, and a transform does not apply to
       an inline box at all. `inline-block` on a single glyph changes no metric
       here and is what makes the gesture possible. */
    display: inline-block;
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
