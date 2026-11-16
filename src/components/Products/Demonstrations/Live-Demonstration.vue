<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import SweepLabel from '@/components/Misc/Sweep-Label.vue';
import { isTouchOnly } from '@/modules/scrollEngine';

defineProps<{ source: string; productName: string; size: string; hint: string }>();

const SCREEN_WIDTH = 1440;
const SCREEN_HEIGHT = 900;

const stage = ref<HTMLElement | null>(null);
const isRunning = ref(false);
const screenScale = ref(1);
const isDesktopOnly = ref(false);

let observer: ResizeObserver | null = null;

onMounted(() => {
  isDesktopOnly.value = isTouchOnly();
  if (!stage.value) return;
  observer = new ResizeObserver(([entry]) => {
    screenScale.value = entry.contentRect.width / SCREEN_WIDTH;
  });
  observer.observe(stage.value);
});

onBeforeUnmount(() => observer?.disconnect());

function start(): void {
  isRunning.value = true;
}

function stop(): void {
  isRunning.value = false;
}
</script>

<template>
  <div class="live">
    <SweepLabel class="micro-label live-notice" tag="p" text="This is a preview of an old version." />
    <div ref="stage" class="live-stage">
      <iframe
        v-if="isRunning"
        class="live-frame"
        :src="source"
        :title="`VAD/OS ${productName}, running live`"
        :style="{ width: `${SCREEN_WIDTH}px`, height: `${SCREEN_HEIGHT}px`, transform: `scale(${screenScale})` }"
        allow="fullscreen"
      ></iframe>
      <p v-else-if="isDesktopOnly" class="live-start is-notice">
        <span class="micro-label">Only on desktop</span>
        <span class="live-size micro-label">Open this page on a computer to run {{ productName }} live</span>
      </p>
      <button v-else class="live-start" type="button" @click="start">
        <span class="live-play" aria-hidden="true"></span>
        <span class="live-start-text">
          <span class="micro-label">Run {{ productName }} live</span>
          <span class="live-size micro-label">{{ size }} · loads on press</span>
          <span class="live-size micro-label">{{ hint }}</span>
        </span>
      </button>
    </div>
    <button v-if="isRunning" class="sweep-control is-bare" type="button" @click="stop">Stop</button>
  </div>
</template>

<style scoped lang="scss">
.live {
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  background: $sunken-deep;
  padding: 0.75rem;
}

.live-notice {
  margin: 0;
  color: $text-muted;
}

.live-stage {
  width: 100%;
  aspect-ratio: 1440 / 900;
  overflow: hidden;
  border-radius: 0.35rem;
}

.live-frame {
  display: block;
  border: 0;
  transform-origin: left top;
}

.live-start {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1.4rem;
  width: 100%;
  height: 100%;
  background: transparent;
  border: 1px solid $border;
  border-radius: 0.35rem;
  color: $text-bright;
  cursor: pointer;
  transition: border-color $hover-out $ease-leave;

  &.is-notice {
    gap: 0.6rem;
    margin: 0;
    padding: 1.5rem;
    text-align: center;
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid $accent;
    outline-offset: 2px;
  }

  @include finePointer {
    &:hover {
      border-color: $border-hover;
      transition: border-color $hover-in $ease-enter;
    }

    &:hover .live-play {
      transform: scale(1.08);
      transition: transform $hover-in $ease-enter;
    }
  }
}

.live-play {
  position: relative;
  display: block;
  width: 5.5rem;
  height: 5.5rem;
  border-radius: 50%;
  background: $accent;
  transition: transform $hover-out $ease-leave;

  &::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 54%;
    border-style: solid;
    border-width: 0.95rem 0 0.95rem 1.6rem;
    border-color: transparent transparent transparent $accent-ink;
    transform: translate(-50%, -50%);
  }
}

.live-start-text {
  display: grid;
  justify-items: center;
  gap: 0.4rem;
}

.live-size {
  color: $text-muted;
}
</style>
