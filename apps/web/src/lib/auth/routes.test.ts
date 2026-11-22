import { describe, expect, it } from 'vitest';
import { routeDecision, safeNext } from './routes';

const out = { signedIn: false } as const;
const fresh = { signedIn: true, hasUsername: false } as const;
const ready = { signedIn: true, hasUsername: true } as const;

describe('route guard', () => {
  it('redirects signed-out users from protected routes to sign-in, keeping the destination', () => {
    expect(routeDecision('/dashboard', '', out)).toBe('/sign-in?next=%2Fdashboard');
    expect(routeDecision('/dashboard/settings', '?tab=1', out)).toBe('/sign-in?next=%2Fdashboard%2Fsettings%3Ftab%3D1');
    expect(routeDecision('/onboarding/username', '', out)).toBe('/sign-in?next=%2Fonboarding%2Fusername');
    expect(routeDecision('/challenges/new', '', out)).toBe('/sign-in?next=%2Fchallenges%2Fnew');
    expect(routeDecision('/challenges/Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2', '', out)).toBeNull(); // viewing is public
  });

  it('lets everyone through public routes', () => {
    for (const v of [out, fresh, ready]) {
      expect(routeDecision('/', '', v)).toBeNull();
      expect(routeDecision('/styleguide', '', v)).toBeNull();
      expect(routeDecision('/dashboardish', '', v)).toBeNull();
    }
    expect(routeDecision('/sign-in', '', out)).toBeNull();
  });

  it('sends new users to the username step before anything protected', () => {
    expect(routeDecision('/dashboard', '', fresh)).toBe('/onboarding/username?next=%2Fdashboard');
    expect(routeDecision('/sign-in', '?next=%2Fdashboard', fresh)).toBe('/onboarding/username?next=%2Fdashboard');
    expect(routeDecision('/onboarding/username', '', fresh)).toBeNull();
  });

  it('keeps finished users out of sign-in and the username step', () => {
    expect(routeDecision('/sign-in', '', ready)).toBe('/dashboard');
    expect(routeDecision('/sign-in', '?next=%2Fdashboard%2Fsettings', ready)).toBe('/dashboard/settings');
    expect(routeDecision('/onboarding/username', '', ready)).toBe('/dashboard');
    expect(routeDecision('/dashboard', '', ready)).toBeNull();
  });

  it('never redirects off-site (open redirect)', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '']) {
      expect(safeNext(bad)).toBe('/dashboard');
    }
    expect(routeDecision('/sign-in', '?next=%2F%2Fevil.example', ready)).toBe('/dashboard');
    expect(safeNext('/sign-in')).toBe('/dashboard');
    expect(safeNext('/dashboard?x=1')).toBe('/dashboard?x=1');
  });
});
