<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import LiftText from '@/components/Misc/Lift-Text.vue';
import SweepLabel from '@/components/Misc/Sweep-Label.vue';
import { accentStyle, setStandingAccent, useAccentRoom } from '@/modules/accentRoom';
import { useFullWidthText } from '@/modules/fitText';
import {
  BANNER_DOCK_SECONDS,
  CUT_LEAVE_SECONDS,
  PANEL_ENTER_SECONDS,
  PREMISE_CHARACTER_SECONDS,
  PREMISE_SLAB_SECONDS,
  TYPE_INTERVAL_MILLISECONDS,
} from '@/modules/motionConstants';
import { products } from '@/modules/productsRegistry';
import { createSceneGate } from '@/modules/sceneGate';
import { isReducedMotion, onIntroFinished, registerScrollSetup, scrollToTarget } from '@/modules/scrollEngine';
import { useSectionReveal } from '@/modules/sectionReveal';
import { SYSTEM_VERSION } from '@/modules/systemRegistry';
import heroBanner from '@/modules/heroBanner.txt?raw';

import LiquidTrail from './Liquid-Trail.vue';

type Scene = 'opening' | 'premise';

const HERO_ACCENT = '#7e55dd';
const HEAD_LIFT_PERCENT = -40;
const FOOT_DROP_PERCENT = 60;
const LARGEST_DOCKED_SCALE = 0.95;
const DOCK_GAP_REM = 3;
const CORNER_SCALE = 0.75;
const CORNER_INSET_REM = 0.75;
const CORNER_TRAVEL_SHARE = 0.5;
const bannerLines = heroBanner.replace(/\s+$/, '').split(/\r?\n/);
const bannerWidth = Math.max(...bannerLines.map((line) => line.length));
const TYPING_START_MILLISECONDS = 1500;
const typedLine = `${products.length} products / 1 system / version ${SYSTEM_VERSION}`;
const statementLines = ['Motion beyond decoration', 'reactive animations', '> guiding your eyes'];
const slabWords = ['with', 'hierarchy.'];
let characterCount = 0;
function typedWords(line: string): { text: string; start: number }[] {
  return line.split(' ').map((text) => {
    const word = { text, start: characterCount };
    characterCount += text.length + 1;
    return word;
  });
}
const leadingLines = statementLines.map(typedWords);
const totalCharacters = characterCount;
const PREMISE_LEAVE_PERCENT = 4;
const statement = [...statementLines, slabWords.join(' ')].join(' ');

const root = ref<HTMLElement | null>(null);
const title = ref<HTMLElement | null>(null);
const titleBox = ref<HTMLElement | null>(null);
const head = ref<HTMLElement | null>(null);
const foot = ref<HTMLElement | null>(null);
const premise = ref<HTMLElement | null>(null);
const premiseLabel = ref<HTMLElement | null>(null);
const slab = ref<HTMLElement | null>(null);
const slabText = ref<HTMLElement | null>(null);
const typedLength = ref(0);
const typedCount = ref(0);
const isSlabFull = ref(false);
const isStill = ref(false);

let dock = { x: 0, y: 0, scale: 1 };
let corner = { x: 0, y: 0, scale: 1 };
const docking = { share: 0 };
const cornerTravel = { share: 0 };
let scene: Scene = 'opening';
let isSceneMoving = false;
let sceneTimeline: gsap.core.Timeline | null = null;
let removeSceneGate: (() => void) | null = null;

useSectionReveal(root, 'intro');
useAccentRoom(root, HERO_ACCENT);
useFullWidthText(title);

function typeLine(): void {
  if (typedLength.value >= typedLine.length) return;
  typedLength.value += 1;
  window.setTimeout(typeLine, TYPE_INTERVAL_MILLISECONDS);
}

