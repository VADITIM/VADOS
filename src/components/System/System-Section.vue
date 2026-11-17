<script setup lang="ts">
import { ref } from 'vue';
import { gsap } from 'gsap';

import LiftText from '@/components/Misc/Lift-Text.vue';
import Module from '@/components/Misc/Module.vue';
import SweepLabel from '@/components/Misc/Sweep-Label.vue';
import { accentStyle, inkFor, setStandingAccent, useAccentRoom } from '@/modules/accentRoom';
import { SWEEP_GROW_SECONDS, SWEEP_RETRACT_SECONDS } from '@/modules/motionConstants';
import { isReducedMotion } from '@/modules/scrollEngine';
import { useSectionReveal } from '@/modules/sectionReveal';
import {
  SYSTEM_VERSION,
  systemAccents,
  systemFigures,
  systemSteps,
  systemPlatforms,
} from '@/modules/systemRegistry';

const COUNT_WIDTH = 2;

const root = ref<HTMLElement | null>(null);
const wipe = ref<HTMLElement | null>(null);
const accent = ref(systemAccents[0].hex);

let wipeTimeline: gsap.core.Timeline | null = null;

useSectionReveal(root);
useAccentRoom(root, accent);

function applyAccent(hex: string): void {
  accent.value = hex;
  setStandingAccent(hex);
}

function chooseAccent(hex: string): void {
  if (hex === accent.value) return;
  const bar = wipe.value;
  if (!bar || isReducedMotion()) {
    applyAccent(hex);
    return;
  }
  wipeTimeline?.kill();
  gsap.set(bar, { scaleX: 0, opacity: 1, transformOrigin: 'left center', backgroundColor: hex });
  wipeTimeline = gsap
    .timeline()
    .to(bar, { scaleX: 1, duration: SWEEP_GROW_SECONDS, ease: 'power3.inOut' })
    .call(() => applyAccent(hex))
    .set(bar, { transformOrigin: 'right center' })
    .to(bar, { scaleX: 0, duration: SWEEP_RETRACT_SECONDS, ease: 'power3.inOut' })
    .set(bar, { opacity: 0 });
}

const statementLines = [
  'VAD/OS Application Systems is a closed library of skills, animations, timelines, and UI components.',
  'A design language that acts as both guide and ruler.',
  'Used correctly with AI, it becomes especially powerful and goes well beyond blunt, generic UI/UX design, guiding the eyes with impact & reaction, not just demonstration.',
];

function paddedNumber(value: number): string {
  return String(value).padStart(COUNT_WIDTH, '0');
}
</script>

<template>
  <section id="system" ref="root" class="system" :style="accentStyle(accent)">
    <span ref="wipe" class="system-wipe" aria-hidden="true"></span>
    <header class="system-header">
      <SweepLabel class="micro-label tabular" tag="p" :text="`( The system · version ${SYSTEM_VERSION} )`" />
      <LiftText class="system-title" tag="h2" text="V/AS" unit="character" is-display />
      <blockquote class="system-statement">
        <LiftText v-for="line in statementLines" :key="line" class="statement-line" tag="p" :text="line" unit="block" />
      </blockquote>
    </header>

    <ul class="system-figures">
      <li v-for="figure in systemFigures" :key="figure.label" class="system-figure">
        <span
          class="figure-value reveal-count tabular"
          :data-count-to="figure.value"
          :data-count-width="COUNT_WIDTH"
          >{{ paddedNumber(figure.value) }}</span
        >
        <span class="micro-label">{{ figure.label }}</span>
      </li>
    </ul>

    <div class="system-columns">
      <ol class="system-steps">
        <li v-for="(step, stepIndex) in systemSteps" :key="step.title" class="system-step">
          <span class="step-number tabular reveal-panel">{{ paddedNumber(stepIndex + 1) }}</span>
          <div class="step-copy">
            <LiftText class="step-title" tag="h3" :text="step.title" unit="block" />
            <LiftText class="step-detail" tag="p" :text="step.detail" unit="block" />
          </div>
        </li>
      </ol>

      <div class="system-aside">
        <Module>
          <ul class="accent-slabs">
            <li v-for="choice in systemAccents" :key="choice.hex">
              <button
                class="accent-slab"
                type="button"
                :class="{ 'is-chosen': choice.hex === accent }"
                :style="{ background: choice.hex, color: inkFor(choice.hex) }"
                :aria-pressed="choice.hex === accent"
                @click="chooseAccent(choice.hex)"
              >
                <span class="slab-name">{{ choice.name }}</span>
                <span class="slab-hex tabular">{{ choice.hex }}</span>
              </button>
            </li>
          </ul>
        </Module>
        <div class="system-platforms">
          <p class="micro-label">Platforms it is ported to</p>
          <ul class="platform-list">
            <li v-for="platform in systemPlatforms" :key="platform" class="platform">{{ platform }}</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.system {
  position: relative;
  display: grid;
  gap: clamp(3rem, 6vw, 6rem);
  padding: 6rem $gutter 8rem;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: $gutter;
    right: $gutter;
    height: 1px;
    background: $divider-section;
  }

  @include verticalLayout {
    padding-top: 4.5rem;
  }
}

