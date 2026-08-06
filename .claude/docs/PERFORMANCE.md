# VAD/OS — Performance Rules

**Read this file before writing or changing any code in the output path.**

The output path is: PTY byte arrives in Rust → channel → frontend parse → DOM → paint. Everything in it is hot. Everything else is not, and is not worth optimizing.

The bar is simple: **VAD/OS must not feel slower or heavier than Windows Terminal or Alacritty.** Animation and block chrome buy us nothing if `cat big.log` stalls the UI or a day-long session sits at 800 MB. Motion is the product, but responsiveness is the floor — when they conflict, motion loses. `ANIMATION.md` already encodes that (flood control, off-screen skip); this file is the rest of it.

## Budgets

Non-negotiable. These are the numbers a build is measured against, not aspirations.

| Metric | Budget | Ceiling |
|---|---|---|
| Keystroke → glyph on screen (p99) | 8 ms | 16 ms |
| Sustained throughput, `cat` of a 100 MB log | 40 MB/s | must never block input |
| Idle CPU (no output, window focused) | 0.0 % | 0.1 % |
| Idle CPU (animation mid-flight) | — | 5 % of one core |
| RSS, fresh session | 120 MB | 180 MB |
| RSS, after 100k lines of scrollback | 250 MB | 400 MB |
| Frame time during reveal | 16.6 ms | never a dropped frame two in a row |
| Cold start → interactive prompt | 400 ms | 800 ms |

"Idle CPU 0.0 %" is literal: with no output and no animation running, the process must issue **zero** timers, zero `requestAnimationFrame`, zero polling. A terminal sitting in the background is the most common state it will ever be in, and the one users notice on battery.

## The four things that will actually kill us

Everything below is downstream of these. In priority order:

1. **Unbounded DOM.** One element per row, never freed, is the single largest failure mode of a DOM terminal. Solved by scrollback virtualization + split reversion.
2. **Per-byte or per-line work in the hot path.** A `String` allocation per line, a regex per line, a Svelte reactive statement per line — each is fine at 10 lines/s and fatal at 100k.
3. **Chatty IPC.** One Tauri channel message per PTY read is thousands of serialization round-trips per second. Coalesce in Rust.
4. **Leaks.** Tweens, `SplitText` instances, event listeners, `ResizeObserver`s. A terminal session runs for eight hours; anything that leaks per-command compounds into the RSS ceiling.

## Rust side — the pipe

Rust is a dumb pipe (see `CLAUDE.md`) and it must also be a *cheap* one.

- **Read into a reused buffer.** One `[u8; 65536]` per session, reused across reads. Never `Vec::new()` per read.
- **Coalesce before sending.** Accumulate PTY bytes and flush to the frontend on whichever comes first: **4 KB accumulated** or **8 ms elapsed**. This is the single highest-leverage optimization in the app — it turns a `cat` of a large file from ~100k IPC messages into ~1k, without adding perceptible latency to interactive typing.
- **Never flush mid-escape-sequence.** Coalescing must not split an OSC or CSI sequence across two messages — the frontend parser is stateful and would see garbage. Scan back from the buffer end for an incomplete sequence and hold its bytes for the next flush.
- **Send bytes, not strings.** No UTF-8 validation, no `String::from_utf8_lossy` in Rust. The frontend decodes. Validation in Rust means a second pass over every byte and breaks on split multi-byte characters at flush boundaries.
- **No parsing, no allocation-per-line, no logging in the read loop.** A `println!` per read is a syscall per read.
- **Backpressure over unbounded queues.** If the frontend cannot keep up, the channel must apply backpressure to the PTY read, not grow a queue until RSS explodes.

```rust
// ponytail: fixed 4KB/8ms coalescing window; make it adaptive if interactive
// latency and bulk throughput ever pull apart in real measurements
const FLUSH_BYTES: usize = 4096;
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
```

## Frontend — parsing

- **One decoder instance.** A single `TextDecoder` with `{ stream: true }` for the session lifetime. Constructing one per chunk is both slow and wrong — it breaks multi-byte characters split across chunk boundaries.
- **Parse per chunk, not per line.** Scan the incoming chunk once. Do not `split("\n")` into an array of strings and then loop it — that is two passes and N allocations for what one pass does.
- **No regex in the hot path.** Escape-sequence and OSC 133 detection is byte/char comparison. Regexes are for config parsing and markdown, not for every line of `npm install`.
- **Markdown detection is cheap and lazy.** Cheap heuristic first (does the block plausibly contain markdown?); only run the real parser on blocks that pass. The classifier runs once per block and its verdict is final — reclassifying mid-stream means reflowing a block under the reader, which costs a frame *and* the reader's place.
- **Incremental markdown parsing is allowed only under all three of these.** The original rule here was "never parse a streaming block"; [../foundation/phase-8-markdown-engine.md](../foundation/phase-8-markdown-engine.md) needs live rendering, so the ban is replaced by conditions rather than quietly dropped:
  1. **Parse forward from the last stable boundary**, never from the top of the block. Re-parsing the whole buffer per chunk is O(n²) over a long command and is still banned outright.
  2. **Coalesce to one parse per frame**, not one per chunk. Twenty chunks in a frame is one parse.
  3. **Fall back to the raw live container under flood.** Same threshold that governs the reveal — if rows are arriving faster than they can be revealed, they are arriving faster than they are worth parsing. Render raw, parse once on completion.

  If the boundary logic cannot be made correct for unterminated fenced code, the fallback is the original rule: raw while streaming, parse on completion. That is a correctness call, not a performance one, and it is Phase 8's to make.

## Frontend — the DOM

