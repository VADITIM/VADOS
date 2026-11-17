<script setup lang="ts">
import { ref } from 'vue';

import { scrollToTarget } from '@/modules/scrollEngine';
import { useSectionReveal } from '@/modules/sectionReveal';

const destinations = [
  { label: 'Products', target: '#products' },
  { label: 'System', target: '#system' },
];

const root = ref<HTMLElement | null>(null);

useSectionReveal(root, 'intro');
</script>

<template>
  <header ref="root" class="navigator">
    <nav class="navigator-bar reveal-panel" aria-label="Sections">
      <a class="navigator-mark" href="#top" @click.prevent="scrollToTarget('#top')">
        <span class="navigator-slab" aria-hidden="true"></span>
        V/AS
      </a>
      <ul class="navigator-destinations">
        <li v-for="destination in destinations" :key="destination.target">
          <a
            class="sweep-control is-bare"
            :href="destination.target"
            @click.prevent="scrollToTarget(destination.target)"
          >
            {{ destination.label }}
          </a>
        </li>
        <li>
          <a class="sweep-control is-bare" href="https://github.com/VADITIM" target="_blank" rel="noopener">
            GitHub
          </a>
        </li>
      </ul>
    </nav>
  </header>
</template>

<style scoped lang="scss">
.navigator {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 40;
}

.navigator-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem $gutter;
  mix-blend-mode: difference;
}

.navigator-mark {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.75rem;
  font-family: $face-heading;
  font-size: 1rem;
  letter-spacing: $heading-tracking;
  color: $text-bright;
  text-decoration: none;

  &:focus-visible {
    outline: 2px solid $accent;
    outline-offset: 3px;
  }
}

.navigator-slab {
  width: 0.7rem;
  height: 0.7rem;
  background: $accent;
}

.navigator-destinations {
  display: flex;
  align-items: center;
  gap: 0.25rem;

  @include verticalLayout {
    gap: 0;

    .sweep-control {
      padding-inline: 0.45rem;
      font-size: 0.7rem;
    }
  }
}
</style>
