import { describe, expect, it } from 'vitest';
import { badgeMetadataJson, badgeName, badgeSvg, type BadgeMetadataRow } from './metadata';

const row: BadgeMetadataRow = {
  username: 'chirag',
  wallet: 'Wn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa',
  challenge_title: 'Ship <it> & "win"',
  challenge_address: 'Bd111111111111111111111111111111111111111111',
  num_days: 7,
  finished_at: '2026-11-24T10:00:00+00:00',
  mint: 'Mw111111111111111111111111111111111111111111',
  mint_tx: null,
};

describe('badge metadata', () => {
  it('matches the on-chain name (≤ 32 bytes) and points at its own image', () => {
    expect(badgeName(60)).toBe('CodeStreak Survivor · 60 days');
    expect(new TextEncoder().encode(badgeName(60)).length).toBeLessThanOrEqual(32);
    const json = badgeMetadataJson(row, 'https://x.test', 'Pw1');
    expect(json).toMatchObject({ name: 'CodeStreak Survivor · 7 days', symbol: 'STREAK', image: 'https://x.test/api/badges/Pw1/image' });
    expect(json.external_url).toBe('https://x.test/challenges/Bd111111111111111111111111111111111111111111');
    expect(json.description).toMatch(/Soulbound/);
  });

  it('does not link private challenges', () => {
    expect(badgeMetadataJson({ ...row, challenge_address: null }, 'https://x.test', 'Pw1').external_url).toBe('https://x.test');
  });

  it('escapes user text in the SVG', () => {
    const svg = badgeSvg(row);
    expect(svg).not.toContain('<it>');
    expect(svg).toContain('Ship &lt;it&gt; &amp; &quot;win&quot;');
    expect(svg).toContain('@chirag');
  });
});
