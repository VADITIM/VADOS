<script lang="ts">
  import { onMount } from "svelte";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { Terminal, type IMarker } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";
  import gsap from "gsap";
  import { ScrollToPlugin } from "gsap/ScrollToPlugin";
  import banner from "$lib/banner.txt?raw";
  import { parse, toMarkdown } from "$lib/parse.js";

  gsap.registerPlugin(ScrollToPlugin);

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

  function setFontMode(next: FontMode) {
    fontMode = next;
    remember("vados.fontMode", next);
  }

  function setScrollMode(next: ScrollMode) {
    scrollMode = next;
    remember("vados.scrollMode", next);
    resyncTail();
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
  };

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
  // ponytail: single-row caret. A wrapped input bar puts it on the wrong line —
  // measure the rendered row if the bar ever grows past one.
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
    gsap.killTweensOf(caretEl);
    gsap.set(caretEl, { x: 0 });
    const x = caretEl.getBoundingClientRect().left;
    const dx = caretX - x;
    caretX = x;
    if (!dx || reduceMotion) return;
    // Backspace bounces twice as hard as a typed character — it is the
    // caret snapping backward against the grain of normal left-to-right
    // entry, so the overshoot needs to read as a harder correction.
    const strength = deleting ? 6 : 3;
    gsap.fromTo(caretEl, { x: dx }, { x: 0, duration: 0.22, ease: `back.out(${strength})` });
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

  /** `clear`/`cls` intercepted client-side: wipes rendered blocks, not just screen. */
  function isClearCommand(command: string): boolean {
    return /^(clear|cls)$/i.test(command.trim());
  }

  function clearBlocks() {
    markers.forEach((m) => m.dispose());
    markers.clear();
    blocks.length = 1;
    notify("Output cleared");
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
    for (let y = marker.line; y <= end; y++) {
      if (!buf.getLine(y)) continue;
      out += rowText(y);
      // A wrapped row continues the same logical line — no newline, otherwise
      // long output gains a break at every terminal width.
      if (!buf.getLine(y + 1)?.isWrapped) out += "\n";
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

  // Border color is the one property this touches outside transform/opacity
  // — ANIMATION.md forbids width/height/top/left/margin/padding specifically
  // because they trigger layout; color is a paint-only property and GSAP
  // tweens it natively, no plugin needed. Full border-hover treatment (the
  // portfolio source) is still pending — see ANIMATION.md's Open section.
  function hoverBorder(node: HTMLElement) {
    const base = token("--border");
    const bright = token("--border-bright");
    const enter = () => gsap.to(node, { borderColor: bright, duration: 0.35, ease: "power2.out", overwrite: true });
    const leave = () => gsap.to(node, { borderColor: base, duration: 0.35, ease: "power2.out", overwrite: true });
    node.addEventListener("mouseenter", enter);
    node.addEventListener("mouseleave", leave);
    return {
      destroy() {
        node.removeEventListener("mouseenter", enter);
        node.removeEventListener("mouseleave", leave);
        gsap.killTweensOf(node);
      },
    };
  }

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

  // Panel entrance at ANIMATION.md's settings timing (0.34s, power3.out). The
  // backdrop and the panel are one tween on purpose — two would need a timeline
  // and this is a single gesture. The character glitch on toggle labels is
  // Phase 5 work, not smuggled in here.
  function panelIn(node: HTMLElement) {
    const panel = node.querySelector(".settings");
    gsap.from(node, { autoAlpha: 0, duration: 0.34, ease: "power3.out" });
    // Rises into place rather than sliding in from the right. A lateral entry
    // is the tell of a drawer, and this is not one — see decisions.md. The
    // amplitude is a `dv` distance, and the panel is the element gaining
    // focus, so it gets the elastic overshoot (ANIMATION.md).
    if (panel) {
      const rise = window.innerHeight * 0.02;
      gsap.from(panel, { autoAlpha: 0, y: rise, duration: 0.34, ease: "back.out(1.6)" });
    }
    return {
      destroy() {
        gsap.killTweensOf([node, panel]);
      },
    };
  }

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

  // Right-click copies a block's output. Shift+right-click copies it
  // reconstructed as real markdown syntax, via the same parser that drives
  // the on-screen rendering — one source of truth for "what is a heading".
  function copyBlock(e: MouseEvent, block: Block) {
    e.preventDefault();
    const asMarkdown = e.shiftKey;
    const text = asMarkdown ? toMarkdown(parse(block.buffer)) : block.buffer;
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
            const row = rowText(buf.baseY + buf.cursorY);
            input = row.replace(PS_PROMPT, "");
            // The prompt's width is whatever the strip removed, so the caret
            // column survives a resize and a re-rendered prompt.
            cursorCol = Math.max(0, buf.cursorX - (row.length - input.length));
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
      });
    };

    const ready = invoke("pty_spawn", {
      cols: t.cols,
      rows: t.rows,
      cwd: null,
      onData,
    });

    t.onData((data) => {
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
        if (command) {
          atPrompt = false;
          if (isClearCommand(command)) {
            clearBlocks();
          } else {
            openBlock(command);
          }
          input = "";
        }
        pendingCommand = "";
      }
      invoke("pty_write", { data });
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      // The debug overlay reports window dimensions, and a resize is the one
      // thing that changes them without any PTY traffic to tick on.
      if (debugOn) debugTick++;
      // Reflow moved every row; re-read the open block at the new width.
      const block = currentBlock();
      if (block && !block.closed) snapshot(block);
      ready.then(() => invoke("pty_resize", { cols: t.cols, rows: t.rows }));
    });
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
      scrollTween?.kill();
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
    <div class="scroll" class:visible={mode === "blocks"} bind:this={scrollEl} onscroll={onScroll}>
      {#each blocks as block (block.id)}
        {#if !block.md}
          <div class="banner-center">
            <pre class="banner">{block.buffer}</pre>
          </div>
          <div class="banner-divider">{dividerLine}</div>
          <div class="banner-sub">
            <div>VAD/OS | Terminal</div>
            <div>/help for commands</div>
          </div>
        {:else}
          <section
            class="block"
            class:open={!block.closed}
            role="group"
            use:hoverBorder
            use:anchorNewBlock
            oncontextmenu={(e) => copyBlock(e, block)}
          >
            {#if block.cwd}
              <div class="block-head" use:stickyHead>&gt; {block.cwd}{#if block.command}<span class="block-sep">&nbsp;|&nbsp;</span><span class="block-command">{block.command}</span>{/if}</div>
            {/if}
            {#each parse(block.buffer) as node}
              {#if node.kind === "heading"}
                {#if node.level === 3}
                  <h3 class="md-heading md-heading-3" class:warn={node.tone === "warn"} class:ok={node.tone === "ok"}>{node.text}</h3>
                {:else}
                  <h2 class="md-heading" class:warn={node.tone === "warn"} class:ok={node.tone === "ok"}>{node.text}</h2>
                {/if}
              {:else if node.kind === "list"}
                <ul class="md-list">
                  {#each node.items as item}
                    <li>{item}</li>
                  {/each}
                </ul>
              {:else if node.kind === "code"}
                <!-- One span per token run, no whitespace between them: any
                     newline the template introduced would land inside a `pre`
                     and become a real line break. -->
                <pre class="code-block">{#each node.spans as span}{#if span.token}<span class="tok-{span.token}">{span.text}</span>{:else}{span.text}{/if}{/each}</pre>
                <!-- Trailing spacer, not margin on .code-block itself — a
                     margin would also apply above the block, doubling up
                     against the block-entrance gap already set by .scroll's
                     flex `gap`. -->
                <div class="code-spacer"></div>
              {:else}
                <pre class="block-body" class:bold={node.bold}>{#each node.parts as part}{#if part.code}<code class="inline-code">{part.text}</code>{:else}{part.text}{/if}{/each}</pre>
              {/if}
            {/each}
            {#if block.closed && block.cwd}
              <div class="block-result" class:ok={block.exitCode === 0} class:err={block.exitCode !== 0}>
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
            onclick={() => setFontMode(key as FontMode)}
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
            onclick={() => setScrollMode(key as ScrollMode)}
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
    <div class="input-bar ghost">
      <span class="input-cwd"><span class="ghost-mark">&gt;</span> {promptCwd}</span><span class="block-sep">&nbsp;|&nbsp;</span><span class="input-text">{input}<span
          class="caret"
          class:idle={!atPrompt}
          class:typing
          style="--col: {cursorCol}"
          bind:this={caretEl}
        ></span></span>
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
    padding: 12px 3dvw;
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

  /* Placeholder chrome. Border radius is a flat placeholder for a true
     squircle (superellipse) — see tasks.md. Border-hover animation pending
     the portfolio source. */
  .block {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 10px 14px;
    /* This is *the* container. Everything inside inherits from here, so the
       inside/outside split is one declaration rather than a rule per node. */
    font-family: var(--font-inside);
    font-size: 14px;
    color: var(--text);
  }

  .block-head {
    color: var(--accent);
    margin-bottom: 6px;
  }

  /* Only the head of a real block, never the live ghost line — that one is a
     direct child of `.scroll` and would pin to the top of the whole stream. */
  .block > .block-head {
    position: sticky;
    /* Flush with the scrollport, which is `.scroll`'s padding box — the pinned
       line sits on the very top edge rather than 12px down inside it. */
    top: 0;
    z-index: 1;
    /* Pulled out to the block's edges so the pinned line covers the output
       sliding under it, then padded back in to sit where it did before. */
    margin: -10px -14px 6px;
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
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 12px 12px;
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
    /* Positioning context for the caret, which is absolute inside it. The
       min-height keeps that box real when the input is still empty. */
    display: inline-block;
    position: relative;
    min-height: 15px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Decorative, never interrupted, never coordinated — the one case where a
     CSS keyframe animation is allowed instead of GSAP. See ANIMATION.md.
     Width is 0.65ch — narrower than a cell, so it reads as a caret sitting at
     the column rather than a block overhanging the text to its right. */
  .caret {
    position: absolute;
    bottom: 0;
    left: calc(var(--col, 0) * 1ch);
    width: 0.65ch;
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
