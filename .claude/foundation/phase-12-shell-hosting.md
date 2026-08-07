# Phase 12 — Shell Hosting

**Status: not started.** Blocked on [phase-6-config.md](phase-6-config.md) for the config schema and the settings surface.

[../shells.md](../shells.md) already tiers shells by OSC 133 marker fidelity and picks an implementation order. This phase is the other half: the machinery that lets a user *choose* one, and the Windows-specific hosts that tiering does not cover.

## The premise

VAD/OS is the terminal; the shell is a process it hosts ([../decisions.md](../decisions.md)). Today `build_shell_command` hardcodes PowerShell on Windows and `$SHELL` on Linux. That is a default, and it needs to stop being the only option.

PowerShell stays the Windows default — preinstalled, maintained, and what most Windows developers already use. Nothing above the PTY may depend on it.

## Scope

- Config-driven shell selection.
- Runtime detection of what is actually installed.
- WSL and Git Bash as first-class Windows hosts.
- Removing the PowerShell assumptions currently baked into the frontend.

## Config

Extends the Phase 6 schema. A shell entry is data, not code ([../shells.md](../shells.md)):

```toml
[shell]
default = "powershell"

[[shell.profiles]]
name      = "PowerShell"
binary    = "powershell.exe"
args      = ["-NoExit", "-Command"]
snippet   = "integration.ps1"
injection = "command"          # command | rcfile | zdotdir | init-command | env

[[shell.profiles]]
name      = "Ubuntu (WSL)"
binary    = "wsl.exe"
args      = ["-d", "Ubuntu", "--"]
snippet   = "integration.bash"
injection = "rcfile"
```

Adding a tier 2 or tier 3 shell must not touch Rust. If it does, the abstraction is in the wrong place.

## Detection

Only offer shells that exist on the machine. A dropdown listing `elvish` on a box without it is a bug generator.

- Probe `PATH` for each known binary at startup, once, and cache for the session.
- WSL: `wsl.exe --list --quiet` enumerates installed distributions. Each becomes its own profile — "WSL" alone is not a shell.
- Git Bash: it is usually not on `PATH`. Look for `%ProgramFiles%\Git\bin\bash.exe`, then the registry key Git for Windows writes (`HKLM\SOFTWARE\GitForWindows\InstallPath`). Do not guess further than that; a custom install is what the custom-binary field is for.
- A configured profile whose binary has since disappeared must fail with a visible message and fall back to the default, not fail silently into a dead pane.

## WSL

The case with the most sharp edges, and the one that matters most on Windows.

- **Path translation.** OSC 7 from inside WSL reports `/home/user/x`. The Windows side of the app — the file panel, `open <file>`, image resolution — needs `\\wsl$\Ubuntu\home\user\x`. Translate at the boundary, once, in the cwd handler. Not in five places.
- **`wsl.exe` is a launcher, not the shell.** The shell inside is bash, zsh, or fish, and the integration snippet has to reach *it*. `wsl.exe -d Ubuntu -- bash --rcfile <path>` works, but `<path>` must be a **Linux** path — a Windows resource path passed through is not visible inside the distribution. Either copy the snippet into the distribution or reference it via `/mnt/c/...`.
- Line endings. A CRLF snippet fails inside WSL in ways that look like a shell bug. Write the resource files LF and keep them LF.
- Exit codes and signals cross the boundary intact. Ctrl+C does not need special handling.

## Git Bash

- MSYS2 bash under ConPTY. The `integration.bash` snippet applies unchanged.
- Path style is `/c/Users/...`, a third convention alongside Windows and WSL. The same single translation point handles it; do not add a second.
- MSYS2 sets `TERM` itself and can override what the PTY provides. Verify the terminal type the shell believes it has, rather than the one that was passed.

## cmd.exe

Structurally limited — `A` and `B` markers only, exit codes unrecoverable. Fully analysed in [../shells.md](../shells.md), ranked last for good reasons.

Consequence for this phase: **cmd blocks render with no result heading and no success/failure tint.** That is the shell's limitation, not a to-do. Say so in the settings UI. Do not ship a heading that lies.

## Removing the PowerShell assumptions

The frontend currently has PowerShell-shaped code in it. It has to go, and this is the phase that owns it.

- **`PS_PROMPT`** in `src/routes/+page.svelte` strips a literal PowerShell prompt template out of the mirrored input row. It is correct only for the shipped `integration.ps1` prompt and for no other shell.
- The general fix is to stop matching the prompt string at all: OSC 133 `B` marks the end of the prompt, and the input is what follows it. That was tried once via a remembered column (`promptCol`) and reverted because the column went stale on resize and on chunk boundaries — see the fixed entry in [../tasks.md](../tasks.md). **The regex was the right call at the time; it is not the right call for four shells.** The correct version marks the position rather than remembering a number, the same way block snapshots use an `IMarker` instead of a row index.
- Until that lands, any second shell inherits a broken input mirror. Treat it as the first task of this phase, not a cleanup afterwards.

## Verify

- Switch shells in settings; a new session spawns in the selected shell and blocks work.
- Blocks work in bash, zsh, PowerShell, and WSL bash — same code path, no per-shell branch in the renderer.
- WSL: `cd` inside the distribution updates the cwd panel with a translated, valid path.
- Git Bash: `cd /c/Users` resolves in the panel.
- cmd: blocks open and close; the missing result heading is visible as a documented state, not a rendering bug.
- A profile pointing at a nonexistent binary shows an error and falls back.
- The input mirror is correct in every shell above, including after a window resize mid-typing.

## Gotchas to watch

- **ConPTY rewrites parts of the sequence stream.** Anything depending on a specific escape surviving must be verified on Windows on its own; a Linux pass proves nothing. The standing alt-screen blocker in [../tasks.md](../tasks.md) is the live example.
- **Never edit user dotfiles.** Injection only, in every shell, including WSL distributions. Repeated from [../shells.md](../shells.md) because WSL makes it tempting — writing one line into a distribution's `.bashrc` looks harmless and is exactly the thing people uninstall a terminal for.
- **Wrap, never clobber, an existing prompt.** Applies to every shell whose prompt is a function or callable.
- **Do not let shell support leak into the renderer.** OSC 133 is OSC 133. If the frontend needs a per-shell branch, the snippet is wrong — fix the snippet.