function measureDock(): void {
  const section = root.value;
  const box = titleBox.value;
  const statementBox = premise.value?.querySelector<HTMLElement>('.premise-statement');
  if (!section || !box || !statementBox) return;
  const sectionStyle = getComputedStyle(section);
  const frame = box.offsetParent as HTMLElement | null;
  const centerX = box.offsetLeft + (frame?.offsetLeft ?? 0) + box.offsetWidth / 2;
  const centerY = box.offsetTop + (frame?.offsetTop ?? 0) + box.offsetHeight / 2;
  const roomLeft = parseFloat(sectionStyle.paddingLeft);
  const roomRight = section.clientWidth - parseFloat(sectionStyle.paddingRight);
  const roomBottom = section.clientHeight - parseFloat(sectionStyle.paddingBottom);
  const lines = [...statementBox.querySelectorAll<HTMLElement>('.premise-line, .premise-phrase')];
  const sectionLeft = section.getBoundingClientRect().left;
  const textRight = Math.max(...lines.map((line) => line.getBoundingClientRect().right - sectionLeft));
  const textBottom = statementBox.offsetTop + statementBox.offsetHeight + (premise.value?.offsetTop ?? 0);
  const remSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const gap = DOCK_GAP_REM * remSize;
  const cornerScale = Math.min(CORNER_SCALE, (roomRight - roomLeft) / box.offsetWidth);
  corner = {
    x: roomRight - (box.offsetWidth * cornerScale) / 2 - centerX,
    y: section.clientHeight - CORNER_INSET_REM * remSize - (box.offsetHeight * cornerScale) / 2 - centerY,
    scale: cornerScale,
  };
  if (section.clientWidth < section.clientHeight) {
    const scale = Math.min(1, (roomRight - roomLeft) / box.offsetWidth);
    const targetY = (textBottom + gap + roomBottom) / 2;
    dock = { x: (roomLeft + roomRight) / 2 - centerX, y: targetY - centerY, scale };
    corner = dock;
    return;
  }
  const scale = Math.min(LARGEST_DOCKED_SCALE, (roomRight - textRight - gap) / box.offsetWidth);
  dock = { x: roomRight - (box.offsetWidth * scale) / 2 - centerX, y: section.clientHeight / 2 - centerY, scale };
}

function placeBanner(): void {
  const travel = gsap.parseEase('power2.inOut')(cornerTravel.share);
  const docked = {
    x: dock.x * docking.share,
    y: dock.y * docking.share,
    scale: 1 + (dock.scale - 1) * docking.share,
  };
  gsap.set(titleBox.value, {
    x: docked.x + (corner.x - docked.x) * travel,
    y: docked.y + (corner.y - docked.y) * travel,
    scale: docked.scale + (corner.scale - docked.scale) * travel,
  });
}

function resetPremise(): void {
  typedCount.value = 0;
  isSlabFull.value = false;
  gsap.set(slab.value, { scaleX: 0 });
  gsap.set([slabText.value, premiseLabel.value], { clipPath: 'inset(0 100% 0 0)' });
  gsap.set(premise.value, { autoAlpha: 0, yPercent: 0 });
}

function settleScene(): void {
  isSceneMoving = false;
}

function advanceScene(): void {
  if (scene === 'premise') return;
  scene = 'premise';
  isSceneMoving = true;
  sceneTimeline?.kill();
  resetPremise();
  const typing = { count: 0 };
  sceneTimeline = gsap
    .timeline()
    .to(head.value, { yPercent: HEAD_LIFT_PERCENT, autoAlpha: 0, duration: CUT_LEAVE_SECONDS, ease: 'power2.in' }, 0)
    .to(foot.value, { yPercent: FOOT_DROP_PERCENT, autoAlpha: 0, duration: CUT_LEAVE_SECONDS, ease: 'power2.in' }, 0)
    .to(docking, { share: 1, duration: BANNER_DOCK_SECONDS, ease: 'power3.out', onUpdate: placeBanner }, 0)
    .call(settleScene, undefined, BANNER_DOCK_SECONDS)
    .set(premise.value, { autoAlpha: 1 }, CUT_LEAVE_SECONDS)
    .to(
      typing,
      {
        count: totalCharacters,
        duration: PREMISE_CHARACTER_SECONDS * totalCharacters,
        ease: 'none',
        onUpdate: () => {
          typedCount.value = Math.ceil(typing.count);
        },
      },
      CUT_LEAVE_SECONDS,
    )
    .to(slab.value, {
      scaleX: 1,
      duration: PREMISE_SLAB_SECONDS,
      ease: 'power2.out',
      onUpdate: () => {
        isSlabFull.value = Number(gsap.getProperty(slab.value, 'scaleX')) > 0.5;
      },
    })
    .to(slabText.value, { clipPath: 'inset(0 0% 0 0)', duration: PREMISE_SLAB_SECONDS, ease: 'power2.out' }, '<')
    .to(premiseLabel.value, { clipPath: 'inset(0 0% 0 0)', duration: PANEL_ENTER_SECONDS, ease: 'power3.out' });
}

