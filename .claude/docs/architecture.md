# Architecture

## Layers

1. **Registries** (`productsRegistry`, `projectsRegistry`, `systemRegistry`) hold all content. Plain data, no Vue.
2. **Motion modules** (`scrollEngine`, `sceneGate`, `textReveal`, `sectionReveal`, `accentRoom`, `fitText`) hold all behaviour shared by sections.
3. **Sections** (`Hero` with its two scenes behind a gesture gate, `Products`, `System`, `Projects`, `Footer`) read registries and call the motion modules.
4. **Shared pieces** (`components/Misc`) carry markup contracts the motion modules query by class.

## Boot order

Children mount first and only register: `useSectionReveal` hides its pieces and queues a setup,
`registerScrollSetup` queues every ScrollTrigger. `App.vue` mounts last and calls `startScrollEngine`,
which creates the ScrollSmoother and then runs the queue in mount order. It then waits for fonts and
calls `finishIntro`, which releases scrolling and fires the intro reveals (hero, navigator). There is
no loading screen.

## Accent flow

Each section sets `--section-color` and `--accent-ink` on its own root through `accentStyle`. Content
inside reads `$accent`. Fixed elements outside any section (the navigator) read the root value, which
`useAccentRoom` repoints when a room crosses the middle of the viewport.

## Reveal contract

`useSectionReveal(root)` collects, inside `root`: `.pc-label-inner` (bar sweep), `.lift-piece` (mask
lift), `.reveal-panel` (clip wipe), `.reveal-count` (count to `data-count-to`). Start times come from
each piece's position inside the root, vertical weighted about three times horizontal.
