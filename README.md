# VAD/OS

**Status:** In development — command boundaries working, block renderer in progress.

![VAD/OS](src/lib/assets/main.png)
![Markdown output](src/lib/assets/md.png)
![Notifications](src/lib/assets/notifi.png)

A cross-platform terminal for Windows and Linux that renders command output as structured markdown blocks instead of a raw text stream.

## Why

Existing terminals split along OS lines — the ones that feel good on Linux often don't exist or don't feel native on Windows, and vice versa. On top of that, raw terminal output is hard to scan: commands, logs, and results blur together with no visual separation.

VAD/OS solves both at once: one terminal, same experience on both platforms, with output that's actually readable.

## What it does

- **One terminal, both platforms.** Identical functionality and visuals on Windows and Linux. No feature gaps, no "works better on X."
- **Markdown-structured output.** Every command becomes a distinct block instead of a wall of text:
  - The command renders as a `#` heading, preceded by a `---` divider.
  - Running output (downloads, progress bars, spinners) is contained in a live-updating fenced code block, so it can't break the layout.
  - On completion, a closing `##` heading shows the result — green for success, red for failure — followed by a `---` divider.
- **Typewriter reveal.** Output animates in row by row as it arrives, with hard flood control so a `npm install` never falls behind reality.
- **Modern, intentional styling.** Dark theme, muted accent colours, thin rounded borders. A terminal that looks designed, not default.
- **Font modes.** Not a font picker — a rule about where each font applies. **Mixed** (default) puts mono outside modules and sans inside them; **Mixed Reverse** swaps that; **Sans** and **Modern** apply one font throughout. Code blocks, inline code, ASCII banners, and the raw view stay monospace in every mode, because alignment is load-bearing there.
- **Sticky command lines.** When a block's output runs taller than the screen, the command line that produced it pins to the top — the same thing an editor does with an enclosing function name — so you always know what you are looking at.
- **Full-screen app compatibility.** Programs that take over the screen (`vim`, `htop`, `claude`) fall back to a raw xterm.js view at native speed. Markdown rendering applies only to standard command output.

## Where it's going

A prettier terminal is not a reason to switch. Treating command output as a **document** — something you can fold, link, theme, export, and search structurally — is.

- **Live markdown rendering** with interactive code blocks: copy, or run after an explicit confirmation showing exactly what will be sent.
- **Collapsible output**, with stack traces folded to the frames that matter.
- **Mermaid diagrams, images, and video** rendered inline in the block that printed them.
- **AI output that reads like documentation.** `claude` and friends emit markdown into terminals that cannot show it. This one can.
- **Split view** — rendered on one side, raw terminal on the other, so you can always see what was actually printed.
- **Export** any block or a whole session to Markdown, HTML, or PDF.
- **Themes as data** over a fixed token contract, hot-reloaded from a file.
- **Any shell:** PowerShell, cmd, WSL, Git Bash, bash, zsh, fish, or a binary you point it at.

Two rules keep all of that honest, and they are why this is not a markdown viewer with a shell attached:

**Compatibility first, beauty second.** Plain and ANSI output renders exactly as it is. Markdown is entered on evidence — a program declaring it, or a detector clearing a high bar — never assumed. A terminal that mangles `ls` to look designed is a terminal you uninstall on day one.

**Every block can be toggled back to its raw bytes.** If the renderer gets it wrong, one keystroke undoes it. That is what makes rendering safe to be wrong about.

Planned in [.claude/README.md](.claude/README.md), phases 8–12.

## How it works

Two renderers over one PTY stream:

- **Block renderer** (default) — plain DOM, one `<section>` per command. This is what gets styled and animated.
- **xterm.js** (fallback) — mounted only on alt-screen enter, for full-screen TUI apps. Raw passthrough, never intercepted, never animated.

Command boundaries come from **OSC 133** shell integration, injected at spawn rather than by editing your dotfiles. Rust is a dumb pipe: it streams raw bytes and parses nothing, because a marker delivered out-of-band from the bytes around it arrives out of order and files output under the wrong command.

