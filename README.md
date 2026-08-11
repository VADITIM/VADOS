# VAD/OS

A terminal for people who still want a terminal

VAD/OS is a cross platform terminal for Windows and Linux that treats output as structured information instead of a continuous stream of text.


<!-- demo:start -->
![vados-1786229389.png](demo/vados-1786229389.png)

![vados-1786229398.png](demo/vados-1786229398.png)

![vados-1786229406.png](demo/vados-1786229406.png)

![vados-1786229493.png](demo/vados-1786229493.png)

![vados-1786229641.png](demo/vados-1786229641.png)
<!-- demo:end -->

It is not another AI terminal.
It is not a prettier terminal.
It is not trying to replace the shell.

It addresses a long-standing issue: terminals show what happened, but not what it means.

VAD/OS keeps the terminal model intact while adding structure, hierarchy, and navigation to output.

The result sits between CLI and GUI without replacing either.

---

## The problem

Traditional terminals are built on one primitive: text.
Commands, output, errors, logs, and help are all just text.

Humans reconstruct meaning from this stream, even though the system already has enough context to help.

VAD/OS changes presentation without changing the terminal contract.

Commands become blocks with:
- structured output
- visible hierarchy
- clear results
- preserved raw text

**The terminal becomes a readable history of actions.**

---

Markdown is not the point
Markdown is only one possible format.

VAD/OS is built on structured nodes, not markup.
Output can be plain text, ANSI, or structured data.
The renderer consumes structure directly instead of parsing text into UI.

**Structure is the product, not Markdown.**

---

## Render only when safe

VAD/OS only interprets output when it is confident.
If structure is unclear, it falls back to raw terminal output.
A false interpretation is worse than no interpretation.
So the system prefers safe failure over guessing.

---

## You are always in control

Every command has multiple views:
- raw output
- structured view
- rendered view

Nothing is lost or replaced.
The raw terminal remains first-class.

---

## Commands become blocks

Each command is treated as a unit containing:
- command text
- working directory
- output
- exit status
- duration
- timestamp

This turns a session into navigable history instead of a scrollback buffer.

---

## Visual hierarchy is information

Color, spacing, and animation communicate meaning:
- commands differ from output
- errors differ from logs
- important data is visually emphasized

Animation is used only to guide attention, not decorate.

---

## CLI first, GUI where it helps

The shell remains primary.

The GUI only assists where it improves navigation or understanding:
- session browsing
- command search
- directory view
- structured output panels

It does not replace the terminal.

---

## A terminal that stays compatible

VAD/OS must behave like a normal terminal when needed.
Full-screen apps, SSH, tmux, and CLI tools must work unchanged.
Compatibility is a requirement, not a feature.

---

## Architecture

- PTY runs the shell
- output is captured
- commands are detected
- structure is classified
- nodes are rendered
- raw output is preserved

No rewriting of program output is required.

---

Raw fidelity

Rendered output must never destroy information.
Raw bytes remain available independently of the UI.

The system separates:
- what the terminal shows
- what the program produced

---

## External tools

Command blocks already contain rich context.
This can be exported or consumed by other tools.
VAD/OS provides structure; external tools decide how to use it.

---

## Cross platform

VAD/OS targets Windows and Linux with consistent behavior.
Shells are hosted processes, not the core dependency.

---

## Performance

The terminal must handle long sessions, continuous output, and interactive tools without lag.
Animation and rendering are strictly performance-aware.

---

## What makes VAD/OS different

It combines:
- real terminal compatibility
- structured output
- conservative interpretation
- raw fidelity
- visual hierarchy
- command-based navigation
- minimal GUI assistance

All built around one idea:
**terminal output already contains structure; it just isn’t exposed.**

---

## Roadmap

### Foundation
PTY, command detection, blocks, styling, navigation.

### Hardening
Raw fidelity, compatibility, performance validation.

### Expansion
Document system, search, export, richer rendering.

---

## Current status

### Pre-1.0.

Core PTY and command blocks exist.
Rendering and structure are in progress.
Linux validation and full hardening are ongoing.

---

## Goal

Not a prettier terminal.
Not a smarter terminal.
A terminal that finally treats output as information, not just text.

CLI when you want it.
GUI when it helps.
Raw when it matters.
Structure when it is safe.