function retreatScene(): void {
  if (scene === 'opening') return;
  scene = 'opening';
  isSceneMoving = true;
  sceneTimeline?.kill();
  sceneTimeline = gsap
    .timeline({ onComplete: resetPremise })
    .to(premise.value, { autoAlpha: 0, yPercent: PREMISE_LEAVE_PERCENT, duration: CUT_LEAVE_SECONDS, ease: 'power2.in' }, 0)
    .to(docking, { share: 0, duration: BANNER_DOCK_SECONDS, ease: 'power3.inOut', onUpdate: placeBanner }, 0)
    .call(settleScene, undefined, BANNER_DOCK_SECONDS)
    .to(
      [head.value, foot.value],
      { yPercent: 0, autoAlpha: 1, duration: PANEL_ENTER_SECONDS, ease: 'power3.out' },
      CUT_LEAVE_SECONDS,
    );
}

onMounted(() => {
  setStandingAccent(HERO_ACCENT);
  if (isReducedMotion()) {
    typedLength.value = typedLine.length;
    isStill.value = true;
    typedCount.value = totalCharacters;
    gsap.set([slabText.value, premiseLabel.value], { clipPath: 'inset(0 0% 0 0)' });
    isSlabFull.value = true;
    gsap.set(slab.value, { scaleX: 1 });
    return;
  }
  gsap.set(titleBox.value, { transformOrigin: 'center center' });
  gsap.set(premise.value, { autoAlpha: 0 });
  onIntroFinished(() => {
    window.setTimeout(typeLine, TYPING_START_MILLISECONDS);
    removeSceneGate = createSceneGate({
      isAdvanced: () => scene === 'premise',
      isMoving: () => isSceneMoving,
      advance: advanceScene,
      retreat: retreatScene,
    });
  });
  registerScrollSetup(() => {
    ScrollTrigger.create({
      trigger: root.value,
      start: 'top top-=1',
      onEnter: advanceScene,
      onRefresh: () => {
        measureDock();
        placeBanner();
      },
    });
    gsap.to(cornerTravel, {
      share: 1,
      ease: 'none',
      onUpdate: placeBanner,
      scrollTrigger: {
        trigger: root.value,
        start: 'top top',
        end: () => `+=${window.innerHeight * CORNER_TRAVEL_SHARE}`,
        scrub: true,
        invalidateOnRefresh: true,
      },
    });
  });
});

onBeforeUnmount(() => {
  removeSceneGate?.();
  sceneTimeline?.kill();
});
</script>

<template>
  <section id="top" ref="root" class="hero" :class="{ 'is-still': isStill }" :style="accentStyle(HERO_ACCENT)">
    <LiquidTrail />
    <div ref="head" class="hero-head">
      <SweepLabel class="micro-label" tag="p" text="V/AS — VAD/OS Application Systems" />
      <LiftText
        class="hero-statement"
        tag="p"
        text="One design, everywhere."
      />
      <a class="sweep-control is-primary reveal-panel" href="#products" @click.prevent="scrollToTarget('#products')">
        See the products
        <span aria-hidden="true">→</span>
      </a>
    </div>
    <div class="hero-title-frame">
      <h1 ref="titleBox" class="hero-title">
        <span class="visually-hidden">VAD/OS</span>
        <span ref="title" class="hero-banner" aria-hidden="true">
          <span v-for="(line, lineIndex) in bannerLines" :key="lineIndex" class="hero-banner-line lift-mask">
            <span class="lift-piece" data-lift="snap" :data-lift-order="lineIndex">{{
              line.padEnd(bannerWidth)
            }}</span>
          </span>
        </span>
      </h1>
    </div>
    <div ref="premise" class="hero-premise">
      <p ref="premiseLabel" class="micro-label premise-label">( The premise )</p>
      <p class="premise-statement">
        <span class="visually-hidden">{{ statement }}</span>
        <span aria-hidden="true">
          <span v-for="(words, lineIndex) in leadingLines" :key="lineIndex" class="premise-line">
            <template v-for="word in words" :key="word.start">
              <span class="premise-word"
                ><span
                  v-for="(character, characterIndex) in word.text"
                  :key="characterIndex"
                  class="premise-character"
                  :class="{ 'is-typed': word.start + characterIndex < typedCount }"
                  >{{ character }}</span
                ></span
              >
              {{ ' ' }}
            </template>
          </span>
          <span class="premise-phrase" :class="{ 'is-covered': isSlabFull }">
            <span ref="slab" class="premise-slab"></span>
            <span ref="slabText" class="premise-slab-text">{{ slabWords.join(' ') }}</span>
          </span>
        </span>
      </p>
    </div>
    <div ref="foot" class="hero-foot">
      <p class="hero-typed tabular" :aria-label="typedLine">
        <span aria-hidden="true">&gt; {{ typedLine.slice(0, typedLength) }}</span>
        <span class="hero-caret" aria-hidden="true"></span>
      </p>
      <SweepLabel class="micro-label" tag="p" text="Scroll ↓" />
    </div>
  </section>