.system-wipe {
  position: absolute;
  inset: 0;
  z-index: 10;
  opacity: 0;
  transform: scaleX(0);
  transform-origin: left center;
  pointer-events: none;
}

.system-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'label label'
    'title statement';
  align-items: end;
  gap: 1rem clamp(2rem, 5vw, 6rem);

  > :first-child {
    grid-area: label;
  }

  @include verticalLayout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'label'
      'title'
      'statement';
  }
}

.system-title {
  grid-area: title;
  font-family: $face-display;
  font-size: clamp(4rem, 15vw, 18rem);
  line-height: 1.1;
  color: $text-bright;

  @include verticalLayout {
    font-size: clamp(3.5rem, 24vw, 10rem);
  }
}

.system-statement {
  grid-area: statement;
  display: grid;
  gap: 0.9rem;
  margin: 0;
  padding: 0 0 0 1.25rem;
}

.statement-line {
  @include prose;
  position: relative;
  max-width: 52ch;
  font-size: clamp(0.85rem, 1.1vw, 1.1rem);
  color: $text-body;

  &::before {
    content: '>';
    position: absolute;
    left: -1.25rem;
    color: $accent;
  }
}

.system-figures {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid $divider-inside;
  border-bottom: 1px solid $divider-inside;

  @include verticalLayout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.system-figure {
  display: grid;
  gap: 0.4rem;
  padding: 1.5rem 0;
}

.figure-value {
  font-family: $face-heading;
  font-size: clamp(2.2rem, 5vw, 5rem);
  line-height: 1.1;
  color: $accent;
}

.system-columns {
  display: grid;
  grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);
  align-items: start;
  gap: clamp(2rem, 5vw, 6rem);

  @include verticalLayout {
    grid-template-columns: minmax(0, 1fr);
  }
}

.system-steps {
  display: grid;
  gap: 1.75rem;
}

.system-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1.25rem;
}

.step-number {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  background: $accent;
  color: $accent-ink;
  font-size: 0.92rem;
}

.step-copy {
  display: grid;
  gap: 0.3rem;
}

.step-title {
  @include heading;
  font-size: clamp(0.95rem, 1.25vw, 1.35rem);
  line-height: 1.3;
  color: $text-bright;
}

.step-detail {
  @include prose;
  font-size: 0.98rem;
}

.system-aside {
  display: grid;
  gap: 2.5rem;
}

.accent-slabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;

  @include verticalLayout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.accent-slab {
  display: grid;
  align-content: space-between;
  justify-items: start;
  gap: 1.5rem;
  width: 100%;
  min-height: 6.5rem;
  padding: 0.7rem;
  border: 0;
  border-radius: 0.35rem;
  text-align: left;
  cursor: pointer;
  transition: transform $release $ease-release;

  @include finePointer {
    &:hover {
      transform: translateY(-0.25rem);
    }
  }

  &:active {
    transform: scale(0.95);
    transition: transform $press ease-out;
  }

  &:focus-visible {
    outline: 2px solid $text-bright;
    outline-offset: 2px;
  }

  &.is-chosen {
    box-shadow: inset 0 0 0 3px $ground;
  }
}

.slab-name {
  font-family: $face-heading;
  font-size: 0.78rem;
  letter-spacing: $heading-tracking;
  text-transform: uppercase;
  line-height: 1.2;
}

.slab-hex {
  font-size: 0.78rem;
  text-transform: uppercase;
}

.system-platforms {
  display: grid;
  gap: 0.9rem;
}

.platform-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.platform {
  padding: 0.35rem 0.7rem;
  border: 1px solid $border-control;
  border-radius: 999px;
  font-size: 0.82rem;
  color: $text-body;
}
</style>
