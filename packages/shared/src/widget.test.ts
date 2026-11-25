import { describe, expect, it } from 'vitest';
import { escapeXml, parseWidgetFile, widgetHtml, widgetModel, widgetSnippets, widgetSvg, widgetTheme, type WidgetProfileInput } from './widget.js';

const profile = (over: Partial<WidgetProfileInput> = {}): WidgetProfileInput => ({
  username: 'chirag',
  displayName: 'Chirag P',
  stats: { currentStreak: 4, longestStreak: 9, successRate: 87, survived: 2, finished: 3, earned: { usdc: 1_500_000n } },
  badges: [{}, {}],
  ...over,
});

describe('widget model', () => {
  it('summarises a public profile', () => {
    expect(widgetModel(profile())).toEqual({
      found: true,
      username: 'chirag',
      name: 'Chirag P',
      subtitle: '@chirag',
      initials: 'CH',
      current: 4,
      longest: 9,
      successRate: '87%',
      survived: '2/3',
      badges: 2,
      earned: '1.5 USDC',
    });
  });

  it('is a placeholder for an unknown (or hidden) profile', () => {
    expect(widgetModel(null)).toEqual({ found: false });
  });

  it('falls back to the username for names image renderers cannot draw, and clips long ones', () => {
    // No name it can draw: the handle once, not twice.
    expect(widgetModel(profile({ displayName: '🚀 rocket' }))).toMatchObject({ name: '@chirag', subtitle: 'CodeStreak profile' });
    expect(widgetModel(profile({ displayName: null }))).toMatchObject({ name: '@chirag', subtitle: 'CodeStreak profile' });
    const long = widgetModel(profile({ displayName: 'A'.repeat(60) }));
    expect(long.found && long.name.length).toBe(28);
    const none = widgetModel(profile({ stats: { ...profile().stats, successRate: null, earned: {} } }));
    expect(none).toMatchObject({ successRate: '—', earned: '—' });
  });
});

describe('widget URLs', () => {
  it('parses username and format', () => {
    expect(parseWidgetFile('chirag.svg')).toEqual({ username: 'chirag', format: 'svg' });
    expect(parseWidgetFile('Chirag.PNG')).toEqual({ username: 'chirag', format: 'png' });
    expect(parseWidgetFile('%40chirag.jpeg')).toEqual({ username: 'chirag', format: 'jpg' });
  });
  it('refuses anything else', () => {
    for (const bad of ['chirag', 'chirag.gif', 'ab.svg', '../x.svg', 'a b.svg', '%E0%A4%A.svg', 'x'.repeat(21) + '.svg']) expect(parseWidgetFile(bad)).toBeNull();
  });
  it('defaults to the dark theme', () => {
    expect(widgetTheme('light')).toBe('light');
    expect(widgetTheme('neon')).toBe('dark');
    expect(widgetTheme(null)).toBe('dark');
  });
});

describe('widget SVG and HTML', () => {
  it('escapes user text so a name cannot inject markup', () => {
    const svg = widgetSvg(widgetModel(profile({ displayName: '<script>x</script>' })));
    expect(svg).not.toContain('<script>');
    expect(escapeXml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });

  it('is self-contained: no scripts, no external resources', () => {
    for (const svg of [widgetSvg(widgetModel(profile())), widgetSvg(widgetModel(null), 'light')]) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(svg).not.toMatch(/<script|href=|xlink|url\(/i);
    }
  });

  it('shows the stats, or a clean placeholder', () => {
    const svg = widgetSvg(widgetModel(profile()));
    for (const s of ['Chirag P', '@chirag', '4 days current streak', '87%', '2/3', '1.5 USDC']) expect(svg).toContain(s);
    const empty = widgetSvg(widgetModel(null));
    expect(empty).toContain('Profile not found');
    expect(empty).not.toContain('NaN');
  });

  it('renders a plain HTML page that links to the profile, without JavaScript', () => {
    const html = widgetHtml(widgetModel(profile()), 'dark', 'https://example.com');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('href="https://example.com/u/chirag"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/<script/i);
    expect(widgetHtml(widgetModel(null), 'light', 'https://example.com')).toContain('Profile not found');
  });

  it('builds paste-ready snippets', () => {
    const s = widgetSnippets('https://example.com', 'chirag', 'light');
    expect(s.iframe).toContain('src="https://example.com/embed/chirag?theme=light"');
    expect(s.markdown).toBe('[![chirag on CodeStreak](https://example.com/api/widget/chirag.svg?theme=light)](https://example.com/u/chirag)');
    expect(s.png).toBe('https://example.com/api/widget/chirag.png?theme=light');
  });
});
