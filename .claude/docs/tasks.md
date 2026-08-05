# Tasks

Live backlog. Phase docs hold the plan; this holds everything that does not fit a phase.

---

## Blockers

- [ ] **Border hover animation source.** Needs to be ported from the portfolio project. Blocks the block-chrome work in Phase 3 and the tween spec in `ANIMATION.md` (`## Open` section). Paste the implementation or point at the repo/file.
- [ ] **Phase 1 manual verification.** Code is complete and builds, but PTY behavior needs a human at the keyboard: `git status`, `npm --version`, `vim` + `:q`, Ctrl+C interrupt, window resize reflow.

---

## Open questions

- [ ] **Claude Sans Modern** — where is it sourced from, and does it ship bundled with the app? (Phase 4)
- [ ] **Accent palette values** — blue, yellow, and orange still need picking by eye. Each should be "vibrant in its own style", not a hue rotation of the indigo. (Phase 4)
- [ ] **Markdown renderer choice** — must be safe against arbitrary command output being read as markup, and fast on streaming content. (Phase 3)
- [ ] **Incremental vs. on-complete markdown rendering** — incremental looks better but re-parsing every chunk is expensive. (Phase 3)
- [ ] **Fish shell** — no clean init-flag injection path for OSC 133. Document a manual rc line, or drop fish from v1? (Phase 2)
- [ ] **`cwd` change semantics** — applying a new startup directory to an already-running shell. Next-launch only, or offer a restart action? (Phase 6)
- [ ] **File panel placement** — persistent sidebar or summoned? (Phase 7)

---

## Known issues

- **npm 11 blocks esbuild's postinstall.** A fresh clone needs `npm approve-scripts esbuild` or Vite will not run. Worth a note in the README setup steps.
- **Bash tool PATH misses `~/.cargo/bin`** until a terminal restart. Workaround: `export PATH="$PATH:/c/Users/vadim/.cargo/bin"`.
- **Harmless linker warning on every Windows build** — German-language `linker stdout` message about `.dll.lib` / `.dll.exp` creation. Not an error.

---

## Deferred by design

Rejected or postponed with reasons — see [decisions.md](decisions.md) before reopening.

- Multi-tab / split panes — rejected, a second window covers it.
- Plugin system — rejected, settings are a fixed curated GUI.
- Real Docker containerisation — rejected, "container" means the UI output block.
- SSH / remote sessions.
- Shells beyond bash / zsh / fish / PowerShell.
- Config schema migration and versioning — add on the first breaking schema change, not before.
- Full TUI rendering for alt-screen apps — they get the raw xterm fallback, by design.

---

## Future ideas

Not committed. Parked here so they stop occupying working memory.

- **Scrollback cap or virtualisation.** An hours-long session accumulates unbounded DOM. Likely needed before the app is genuinely usable all day; currently unmeasured.
- **Command block collapse / fold.** Long output collapses to its heading and result. Pairs naturally with the Phase 7 keyboard navigation.
- **Copy block output.** One action to copy a command's output without its chrome.
- **Re-run a block.** Click a past command heading to run it again.
- **Search across scrollback.** Structured blocks make this much better than a raw terminal's find.
- **Exit code in the block heading**, not only the result line — helps when scanning a long history.
- **Arch packaging.** AUR or a plain binary release; the Linux build has not been attempted yet at all.
- **First-run experience.** The ASCII banner from the concept screenshots, plus whatever a new user needs to see once.
