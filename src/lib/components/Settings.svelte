<!--
  The settings overlay: Shift+Esc, or the gear. Bare Esc closes it, like any
  other surface that has taken the keyboard.

  It owns its own entrance and exit, its own markup and its own CSS, and it
  reads every control off the tables in `$lib/settings.ts` — so adding a mode
  is still a row there and nothing here. What it does *not* own is the state:
  the page holds the current values and does the applying, because applying a
  setting means writing `--accent` to `:root`, re-anchoring the tail and saving
  the file, none of which is this panel's business.

  Overlaid over the terminal with a blurred backdrop, per decisions.md — not a
  window, and not an extension surface.
-->
<script lang="ts">
  import gsap from "gsap";
  import { GLITCH_IN } from "$lib/anim.js";
  import {
    ACCENTS,
    FONT_MODES,
    REVEAL_MODES,
    SCROLL_MODES,
    WEDGES,
    type Accent,
    type FontMode,
    type RevealMode,
    type ScrollMode,
  } from "$lib/settings.js";

  let {
    fontMode,
    scrollMode,
    revealMode,
    accent,
    startupDir,
    startAsAdmin,
    isWindows,
    reduceMotion,
    onFont,
    onScroll,
    onReveal,
    onAccent,
    onStartupDir,
    onBrowse,
    onAdmin,
    onDismiss,
  }: {
    fontMode: FontMode;
    scrollMode: ScrollMode;
    revealMode: RevealMode;
    accent: Accent;
    startupDir: string;
    startAsAdmin: boolean;
    /** The *host*, not the shell — see the root-shell row, which is Unix only. */
    isWindows: boolean;
    reduceMotion: boolean;
    onFont: (next: FontMode) => void;
    onScroll: (next: ScrollMode) => void;
    onReveal: (next: RevealMode) => void;
    onAccent: (next: Accent) => void;
    onStartupDir: (next: string) => void;
    onBrowse: () => void;
    onAdmin: (next: boolean) => void;
    /** Asks the page to close. It goes back through `close()` below. */
    onDismiss: () => void;
  } = $props();

  let backdrop: HTMLElement | undefined = $state();
  let panel: HTMLElement | undefined = $state();

  /**
   * How far below its resting place the panel starts, as a fraction of the
   * viewport — a `dv` distance per ANIMATION.md, not a pixel constant.
   *
   * 6dvh rather than the 2dvh it was: the panel is centred now, so the travel
   * has to read as coming *from* somewhere. At 2dvh a centred panel just
   * appears with a twitch.
   */
  const PANEL_RISE = 0.06;

  // Entrance at ANIMATION.md's settings timing (0.34s). The backdrop and the
  // panel are two tweens over one gesture: the backdrop simply fades, the
  // panel is the focal element and carries the glitch.
  function panelIn(node: HTMLElement) {
    const rising = node.querySelector(".settings");
    gsap.from(node, { autoAlpha: 0, duration: reduceMotion ? 0.1 : 0.34, ease: "power3.out" });
    // Rises into place rather than sliding in from the right. A lateral entry
    // is the tell of a drawer, and this is not one — see decisions.md. The
    // amplitude is a `dv` distance.
    if (rising) {
      const rise = PANEL_RISE * window.innerHeight;
      if (reduceMotion) {
        // Skipped, not shortened. Simulated malfunction is exactly the class of
        // motion that reads as a real fault to someone who cannot filter it,
        // and this is a terminal, where a real fault is plausible.
        gsap.from(rising, { autoAlpha: 0, duration: 0.1 });
      } else {
        // Travel and opacity are deliberately two tweens with two eases and two
        // durations. Putting them on one tween is the version of this effect
        // that reads as a plain fade with a wobble.
        gsap.from(rising, { y: rise, duration: 0.35, ease: GLITCH_IN });
        gsap.from(rising, { autoAlpha: 0, duration: 0.28, ease: "steps(3)", delay: 0.05 });
      }
    }
    return {
      destroy() {
        gsap.killTweensOf([node, rising]);
      },
    };
  }

  /**
   * Play the exit and call `done` when it lands.
   *
   * Svelte tears an `{#if}` block out the instant the flag flips, so an exit
   * tween started from the click handler would animate a node that is already
   * gone. The tween owns the flag instead — which is why this hands the
   * callback back rather than closing anything itself: the flag is the page's.
   * Every close path goes through here, by design.
   */
  export function close(done: () => void) {
    if (!backdrop || !panel) {
      done();
      return;
    }
    gsap.killTweensOf([backdrop, panel]);
    // Faster than the entrance and eased *in*, so it accelerates away. The
    // panel is losing focus, so it gets no overshoot — see ANIMATION.md.
    //
    // It leaves *upward*, against the direction it arrived from. Enter and
    // leave being a mirror pair here is what stops the panel reading as
    // dropping back into a drawer it never came out of.
    gsap.to(panel, {
      autoAlpha: 0,
      y: -PANEL_RISE * window.innerHeight,
      duration: 0.2,
      ease: "power2.in",
    });
    gsap.to(backdrop, { autoAlpha: 0, duration: 0.2, ease: "power2.in", onComplete: done });
  }

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
</script>