This is where a web-tech terminal wins or loses against native.

- **Virtualize scrollback.** Only rows in (and slightly around) the viewport exist as DOM. Everything else is a plain string in a JS array. 100k lines of scrollback = 100k array entries, not 100k elements.
- **Hard-cap scrollback.** Default 10,000 lines, configurable. Past the cap, drop from the head. Unlimited scrollback is not a feature, it is a memory leak with a nice name.
- **Batch DOM writes into one `requestAnimationFrame`.** Never append per line as bytes arrive. Accumulate, write once per frame.
- **Never read layout in a write loop.** No `offsetHeight` / `getBoundingClientRect` / `scrollTop` reads interleaved with appends. Read all, then write all. Layout thrash is the classic way to turn a 2 ms frame into a 40 ms one.
- **`contain: content` on each block `<section>`.** Scopes layout and paint to the block so appending to the live block does not re-layout the whole scrollback.
- **`content-visibility: auto` on off-screen blocks.** The browser skips rendering work for blocks scrolled out of view — this is the native platform doing virtualization work for us, for free.
- **Revert `SplitText` after reveal.** Already mandated by `ANIMATION.md`; restated here because it is a memory rule as much as an animation one. One `<div>` per row, never reverted, is exactly failure mode #1.
- **No per-row Svelte components.** A `{#each}` over rows with a component per row is thousands of component instances. Rows are strings rendered into a block; the component boundary is the *block*.

## Weight from the expansion phases

Every feature in Phases 8–12 adds bytes, memory, or work to a process whose whole pitch is that it does not feel heavier than a real terminal. Four rules keep them honest.

- **Nothing new loads at startup.** Mermaid, a markdown parser, the export path, the PDF webview — all lazy, all loaded on first use. The cold-start budget (400 ms) does not move because a feature was added that most sessions never touch. Mermaid alone is larger than everything currently in the bundle.
- **Retained raw snapshots are counted.** Every block keeps the bytes it rendered from ([../decisions.md](../decisions.md)), so scrollback memory is now text *plus* AST *plus* rendered DOM. The 250 MB / 100k-line budget covers all three; it does not get raised to accommodate them. If it cannot be met, the AST is what gets dropped and re-derived on demand, not the raw bytes.
- **Decoded images are the sharpest edge.** They dwarf text and they are retained for the block's life. Cap decoded dimensions, and treat images as the first thing evicted when scrollback virtualization lands.
- **Export never runs on the UI thread.** A session export is large-scale string building. Chunk it or move it off-thread; a five-second freeze on "Export" is the same failure as a five-second freeze on `cat`.

## Animation cost

`ANIMATION.md` is binding. The performance-relevant subset, restated:

- Flood control (>40 pending rows → instant reveal) is a **performance** guard, not an aesthetic one. It is what keeps output honest under `npm install`.
- Off-screen blocks never animate.
- `will-change` only on elements mid-animation, removed after. A permanent `will-change` on every block is a permanent GPU layer per block.
- Transform and opacity only — anything else means layout or paint per frame.
- Under `prefers-reduced-motion`, the reveal path is skipped entirely, which is also the fastest path. Reduced motion should measurably beat normal mode on every budget above.

## xterm.js fallback

The alt-screen view is raw passthrough. It is also the one place where a mature, already-optimized renderer exists — use it as intended:

- **WebGL renderer**, with canvas fallback. Never the DOM renderer.
- **Dispose on alt-screen exit.** The instance, its addons, and its listeners. Do not keep a hidden xterm alive "in case" — it holds GPU textures.
- **Never intercept, never animate, never buffer.** Bytes go straight in. This view exists precisely so that `vim` and `htop` run at native speed.

## Measuring — no optimization without a number

A performance claim without a measurement is a guess. Before and after any change to the output path:

- **Throughput:** time `cat` of a 100 MB generated log. Compare against Windows Terminal and Alacritty on the same machine, same log. That ratio is the real score.
- **Latency:** typing latency under load — hold a key while a large `cat` runs. Input must stay responsive; this is where naive implementations collapse.
- **Memory:** RSS at start, after 100k lines, and after clearing scrollback. The third number matters most — if it does not return near the first, something leaks.
- **Idle:** process CPU over 60 s with the window focused and nothing running. Must be flat zero.

Keep a checked-in generator for the test log so the numbers are comparable across sessions and machines. Record results in [../tasks.md](../tasks.md) with the commit hash — a budget with no history cannot show regression.

Build measurements in release mode only. Dev-build numbers are meaningless and quoting them is worse than not measuring.

## Do not

- ❌ Ship an unbounded scrollback, in DOM or in memory.
- ❌ Send one IPC message per PTY read.
- ❌ Allocate or run a regex per line in the hot path.
- ❌ Interleave layout reads with DOM writes.
- ❌ Run a timer, poll, or `requestAnimationFrame` loop while idle.
- ❌ Re-parse a whole block from the top on every chunk.
- ❌ Add a dependency to the output path. Everything here is a few hundred lines of plain code; a library in the hot path is a black box you cannot profile.
- ❌ Optimize anything outside the output path before the budgets above are met.

## Open

- **Baseline numbers not yet taken.** The budget table is target-derived, not measured. First task once the block renderer streams real output: run the full measurement set, record actuals, and adjust any budget that turns out to be wrong in either direction — a budget nobody can hit gets ignored, and an easy one buys nothing.
- **Virtualization implementation undecided.** Hand-rolled windowing vs. leaning entirely on `content-visibility: auto`. The lazy path is native-CSS-first: measure with `content-visibility` alone at 100k lines before writing a windowing layer.