</template>

<style scoped lang="scss">
.hero {
  position: relative;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 2rem;
  height: 100vh;
  height: 100svh;
  padding: 5.5rem $gutter 2rem;
  overflow: hidden;

  &.is-still {
    grid-template-rows: auto 1fr auto auto;
    height: auto;
    min-height: 100vh;
  }
}

.hero-head {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: start;
  gap: 1.1rem;
}

.hero-statement {
  @include heading;
  max-width: 30ch;
  font-size: clamp(1rem, 1.45vw, 1.6rem);
  line-height: 1.3;
  color: $text-bright;

  @include verticalLayout {
    font-size: clamp(0.95rem, 4.4vw, 1.4rem);
  }
}

.hero-title-frame {
  position: absolute;
  inset: 0;
  z-index: 0;
  display: grid;
  place-items: center;
  min-width: 0;
  padding-inline: $gutter;
  pointer-events: none;
}

.hero-title {
  width: min(100%, 90svh);
  margin: 0;
  will-change: transform;
}

.hero-banner {
  display: inline-flex;
  flex-direction: column;
  font-family: $face-functional;
  font-size: 1vw;
  line-height: 1;
  color: $hero-banner;
  white-space: pre;
}

.hero-banner-line {
  display: block;
  padding-block: 0;
  margin-block: 0;
}

.hero-premise {
  position: absolute;
  inset: 0 auto 0 $gutter;
  z-index: 1;
  display: grid;
  align-content: center;
  gap: 1.5rem;
  max-width: 64%;
  pointer-events: none;
  will-change: transform, opacity;

  @include verticalLayout {
    right: $gutter;
    align-content: start;
    padding-top: 7rem;
    max-width: none;
  }

  .is-still & {
    position: relative;
    inset: auto;
    grid-row: 4;
    padding-block: 4rem 2rem;
  }
}

.premise-statement {
  @include heading;
  font-size: clamp(2rem, 3.6vw, 4.6rem);

  @include verticalLayout {
    font-size: clamp(1.7rem, 8.6vw, 4rem);
  }
}

.premise-line {
  display: block;
}

.premise-label,
.premise-slab-text {
  clip-path: inset(0 100% 0 0);
}

.premise-slab-text {
  display: inline-block;
  color: $text-bright;
}

.premise-word {
  display: inline-block;
  color: $text-bright;
}

.premise-character {
  visibility: hidden;

  &.is-typed {
    visibility: visible;
  }
}

.premise-phrase {
  position: relative;
  isolation: isolate;
  display: inline-block;
  padding: 0 0.18em;
  margin: 0 -0.18em;

  &.is-covered .premise-slab-text {
    color: $accent-ink;
  }
}

.premise-slab {
  position: absolute;
  inset: -0.04em 0;
  z-index: -1;
  background: $accent;
  transform: scaleX(0);
  transform-origin: left center;
}

.hero-foot {
  position: relative;
  z-index: 1;
  grid-row: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 2rem;
}

.hero-typed {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  min-height: 1.5em;
  font-size: 0.92rem;
  color: $text-muted;
  white-space: pre;
}

.hero-caret {
  width: 0.6em;
  height: 1.15em;
  background: $accent;
  animation: caret-blink 1.06s steps(1, end) infinite;
}

@keyframes caret-blink {
  50% {
    opacity: 0;
  }
}

@include reducedMotion {
  .hero-caret {
    animation: none;
  }
}
</style>
