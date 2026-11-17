# Map

| Path | Purpose |
|---|---|
| `src/main.ts` | Entry. Loads `fonts.scss` and `style.scss` once, mounts `App.vue` |
| `src/App.vue` | Page order, the smooth-scroll wrapper, starts the scroll engine |
| `src/style/variables.scss` | Tokens. Emits no CSS; injected into every style block by Vite |
| `src/style/mixins.scss` | `verticalLayout`, `finePointer`, `reducedMotion`, `microLabel`, `heading`, `prose` |
| `src/style/style.scss` | Globals: root scale, the `.pc-label*` contract, lift masks, `.sweep-control` |
| `src/style/fonts.scss` | The three `@font-face` blocks |
| `src/modules/productsRegistry.ts` | Every product: copy, accent, repository, demonstration |
| `src/modules/systemRegistry.ts` | V/AS laws, figures, accents, platforms, version |
| `src/modules/scrollEngine.ts` | GSAP registration, ScrollSmoother, intro gate, reduced motion |
| `src/modules/sceneGate.ts` | Turns wheel, touch and key intent at the top of the page into scene changes |
| `src/modules/sectionReveal.ts` | `useSectionReveal`: hide at mount, reveal once on intro or scroll |
| `src/modules/textReveal.ts` | Bar sweep, mask lift, panel wipe, count-up, positional stagger |
| `src/modules/accentRoom.ts` | `accentStyle`, `inkFor`, the standing accent, `useAccentRoom` |
| `src/modules/fitText.ts` | Sizes a wordmark to the full width of its frame |
| `src/modules/motionConstants.ts` | Every duration and stagger weight |
| `src/components/Misc/` | Shared pieces: `Module`, `Sweep-Label`, `Lift-Text`, `Site-Navigator`, `Magnetic-Dots` |
| `src/components/Products/Demonstrations/` | One component per demonstration kind |
| `public/media/` | Real product screenshots and the Bubble recording |
| `public/shell-live/` | The Shell playground compiled to WebAssembly (Qt 6.8.1). Rebuilt from VADOS-SHELL with `python tools/preview/web/build.py <this folder>`; loaded by `Live-Demonstration` only when play is pressed |
| `public/fonts/` | JetBrains Mono, Chakra Petch. `Wosker.otf` is dropped in by hand |

## To change X, look in Y

| Change | Look in |
|---|---|
| Add or edit a product | `productsRegistry.ts`; media goes in `public/media/` |
| Add a new kind of demonstration | a component in `Demonstrations/`, a member in `ProductDemonstration`, a branch in `Product-Media.vue` |
| Change a duration | `motionConstants.ts` |
| Change a colour or size token | `variables.scss` |
| Change section order | `App.vue` |