<div
  class="settings-backdrop"
  bind:this={backdrop}
  use:panelIn
  onclick={(e) => {
    e.stopPropagation();
    onDismiss();
  }}
  role="presentation"
>
  <div
    class="settings"
    bind:this={panel}
    onclick={(e) => e.stopPropagation()}
    role="presentation"
  >
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
              onclick={(e) => {
                onFont(key as FontMode);
                glitchLabel(optionLabel(e.currentTarget));
              }}
            >
              <!-- Rendered in the font that mode gives to text outside a
                   container, so each wedge is its own sample. -->
              <span class="settings-option-label" style:font-family={def.outside}>{def.label}</span>
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
              onclick={() => onAccent(key as Accent)}
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
          onclick={(e) => {
            const label = optionLabel(e.currentTarget, scrollMode === "top" ? 1 : 0);
            onScroll(scrollMode === "top" ? "bottom" : "top");
            glitchLabel(label);
          }}
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
          onclick={(e) => {
            const label = optionLabel(e.currentTarget, revealMode === "reveal" ? 1 : 0);
            onReveal(revealMode === "reveal" ? "instant" : "reveal");
            glitchLabel(label);
          }}
        >
          <span class="switch-side" class:on={revealMode === "reveal"}>
            <span class="settings-option-label">{REVEAL_MODES.reveal.label}</span>
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

    <!-- Both rows below are promises about the next launch, not switches
         that change anything now. The shell's directory and the shell's
         token are fixed when it is spawned, and restarting the session
         under a user who is halfway through a command is not a thing a
         terminal gets to decide. The copy says so; it does not silently
         no-op. -->
    <section class="settings-card">
      <h2 class="card-title card-title-center">Session &middot; next launch</h2>
      <div class="path-row">
        <input
          class="path-input"
          type="text"
          placeholder="Startup directory — blank for the launch directory"
          value={startupDir}
          onchange={(e) => onStartupDir(e.currentTarget.value)}
        />
        <button class="path-browse" onclick={onBrowse}>Browse</button>
      </div>
      <!-- Unix only, and absent rather than disabled on Windows. What it
           does here is wrap the spawned shell in `sudo -E` — the GUI stays
           unprivileged, which is the whole reason it can be a setting at
           all. Windows elevation has to be the entire process, and a
           process cannot raise its own token, so there is nothing a switch
           could honestly do; the way to get an elevated session there is to
           start the app elevated. A switch that explained that instead of
           doing it would be a paragraph wearing a control's clothes. -->
      {#if !isWindows}
        <button
          class="switch-row"
          title="Applies when VAD/OS is next started"
          onclick={(e) => {
            const label = optionLabel(e.currentTarget, startAsAdmin ? 0 : 1);
            onAdmin(!startAsAdmin);
            glitchLabel(label);
          }}
        >
          <span class="switch-side" class:on={!startAsAdmin}>
            <span class="settings-option-label">Standard</span>
          </span>
          <span class="switch" class:on={startAsAdmin}><span class="switch-knob"></span></span>
          <span class="switch-side" class:on={startAsAdmin}>
            <span class="settings-option-label">Root shell</span>
          </span>
        </button>
      {/if}
    </section>

    <div class="settings-foot">Esc to close</div>
  </div>
</div>

<style>
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
  /* A path is text of unbounded length in a panel of fixed width, so the field
     takes the slack and the button is sized to its own label. Mono because the
     value is a path and alignment of separators is what makes one scannable. */
  .path-row {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }

  .path-input {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    background: var(--surface-inset);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    transition: border-color 0.25s ease;
  }

  .path-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .path-input::placeholder {
    color: var(--text-ghost);
  }

  .path-browse {
    flex: none;
    padding: 0 12px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: border-color 0.25s ease, color 0.25s ease;
  }

  .path-browse:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

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
</style>
