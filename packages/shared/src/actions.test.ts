import { describe, expect, it } from 'vitest';
import {
  ACTION_HEADERS,
  actionsJson,
  DEVNET_BLOCKCHAIN_ID,
  joinActionMetadata,
  parseActionAccount,
  parseActionAmount,
  sponsorActionMetadata,
  type ActionChallenge,
} from './actions.js';

const ADDR = '9EyLf2jNKLDR9swqmBcSfWr79CvB4QvbAMLJ6DifSzMv';
const challenge = (over: Partial<ActionChallenge> = {}): ActionChallenge => ({
  address: ADDR,
  title: 'Ship daily',
  token: 'usdc',
  buyIn: 5_000_000n,
  numDays: 7,
  dayLengthSecs: 86_400,
  players: 3,
  maxPlayers: 20,
  pool: 20_000_000n,
  providers: ['GitHub'],
  joinOpen: true,
  sponsorOpen: true,
  isDemo: false,
  ...over,
});

describe('Actions headers and actions.json', () => {
  it('carries the CORS and spec headers', () => {
    expect(ACTION_HEADERS['Access-Control-Allow-Origin']).toBe('*');
    expect(ACTION_HEADERS['Access-Control-Allow-Methods']).toBe('GET,POST,PUT,OPTIONS');
    for (const h of ['Content-Type', 'Authorization', 'Content-Encoding', 'Accept-Encoding']) expect(ACTION_HEADERS['Access-Control-Allow-Headers']).toContain(h);
    expect(ACTION_HEADERS['X-Blockchain-Ids']).toBe(DEVNET_BLOCKCHAIN_ID);
    expect(ACTION_HEADERS['X-Action-Version']).toMatch(/^\d+\.\d+/);
    expect(ACTION_HEADERS['Access-Control-Expose-Headers']).toContain('X-Blockchain-Ids');
  });
  it('maps challenge pages to the join action', () => {
    expect(actionsJson().rules).toContainEqual({ pathPattern: '/challenges/*', apiPath: '/api/actions/join/*' });
  });
});

describe('Action inputs', () => {
  it('needs a base58 account', () => {
    expect(parseActionAccount({ account: ADDR })).toEqual({ ok: true, account: ADDR });
    for (const bad of [null, {}, { account: 'x' }, { account: 42 }, { account: `${ADDR}0OIl` }]) expect(parseActionAccount(bad).ok).toBe(false);
  });
  it('rejects a bad amount with a message (ActionError)', () => {
    for (const bad of [null, '', 'abc', '-1', '0', '0.0000001', '1e3', '99999999']) {
      const r = parseActionAmount(bad, 'usdc');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
    expect(parseActionAmount('2.5', 'usdc')).toEqual({ ok: true, amount: 2_500_000n });
    expect(parseActionAmount('0.05', 'sol')).toEqual({ ok: true, amount: 50_000_000n });
  });
});

describe('Action metadata', () => {
  it('join: one transaction button with the buy-in', () => {
    const m = joinActionMetadata(challenge(), 'https://example.com', 'https://example.com/icon.png');
    expect(m).toMatchObject({ type: 'action', disabled: false, label: 'Join for 5 USDC', icon: 'https://example.com/icon.png' });
    expect(m.links.actions).toEqual([{ type: 'transaction', label: 'Join for 5 USDC', href: `/api/actions/join/${ADDR}` }]);
    expect(m.description).toContain('https://example.com/challenges/');
    expect(m.description).toContain('devnet');
  });
  it('join: disabled with a reason when closed or full', () => {
    expect(joinActionMetadata(challenge({ joinOpen: false }), 'https://x.io', 'i')).toMatchObject({ disabled: true, error: { message: 'Joining has closed for this challenge.' } });
    expect(joinActionMetadata(challenge({ players: 20 }), 'https://x.io', 'i')).toMatchObject({ disabled: true, error: { message: 'This challenge is full.' } });
  });
  it('sponsor: presets plus a validated custom amount', () => {
    const m = sponsorActionMetadata(challenge(), 'i');
    expect(m.links.actions.map((a) => a.label)).toEqual(['1 USDC', '5 USDC', '10 USDC', 'Sponsor']);
    const custom = m.links.actions[3]!;
    expect(custom.href).toBe(`/api/actions/sponsor/${ADDR}?amount={amount}`);
    expect('parameters' in custom && custom.parameters?.[0]).toMatchObject({ name: 'amount', required: true, min: 0.1, max: 10000 });
    expect(sponsorActionMetadata(challenge({ sponsorOpen: false }), 'i').disabled).toBe(true);
  });
});
