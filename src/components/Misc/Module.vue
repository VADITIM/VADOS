<script setup lang="ts">
defineProps<{ caption?: string }>();

function trackPointer(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  const box = event.currentTarget as HTMLElement;
  const rectangle = box.getBoundingClientRect();
  box.style.setProperty('--pointer-x', `${event.clientX - rectangle.left}px`);
  box.style.setProperty('--pointer-y', `${event.clientY - rectangle.top}px`);
}
</script>

<template>
  <figure class="module-frame">
    <div class="module reveal-panel" @pointermove="trackPointer">
      <div class="module-well">
        <slot />
      </div>
      <span class="module-hue" aria-hidden="true"></span>
    </div>
    <figcaption v-if="caption" class="module-caption">{{ caption }}</figcaption>
  </figure>
</template>

<style scoped lang="scss">
$well-padding: 0.75rem;

.module-frame {
  position: relative;
  min-width: 0;
}

.module {
  position: relative;
  border: 1px solid $border;
  border-radius: $squircle;
  background: $panel;
  overflow: hidden;
  transition: border-color $hover-out ease;

  @include finePointer {
    &:hover {
      border-color: color-mix(in srgb, $accent 30%, $border);
      transition: border-color $hover-in ease;

      .module-hue {
        opacity: 1;
      }
    }
  }
}

.module-well {
  padding: $well-padding;

  :deep(> *) {
    border-radius: max(0px, calc(#{$squircle} - #{$well-padding}));
  }
}

.module-hue {
  position: absolute;
  inset: 0;
  padding: 1.5px;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(
    11rem circle at var(--pointer-x, 50%) var(--pointer-y, 50%),
    color-mix(in srgb, $accent 95%, transparent),
    color-mix(in srgb, $accent 50%, transparent) 45%,
    color-mix(in srgb, $accent 20%, transparent) 100%
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity $hover-in ease;
}

.module-caption {
  position: relative;
  width: fit-content;
  margin: 0.9rem auto 0;
  padding: 0.3rem 0.7rem;
  max-width: 52ch;
  background: transparent;
  font-size: 0.85rem;
  color: $text-label;
  text-align: center;
  text-wrap: balance;
}
</style>
