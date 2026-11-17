<script setup lang="ts">
import { ref } from 'vue';

import LiftText from '@/components/Misc/Lift-Text.vue';
import SweepLabel from '@/components/Misc/Sweep-Label.vue';
import { products } from '@/modules/productsRegistry';
import { scrollToTarget } from '@/modules/scrollEngine';
import { useSectionReveal } from '@/modules/sectionReveal';

import ProductRoom from './Product-Room.vue';

const COUNT_WIDTH = 2;

const header = ref<HTMLElement | null>(null);

const paddedTotal = String(products.length).padStart(COUNT_WIDTH, '0');

useSectionReveal(header);
</script>

<template>
  <section id="products" class="products">
    <header ref="header" class="products-header">
      <SweepLabel class="micro-label products-label" tag="p" text="( Built on V/AS )" />
      <h2 class="products-title">
        <LiftText text="Products" unit="character" is-display />
        <span class="products-total tabular">
          (<span class="reveal-count" :data-count-to="products.length" :data-count-width="COUNT_WIDTH">{{
            paddedTotal
          }}</span
          >)
        </span>
      </h2>
      <span class="products-rule reveal-panel" aria-hidden="true"></span>
      <nav class="products-index" aria-label="Products">
        <a
          v-for="(product, productIndex) in products"
          :key="product.id"
          class="sweep-control is-bare products-index-link reveal-panel"
          :href="`#product-${product.id}`"
          @click.prevent="scrollToTarget(`#product-${product.id}`)"
        >
          <span class="tabular">{{ String(productIndex + 1).padStart(COUNT_WIDTH, '0') }}</span>
          {{ product.name }}
        </a>
      </nav>
      <SweepLabel class="micro-label products-notice" tag="p" text="( Previews are subject to change )" />
    </header>
    <div class="products-body">
      <ProductRoom
        v-for="(product, productIndex) in products"
        :key="product.id"
        :product="product"
        :room-index="productIndex"
        :room-count="products.length"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.products-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas:
    'label label'
    'title title'
    'rule rule'
    'index statement'
    'notice notice';
  align-items: start;
  gap: 1.5rem clamp(2rem, 5vw, 6rem);
  padding: 3.5rem $gutter 0;

  @include verticalLayout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'label'
      'title'
      'rule'
      'statement'
      'index'
      'notice';
    padding: 3rem $gutter 0;
  }
}

.products-label {
  grid-area: label;
}

.products-title {
  grid-area: title;
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  font-family: $face-display;
  font-size: clamp(3rem, 10.5vw, 13rem);
  line-height: 1;
  color: $text-bright;
  text-transform: uppercase;

  @include verticalLayout {
    font-size: clamp(2.2rem, 15vw, 6rem);
  }
}

.products-total {
  @include microLabel;
  margin-top: 0.6em;
  font-size: 1rem;
  color: $accent;
}

.products-rule {
  grid-area: rule;
  display: block;
  height: 1px;
  margin-top: 1.5rem;
  background: $divider-section;
}

.products-index {
  grid-area: index;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  margin-left: -0.7rem;
}

.products-index-link {
  gap: 0.8rem;

  .tabular {
    color: $text-muted;
    transition: color $hover-out $ease-leave;
  }

  @include finePointer {
    &:hover .tabular {
      color: inherit;
      transition: color $hover-in $ease-enter;
    }
  }
}

.products-notice {
  grid-area: notice;
  justify-self: center;
  padding-block: 2.2rem 3.5rem;
  text-align: center;

  @include verticalLayout {
    padding-block: 1rem 2.5rem;
  }
}

.products-body {
  position: relative;
}
</style>
