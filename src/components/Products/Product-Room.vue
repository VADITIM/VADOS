<script setup lang="ts">
import { computed, ref } from 'vue';

import LiftText from '@/components/Misc/Lift-Text.vue';
import SweepLabel from '@/components/Misc/Sweep-Label.vue';
import { accentStyle, useAccentRoom } from '@/modules/accentRoom';
import type { Product } from '@/modules/productsRegistry';
import { useLatestVersion } from '@/modules/releaseVersions';
import { ROOM_REVEAL_START, useSectionReveal } from '@/modules/sectionReveal';

import ProductMedia from './Product-Media.vue';

const props = defineProps<{ product: Product; roomIndex: number; roomCount: number }>();

const COUNT_WIDTH = 2;

const root = ref<HTMLElement | null>(null);

const isMirrored = computed(() => props.roomIndex % 2 === 1);
const latestVersion = useLatestVersion(props.product);
const releaseLabel = computed(() => `v${latestVersion.value}`);
const hasDemonstration = computed(() => props.product.demonstration.kind !== 'none');
const roomLabel = computed(() => {
  const number = String(props.roomIndex + 1).padStart(COUNT_WIDTH, '0');
  const total = String(props.roomCount).padStart(COUNT_WIDTH, '0');
  return `${number} / ${total} — ${props.product.platform}`;
});

useSectionReveal(root, 'piece', ROOM_REVEAL_START);
useAccentRoom(root, () => props.product.accent);
</script>

<template>
  <article
    :id="`product-${product.id}`"
    ref="root"
    class="product-room"
    :class="{ 'is-mirrored': isMirrored, 'is-plain': !hasDemonstration }"
    :style="accentStyle(product.accent)"
  >
    <div class="room-copy">
      <SweepLabel class="micro-label tabular" tag="p" :text="roomLabel" />
      <SweepLabel class="room-name" tag="h3" :text="product.name" />
      <LiftText class="room-headline" tag="p" :text="product.headline" />
      <ul class="room-strengths">
        <li v-for="strength in product.strengths" :key="strength" class="room-strength">
          <span class="strength-mark" aria-hidden="true"></span>
          <LiftText :text="strength" unit="block" />
        </li>
      </ul>
      <dl class="room-facts">
        <div class="room-fact">
          <dt class="micro-label">Stack</dt>
          <dd><LiftText :text="product.stack" unit="block" /></dd>
        </div>
        <div class="room-fact">
          <dt class="micro-label">Repository</dt>
          <dd><LiftText :text="product.availability" unit="block" /></dd>
        </div>
      </dl>
      <div class="room-release">
        <a
          v-if="product.repositoryUrl"
          class="sweep-control is-primary reveal-panel"
          :href="product.repositoryUrl"
          target="_blank"
          rel="noopener"
        >
          Open repository
          <span aria-hidden="true">↗</span>
        </a>
        <SweepLabel class="micro-label room-version tabular" tag="span" :text="releaseLabel" />
      </div>
    </div>
    <ProductMedia v-if="hasDemonstration" class="room-media" :product="product" />
  </article>
</template>

<style scoped lang="scss">
.product-room {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
  align-items: center;
  gap: clamp(2rem, 5vw, 6rem);
  min-height: 100vh;
  padding: 8rem $gutter;
  overflow: hidden;

  &:first-child {
    min-height: 0;
    padding-top: 0;
  }

  &:last-child {
    padding-bottom: 5rem;
  }

  & + &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: calc((100% - 2 * #{$gutter}) * #{$divider-inside-width} / 100%);
    height: 1px;
    background: $divider-inside;
    transform: translateX(-50%);
  }

  &.is-mirrored {
    grid-template-columns: minmax(0, 6fr) minmax(0, 5fr);

    .room-copy {
      order: 2;
    }
  }

  &.is-plain {
    grid-template-columns: minmax(0, 1fr);
    min-height: 70vh;
  }

  @include verticalLayout {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
    gap: 1.5rem;
    min-height: 0;
    padding: 5rem $gutter 3.5rem;

    &:first-child {
      padding-top: 0;
    }

    &.is-mirrored {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}

.room-copy {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: start;
  gap: 1.5rem;

  @include verticalLayout {
    display: contents;

    > * {
      order: 2;
    }

    > :nth-child(-n + 3) {
      order: 0;
    }
  }
}

.room-name {
  font-family: $face-display;
  font-size: clamp(2.6rem, 6.2vw, 7.5rem);
  line-height: 1.1;
  color: $text-bright;
  text-transform: uppercase;

  @include verticalLayout {
    font-size: clamp(2.2rem, 11.5vw, 5rem);
  }
}

.room-headline {
  @include heading;
  max-width: 24ch;
  font-size: clamp(1.05rem, 1.7vw, 1.9rem);
  line-height: 1.25;
  color: $text-bright;
}

.room-strengths {
  display: grid;
  gap: 0.7rem;
}

.room-strength {
  @include prose;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.9rem;
  max-width: 58ch;
  font-size: 0.98rem;
}

.strength-mark {
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.5em;
  background: $accent;
}

.room-release {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.25rem;
}

.room-version {
  color: $text-label;
}

.room-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 3rem;
  margin: 0;
}

.room-fact {
  display: grid;
  gap: 0.3rem;

  dd {
    margin: 0;
    font-size: 0.98rem;
    color: $text-bright;
  }
}

.room-media {
  position: relative;
  z-index: 1;

  @include verticalLayout {
    order: 1;
    justify-self: stretch;
    margin: 0.5rem 0;
  }
}
</style>
