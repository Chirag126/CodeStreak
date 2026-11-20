import { describe, expect, it } from 'vitest';
import { motionSafe, stagger, variants } from './motion';

describe('motion presets', () => {
  it('keeps variants unchanged when motion is allowed', () => {
    expect(motionSafe(variants.fadeUp, false)).toBe(variants.fadeUp);
  });

  it('removes movement but keeps opacity when motion is reduced', () => {
    const safe = motionSafe(variants.fadeUp, true);
    expect(safe.hidden).toEqual({ opacity: 0 });
    expect(safe.show).toMatchObject({ opacity: 1 });
    expect(safe.show).not.toHaveProperty('y');
    expect(motionSafe(variants.scaleIn, true).hidden).toEqual({ opacity: 0 });
  });

  it('stagger timing', () => {
    expect(stagger(0.1, 0.2).show).toEqual({ transition: { staggerChildren: 0.1, delayChildren: 0.2 } });
  });
});
