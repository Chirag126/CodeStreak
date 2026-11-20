import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { CONTRAST_PAIRS, palette, semantic } from './tokens';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').toLowerCase();

describe('contrast', () => {
  it('known reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  for (const pair of CONTRAST_PAIRS) {
    it(`${pair.use}: ${pair.fg} on ${pair.bg} >= ${pair.min}:1`, () => {
      expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(pair.min);
    });
  }
});

describe('globals.css stays in sync with tokens.ts', () => {
  for (const [group, shades] of Object.entries(palette)) {
    for (const [shade, hex] of Object.entries(shades)) {
      it(`--color-${group}-${shade}`, () => {
        expect(css).toContain(`--color-${group}-${shade}: ${hex};`);
      });
    }
  }
  for (const [name, hex] of Object.entries(semantic)) {
    it(`--${name}`, () => {
      expect(css).toContain(`  --${name}: ${hex};`);
    });
  }
});
