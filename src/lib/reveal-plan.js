/**
 * Which reveal a piece of parsed output gets, and in what order (Phase 5,
 * .claude/docs/ANIMATION.md).
 *
 * The parser has already decided what every run of text *is* — a heading, a
 * status line, a flag, a placeholder, a path, a link, a plain sentence. That
 * decision is the only input the animation needs, so it is spent here rather
 * than re-derived: the classes the renderer puts on an element are read back
 * and turned into a tier.
 *
 * Two reveals come out of it:
 *
 *  - **Label reveal** — an accent bar sweeps over the token and retreats,
 *    uncovering it. This is for text the parser gave a *colour* to, because a
 *    colour is the parser saying "this run means something specific".
 *  - **Character wave** — everything else, the grey prose the tokens sit in.
 *    It rises from below, character by character.
 *
 * Tier order is **most saturated first**. A status colour is the loudest thing
 * in a block and reads first; the accent-tinted tokens follow; the softest
 * accent tint lands last. The whole point of staggering by type is that the
 * order the eye receives them in is the order of how much they matter, so the
 * tiers are a ranking and not a list.
 *
 * Pure, so it can be checked without a browser:
 * `node src/lib/reveal-plan.check.mjs`.
 */

/** How many tiers `labelTier` can return. The stagger walks these in order. */
export const LABEL_TIERS = 5;

/**
 * The label tier for an element's classes, or `null` if it is not a label at
 * all and belongs to the character wave.
 *
 * The tests are ordered by specificity rather than by tier, because the classes
 * are additive: `md-heading-3` also carries `md-heading`, and `inline-code.path`
 * also carries `inline-code`. Reading the narrower class first is what keeps a
 * grey heading out of the accent tier.
 *
 * @param {Iterable<string>} classList
 * @returns {number | null}
 */
export function labelTier(classList) {
  const classes = new Set(classList);
  const has = (/** @type {string} */ c) => classes.has(c);

  if (has("md-heading")) {
    // A status heading is the one fully saturated colour in the block.
    if (has("warn") || has("ok")) return 0;
    // Level 3 is deliberately grey — it is a sub-heading, not an accent. Grey
    // is the wave's, whatever element it happens to be on.
    if (has("md-heading-3")) return null;
    return 1;
  }

  if (has("inline-code")) {
    // Path and time are the two inline-code variants that repaint themselves;
    // plain inline code keeps the filled accent surface, which is the loudest
    // token in a line of prose.
    if (has("path")) return 2;
    if (has("time")) return 3;
    return 1;
  }

  // Code-block tokens. Flags carry the full accent text colour, placeholders
  // the softened one — which is also the order they read in: what the command
  // *is*, then what it takes.
  if (has("tok-flag")) return 3;
  if (has("tok-var")) return 4;
  // `tok-str` is `--text-strong`: bright, but not tinted. Not a label.

  if (has("inline-link")) return 3;

  return null;
}

/**
 * Group elements into label tiers, dropping empty ones.
 *
 * Empty tiers are dropped rather than held open on purpose: a line with no
 * paths must not sit through a beat of nothing between its headings and its
 * flags. The beats are contiguous, so the number of them is the number of
 * *kinds of thing* in the line, which is the information the stagger exists to
 * carry.
 *
 * @template T
 * @param {T[]} elements
 * @param {(el: T) => Iterable<string>} classesOf
 * @returns {T[][]} One array per non-empty tier, in tier order.
 */
export function labelGroups(elements, classesOf) {
  /** @type {T[][]} */
  const tiers = Array.from({ length: LABEL_TIERS }, () => []);
  for (const el of elements) {
    const tier = labelTier(classesOf(el));
    if (tier !== null) tiers[tier].push(el);
  }
  return tiers.filter((tier) => tier.length > 0);
}
