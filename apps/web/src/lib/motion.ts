// Motion presets: one place for durations, easings, springs and variants so the whole app
// moves the same way. Use with the `motion` package (formerly Framer Motion): import from "motion/react".
import type { Transition, Variants } from 'motion/react';

export const durations = { fast: 0.15, base: 0.24, slow: 0.42 } as const;

export const easings = {
  /** Fast start, soft landing: default for entrances. */
  out: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
};

export const springs = {
  /** Buttons, toggles, tab indicators. */
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 },
  /** Cards, panels, list reordering. */
  gentle: { type: 'spring', stiffness: 220, damping: 28 },
} satisfies Record<string, Transition>;

const enter: Transition = { duration: durations.base, ease: easings.out };

export const variants = {
  fadeIn: { hidden: { opacity: 0 }, show: { opacity: 1, transition: enter } },
  fadeUp: { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: enter } },
  scaleIn: { hidden: { opacity: 0, scale: 0.96 }, show: { opacity: 1, scale: 1, transition: enter } },
} satisfies Record<string, Variants>;

export type VariantName = keyof typeof variants;

/** Parent variants that reveal children one after another. */
export function stagger(step = 0.06, delay = 0): Variants {
  return { hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } };
}

const TRANSFORM_KEYS = new Set(['x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'skew', 'skewX', 'skewY']);

/**
 * Reduced-motion version of a variant set: removes movement (transforms) and keeps opacity,
 * so content still fades in but nothing slides, scales or rotates.
 */
export function motionSafe(input: Variants, reduce: boolean): Variants {
  if (!reduce) return input;
  const out: Variants = {};
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== 'object' || value === null) {
      out[name] = value;
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) if (!TRANSFORM_KEYS.has(key)) kept[key] = v;
    out[name] = kept as Variants[string];
  }
  return out;
}
