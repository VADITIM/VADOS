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
  let atPrompt = false;
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
  // PowerShell writes some startup noise (loading the injected profile, its
  // own interactive-loop setup) before the first real prompt cycle — that
  // output has no cwd yet, so it fell through the "output arrived with no
  // block open" path below and opened empty, headerless blocks. There's
  // nothing to attribute it to, so it's dropped rather than block-ified
  // until the first prompt has actually completed.
  let booted = false;
  // The block whose command took over the screen. Its output lives in the
  // alternate buffer and is wiped on exit, so it never gets snapshotted.
  let rawBlockId = -1;

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

  // Fires once per block, when it's created — not on every output chunk. A
  // command's output can run well past the fold; chasing the tail on every
  // chunk would fight the reader's eye and, for anything longer than a
  // screen, end up scrolled past the command that produced it. Anchoring the
  // new block's head near the top instead means the whole exchange — command
  // in, output growing below — reads top-down, and the reader can still
  // scroll manually for output that overflows.
  function anchorNewBlock(node: HTMLElement) {
    if (!scrollEl) return;
    scrollTween?.kill();
    if (reduceMotion) {
      scrollEl.scrollTop = node.offsetTop - 12;
      return;
    }
    scrollTween = gsap.to(scrollEl, {
      duration: 0.3,
      ease: "power2.out",
      scrollTo: { y: node, offsetY: 12 },
      overwrite: true,
    });
  }

  // Border color is the one property this touches outside transform/opacity
  // — ANIMATION.md forbids width/height/top/left/margin/padding specifically
  // because they trigger layout; color is a paint-only property and GSAP
  // tweens it natively, no plugin needed. Full border-hover treatment (the
  // portfolio source) is still pending — see ANIMATION.md's Open section.
  function hoverBorder(node: HTMLElement) {
    const base = "#201f26";
    const bright = "#3a3745";
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
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  function notify(text: string) {
    notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 1600);
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
      theme: { background: "#0a0a0c", foreground: "#d4d4d8" },
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

    // Shell-integration markers are parsed here, not in Rust. An OSC handler
    // runs mid-parse, so the cursor is exactly where the marker sat in the
    // stream — which is the whole point: a marker delivered out-of-band could
    // arrive before the output chunk it describes, and that output would then
    // be filed under the wrong command (or dropped as prompt noise).
    // Returning true consumes the sequence so it never reaches the screen.
    t.parser.registerOscHandler(133, (data) => {
      if (data === "A") {
        atPrompt = true;
        promptReady = false;
        input = "";
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
      // The block that launched the app keeps its heading and result. Its rows
      // are gone from the buffer the marker points into, so anything read back
      // now would be the app's leftover screen, not the command's output.
      if (next === "raw") rawBlockId = currentBlock()?.id ?? -1;
      mode = next;
      t.focus();
    }
    t.buffer.onBufferChange(syncMode);

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
        if (mode === "raw") return;
        const buf = t.buffer.active;

        if (atPrompt) {
          // Nothing to mirror yet if this chunk hasn't reached 133;B — the
          // row currently holds an unfinished prompt, not typed input.
          if (promptReady) {
            const row = rowText(buf.baseY + buf.cursorY);
            input = row.replace(PS_PROMPT, "");
          }
          return;
        }

        if (!booted) return;

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
      if (atPrompt && promptReady && data.includes("\r") && input.trim()) {
        atPrompt = false;
        openBlock(input);
        input = "";
      }
      invoke("pty_write", { data });
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
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

<div class="app" onclick={refocus} role="presentation">
  {#if notice}
    <div class="notice" use:noticeFade>{notice}</div>
  {/if}
  <div class="stage">
    <div class="scroll" class:visible={mode === "blocks"} bind:this={scrollEl}>
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
            use:hoverBorder
            use:anchorNewBlock
            oncontextmenu={(e) => copyBlock(e, block)}
          >
            {#if block.cwd}
              <div class="block-head">&gt; {block.cwd}{#if block.command}<span class="block-sep">&nbsp;|&nbsp;</span><span class="block-command">{block.command}</span>{/if}</div>
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
                <pre class="code-block">{node.text}</pre>
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
        <div class="block-head live">
          &gt; {promptCwd}<span class="block-sep">&nbsp;|&nbsp;</span><span class="live-text">{input}</span>
        </div>
      {/if}
    </div>

    <div class="xterm-wrap" class:visible={mode === "raw"} bind:this={wrapper}>
      <div class="xterm-host" bind:this={xtermHost}></div>
    </div>
  </div>

  <!-- Docked, always visible. Not `position: fixed` — it has to resize cleanly
       and must not fight the settings overlay's stacking context later. -->
  {#if mode === "blocks"}
    <div class="input-bar">
      <span class="input-cwd">&gt; {promptCwd}</span><span class="block-sep">&nbsp;|&nbsp;</span><span class="input-text">{input}</span><span class="caret" class:idle={!atPrompt}></span>
    </div>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: #0a0a0c;
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
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    /* The browser's own scroll-anchoring keeps adjusting scrollTop to "stay
       stable" as a growing command's output streams in below the fold — that
       fights anchorNewBlock's deliberate top-anchor and is what was dragging
       the view to the bottom on long output. This is the standard fix for
       that class of bug in any growing scroll feed. */
    overflow-anchor: none;
    scrollbar-color: #201f26 transparent;
  }

  .scroll::-webkit-scrollbar {
    width: 10px;
  }

  .scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .scroll::-webkit-scrollbar-thumb {
    background: #201f26;
    border-radius: 6px;
  }

  .scroll::-webkit-scrollbar-thumb:hover {
    background: #2c2b33;
  }

  .xterm-wrap {
    padding: 8px;
  }

  .xterm-host {
    height: 100%;
  }

  /* Placeholder chrome. Border radius is a flat placeholder for a true
     squircle (superellipse) — see tasks.md. Border-hover animation pending
     the portfolio source. */
  .block {
    background: #101014;
    border: 1px solid #201f26;
    border-radius: 12px;
    padding: 10px 14px;
    font-family: Consolas, "DejaVu Sans Mono", monospace;
    font-size: 14px;
    color: #d4d4d8;
  }

  .block-head {
    color: #7e55dd;
    margin-bottom: 6px;
  }

  /* Parent centers the atomic inline-block as one unit — the pre's own
     lines never reflow relative to each other, only the whole block moves. */
  .banner-center {
    text-align: center;
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
    color: #7e55dd;
    font-family: Consolas, "DejaVu Sans Mono", monospace;
    font-size: 14px;
    line-height: 1;
  }

  .banner {
    margin: 0;
    padding: 10px 14px;
    color: #7e55dd;
    white-space: pre;
    font-family: Consolas, "DejaVu Sans Mono", monospace;
    font-size: 14px;
  }

  .banner-sub {
    padding: 4px 14px 0;
    color: rgba(255, 255, 255, 0.5);
    font-family: Consolas, "DejaVu Sans Mono", monospace;
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
    background: #201f26;
  }

  .block-head.live {
    padding: 2px 2px;
  }

  .live-text {
    color: #f4f4f5;
  }

  .block-command {
    color: #d4d4d8;
  }

  .block-sep {
    color: #45424f;
  }

  .block-body {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .block-body.bold {
    font-weight: 600;
    color: #e4e4e7;
  }

  /* Placeholder markdown styling — Phase 4 replaces these with tokens. */
  .md-heading {
    margin: 12px 0 6px;
    font-size: 15px;
    font-weight: 600;
    color: #a78bfa;
  }

  .md-heading:first-child {
    margin-top: 0;
  }

  .md-heading-3 {
    font-size: 14px;
    font-weight: 600;
    color: #9ca3af;
  }

  /* Same colors as .block-result — one red, one green, used everywhere a
     status reads as pass/fail. */
  .md-heading.warn {
    color: #f87171;
  }

  .md-heading.ok {
    color: #4ade80;
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
    color: #7e55dd;
  }

  .code-block {
    margin: 4px 0;
    padding: 8px 10px;
    background: #0d0d11;
    border: 1px solid #201f26;
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    color: #a1a1aa;
  }

  .code-spacer {
    height: 8px;
  }

  .inline-code {
    padding: 1px 5px;
    background: #1c1b23;
    border-radius: 4px;
    color: #c4b5fd;
    font-family: inherit;
  }

  .block-result {
    margin-top: 6px;
    font-size: 12px;
  }

  .block-result.ok {
    color: #4ade80;
  }

  .block-result.err {
    color: #f87171;
  }

  .notice {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10;
    padding: 6px 14px;
    background: #1a1922;
    border: 1px solid #34313f;
    border-radius: 8px;
    font-family: Consolas, "DejaVu Sans Mono", monospace;
    font-size: 12px;
    color: #d4d4d8;
    pointer-events: none;
  }

  .input-bar {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 12px 12px;
    padding: 12px 14px;
    background: #141419;
    border: 1px solid #2a2833;
    border-radius: 12px;
    font-family: Consolas, "DejaVu Sans Mono", monospace;
    font-size: 14px;
    color: #d4d4d8;
  }

  .input-cwd {
    color: #7e55dd;
    flex: none;
  }

  .input-text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Decorative, never interrupted, never coordinated — the one case where a
     CSS keyframe animation is allowed instead of GSAP. See ANIMATION.md.
     Width is 1ch — one monospace character cell — so it always sits on the
     same grid as the text instead of drifting from the real cursor column. */
  .caret {
    display: inline-block;
    width: 1ch;
    height: 15px;
    vertical-align: text-bottom;
    background: #7e55dd;
    animation: caret-blink 1s step-end infinite;
  }

  .caret.idle {
    opacity: 0.25;
    animation: none;
  }

  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }
</style>
