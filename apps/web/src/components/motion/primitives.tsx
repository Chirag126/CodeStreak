'use client';

import { animate, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { durations, easings, motionSafe, stagger, variants, type VariantName } from '@/lib/motion';
import { useMotionPreference } from './motion-preference';

interface RevealProps {
  children: ReactNode;
  className?: string;
  variant?: VariantName;
  delay?: number;
  /** Animate when scrolled into view (default) or immediately on mount. */
  trigger?: 'view' | 'mount';
}

/** Fades (and, unless motion is reduced, slides/scales) content in. */
export function Reveal({ children, className, variant = 'fadeUp', delay = 0, trigger = 'view' }: RevealProps) {
  const { reduce } = useMotionPreference();
  const v = motionSafe(variants[variant], reduce);
  const transition = delay ? { delay } : undefined;
  return trigger === 'view' ? (
    <motion.div className={className} variants={v} initial="hidden" whileInView="show" viewport={{ once: true, margin: '0px 0px -10% 0px' }} transition={transition}>
      {children}
    </motion.div>
  ) : (
    <motion.div className={className} variants={v} initial="hidden" animate="show" transition={transition}>
      {children}
    </motion.div>
  );
}

/** Container whose <StaggerItem> children appear one after another. */
export function Stagger({ children, className, step = 0.06, delay = 0 }: { children: ReactNode; className?: string; step?: number; delay?: number }) {
  return (
    <motion.div className={className} variants={stagger(step, delay)} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, variant = 'fadeUp' }: { children: ReactNode; className?: string; variant?: VariantName }) {
  const { reduce } = useMotionPreference();
  return (
    <motion.div className={className} variants={motionSafe(variants[variant], reduce)}>
      {children}
    </motion.div>
  );
}

const formatInteger = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Counts up to `value` for display (stats, survivor counts). Shows the final value instantly when
 * motion is reduced. Display only: money stays bigint everywhere else.
 * Pass a stable `format` (module-level or useCallback): a new function restarts the count.
 */
export function AnimatedNumber({ value, format = formatInteger, duration = durations.slow * 2, className }: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const { reduce } = useMotionPreference();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = format(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: easings.out,
      onUpdate: (n) => {
        el.textContent = format(n);
      },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce, duration, format]);

  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      {format(reduce ? value : 0)}
    </span>
  );
}
