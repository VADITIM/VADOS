<script lang="ts">
  import { onMount } from "svelte";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import "@xterm/xterm/css/xterm.css";

  let host: HTMLDivElement;

  onMount(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'DejaVu Sans Mono', monospace",
      fontSize: 14,
      theme: { background: "#0a0a0c", foreground: "#d4d4d8" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // Raw bytes: decoding is left to xterm so multi-byte characters split
    // across reads are reassembled correctly.
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (bytes) => term.write(new Uint8Array(bytes));

    const ready = invoke("pty_spawn", {
      cols: term.cols,
      rows: term.rows,
      cwd: null,
      onData,
    });

    term.onData((data) => invoke("pty_write", { data }));

    const observer = new ResizeObserver(() => {
      fit.fit();
      // Resizes before the shell has spawned are harmless; the initial size is
      // already passed to pty_spawn.
      ready.then(() => invoke("pty_resize", { cols: term.cols, rows: term.rows }));
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      term.dispose();
    };
  });
</script>

<div class="terminal" bind:this={host}></div>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    background: #0a0a0c;
  }

  .terminal {
    height: 100vh;
    padding: 8px;
    box-sizing: border-box;
  }
</style>