**Stack:** Tauri v2 · SvelteKit (SPA) · portable-pty · xterm.js · GSAP

## Performance

A terminal is used hundreds of times a day, so animation and block chrome are not allowed to cost anything you can feel. The project runs against a fixed budget table — 8 ms keystroke-to-glyph, 40 MB/s sustained throughput, 0.0 % idle CPU, bounded RSS across a full day of scrollback — measured against Windows Terminal and Alacritty on the same machine.

The rules that keep it there (IPC coalescing, scrollback virtualization, no per-line allocation in the hot path) are binding, not advisory. See [.claude/docs/PERFORMANCE.md](.claude/docs/PERFORMANCE.md).

## Shells

VAD/OS is the terminal; the shell is a process it hosts. PowerShell is the Windows default because it ships with Windows and is actively maintained — not because anything is built on it. Nothing above the PTY knows which shell is running.

bash, zsh, fish, and PowerShell are the initial targets, with WSL distributions, Git Bash, `cmd`, and any custom binary following. Beyond those, shells are tiered by how much OSC 133 marker fidelity they can provide — Nushell has it natively, tcsh and Xonsh have full prompt hooks, POSIX shells like dash and ksh get a degraded path, and `cmd.exe` can never report exit codes at all. See [.claude/shells.md](.claude/shells.md).

## Build

Requires the [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) — Rust toolchain, and WebView2 on Windows (preinstalled on Windows 11).

```bash
npm install
npm run tauri dev
```

To produce a real installable app:

```bash
npm run tauri build
```

This writes three artifacts under `src-tauri/target/release/`:

| Artifact | Path |
|---|---|
| Standalone executable | `vados.exe` |
| Windows installer | `bundle/nsis/VADOS_0.2.0_x64-setup.exe` |
| MSI package | `bundle/msi/VADOS_0.2.0_x64_en-US.msi` |

On Linux the same command produces an AppImage and a `.deb` under `bundle/`.

The installer adds a Start menu entry, desktop shortcut, and uninstaller. The bare `vados.exe` also runs on its own, but needs the `resources/` directory beside it — that's where the shell integration snippets live.

Builds are unsigned, so Windows SmartScreen will warn on first run until a code-signing certificate is added.

## Non-goals

- Replacing full TUI rendering for alt-screen applications. Those get a real terminal, deliberately.
- Multiple tabs. People open a second window instead.
- A plugin system. Settings are a fixed, curated GUI, not an extension surface.
- Real containerisation. Commands run on the host; "container" here means the UI-level fenced block that isolates live output.

## Documentation

| Doc | Purpose |
|---|---|
| [.claude/README.md](.claude/README.md) | Index of all working docs and phase plans |
| [.claude/architecture.md](.claude/architecture.md) | Stack, the dual-renderer design, the render decision |
| [.claude/decisions.md](.claude/decisions.md) | Settled decisions and the reasoning behind them |
| [.claude/tasks.md](.claude/tasks.md) | Live backlog |
| [.claude/shells.md](.claude/shells.md) | Shell support, tiered by OSC 133 marker fidelity |
| [.claude/docs/ANIMATION.md](.claude/docs/ANIMATION.md) | Binding animation rules |
| [.claude/docs/PERFORMANCE.md](.claude/docs/PERFORMANCE.md) | Binding performance budgets and rules |

## Demo

Press **F2** in a dev build to capture the window. The shot lands in `demo/` and this section is rewritten from whatever is in that directory — do not edit between the markers by hand.

<!-- demo:start -->

![vados-1786045933.png](demo/vados-1786045933.png)

![vados-1786045955.png](demo/vados-1786045955.png)

![vados-1786045965.png](demo/vados-1786045965.png)

![vados-1786045977.png](demo/vados-1786045977.png)

![vados-1786045993.png](demo/vados-1786045993.png)
<!-- demo:end -->

---

**Last updated:** 2026-08-06
