# Shell Support

Which shells VAD/OS can spawn, and — the part that actually matters — how much block fidelity each one can give us.

## The real axis

"Supporting a shell" is not a spawn-a-process problem. Every shell in this document already runs fine under portable-pty today; point the config at a binary and it works. What differs is whether the shell can emit **OSC 133** markers, because those are what produce blocks. Without them there is no block boundary, no exit code, no result heading — just a scrolling stream, which is the thing this terminal exists not to be.

So shells are tiered by **marker fidelity**, not by popularity. The four markers:

| Marker | Meaning | Needs |
|---|---|---|
| `A` | prompt start | prompt string can contain an escape sequence |
| `B` | command start (end of prompt) | same |
| `C` | output start | a pre-execution hook, or `B` immediately preceding |
| `D;<code>` | command done + exit status | a post-execution hook, **or** `$?` expanded at next prompt print |

The `D` trick matters and unlocks most of the legacy tier: a shell with no post-exec hook can still report the previous command's exit code by emitting `D;$?` at the **start of the next prompt**, before `A`. Late by one prompt, correct in content. The block closes when the next one opens, which is when we would repaint anyway.

## Tiers

### Tier 1 — native OSC 133, no snippet needed

**Nushell.** Has shell integration built in. One config line:

```nu
$env.config.shell_integration.osc133 = true
```

Also emits OSC 7 (cwd) and OSC 2 on its own. This is the cheapest shell on the list to support, not the most expensive — it should be reordered ahead of everything in the priority list below.

### Tier 2 — full fidelity via injected snippet

Prompt hooks exist; all four markers, exit code on time.

| Shell | Injection | Hook |
|---|---|---|
| PowerShell | `-NoExit -Command` | wrap `prompt` function *(shipped)* |
| bash | `--rcfile` | `PROMPT_COMMAND` + `DEBUG` trap |
| zsh | `ZDOTDIR` | `precmd` / `preexec` |
| fish | `--init-command` | `fish_prompt` / `fish_preexec` / `fish_postexec` events |
| Xonsh | `XONSHRC` env var | `$PROMPT` + `events.on_precommand` / `on_postcommand` |
| Elvish | `-rc` | `edit:before-readline` / `edit:after-command` |
| tcsh / csh | `-c` is not viable; use `$HOME`-scoped rc or a documented manual line | `precmd` / `postcmd` special aliases, `$status` |

tcsh landing in the same tier as zsh is not a typo — its `precmd`/`postcmd` aliases are a genuine pre/post-exec hook pair. It is technically easier than dash.

**fish's `--init-command` closes the Phase 2 open question.** The plan assumed fish had no injection path and would need a manual rc edit. It does have one; use it, drop the manual step.

**Xonsh caveat:** `$PROMPT` accepts a callable, so wrap the user's existing prompt by capturing it and calling through — same rule as PowerShell. Never overwrite it.

### Tier 3 — degraded, exit code one prompt late

POSIX shells with no hooks, only a `PS1` that undergoes parameter expansion at print time. One snippet covers all of them, sourced via `$ENV`:

```sh
# $ENV points here for interactive POSIX shells
PS1="\033]133;D;\$?\007\033]133;A\007${PS1}\033]133;B\007"
```

Covers **dash**, **ksh**, **mksh**, and `/bin/sh` in any minimal container. What is lost versus tier 2: no `C` marker (output start is inferred as immediately after `B`, which is correct in practice), and `D` arrives with the next prompt rather than at true completion. A long-running command's block therefore stays "open" until the prompt returns — visually identical, since that is also when the user learns it finished.

Do not write three near-identical snippets here. One POSIX snippet, three config entries pointing at it.

### Tier 4 — `cmd.exe`, structurally limited

Ranked last on capability, whatever its ranking on demand. `cmd.exe` has **no prompt function, no pre-exec hook, no post-exec hook.** The only lever is the `PROMPT` environment variable, which on Windows 10+ supports `$E` as an ESC literal:

```bat
PROMPT=$E]133;A$E\$P$G$E]133;B$E\
```

That buys `A` and `B` — block boundaries work, command text is captured, blocks render.

**Exit codes cannot be recovered.** `PROMPT` is expanded at print time but `%ERRORLEVEL%` is substituted when the variable is *set*, so a literal `%ERRORLEVEL%` in `PROMPT` freezes at its value from initialization. Delayed expansion does not apply to prompt printing. There is no hook to run per command.

Consequence: **cmd blocks have no result heading and no success/failure tint.** That is a permanent limitation of the shell, not a to-do. Treat it as a documented degraded mode and say so in the settings UI rather than shipping a heading that lies. If exit codes on Windows matter to a user, PowerShell is right there and is the default.

Given that, the honest recommendation is to move cmd behind dash in the priority list — it is the most work for the least fidelity, and its audience already has a full-fidelity shell available on the same machine.

## Suggested order

Reordered from the original by cost-to-fidelity ratio, not by audience size:

1. **Nushell** — config toggle, zero snippet, and its structured-table output is the best possible showcase for block rendering. Highest impact, lowest cost, do it first.
2. **fish** — snippet is small, `--init-command` exists, and it closes a standing open question.
3. **Xonsh** — full fidelity, and Python-shaped output pairs well with markdown blocks.
4. **POSIX snippet** (dash / ksh / mksh) — one file, three config entries. Cheap breadth.
5. **Elvish** — full fidelity, small audience, no surprises.
6. **tcsh** — full fidelity, niche but genuinely easy.
7. **cmd.exe** — most work, permanently degraded, audience has PowerShell.

The original list put Nushell and Xonsh first for UX reasons and that holds; it is only cmd's position that changes materially.

## Implementation notes

- **Config, not code.** A shell entry is `{ binary, args, injection method, snippet path }` in the TOML. Adding tier 2/3 shells after the first two should not touch Rust. If it does, the abstraction is in the wrong place.
- **All snippets live together** as Tauri resources, one file per shell plus the shared POSIX one. Same open question as Phase 2: resource path resolution across both platforms.
- **Never edit user dotfiles.** Injection only. A terminal that writes to `~/.zshrc` on first launch is a terminal people uninstall.
- **Wrap, never clobber, an existing prompt.** Applies to every shell where the prompt is a function or callable: PowerShell, fish, Xonsh, Elvish.
- **Detect available shells at runtime** and only list what exists on the machine. A settings dropdown offering `elvish` on a box without it is a bug generator.
- **The parser does not change per shell.** OSC 133 is OSC 133. If a shell needs special-casing in the frontend parser, the snippet is wrong — fix the snippet.
- Nothing here touches [../../PERFORMANCE.md](../../PERFORMANCE.md) budgets: markers are a handful of bytes per prompt, and the parser already scans every byte once regardless.

## Open

- **Tier 3 verification.** The `PS1` expansion behaviour above needs confirming per shell — POSIX specifies parameter expansion on `PS1`, but dash, ksh93, and mksh should each be checked directly rather than assumed. Test before shipping the shared snippet.
- **cmd `$E` support floor.** `$E` requires a recent Windows 10 build. Verify, and decide whether cmd is offered at all on older ones.
- Whether tier 3/4 shells are exposed in the settings GUI at all, or left as hand-edited TOML for the people who actually want them.
