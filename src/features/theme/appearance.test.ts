import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME_APPEARANCE,
  parseThemeAppearanceConfig,
  normalizeHexColor,
  buildStorefrontAppearanceCss,
} from './appearance';

describe('storefront theme appearance config', () => {
  it('falls back to defaults on invalid or CSS-injection color values', () => {
    expect(normalizeHexColor('red; background: url(evil)', '#7043E8')).toBe('#7043E8');
    expect(normalizeHexColor('#a1b2c3', '#7043E8')).toBe('#A1B2C3');

    const parsed = parseThemeAppearanceConfig(
      JSON.stringify({
        primaryColor: 'expression(alert(1))',
        secondaryColor: '#12ab34',
        fontPreset: 'bad_font',
        radiusPreset: 'pill_soft',
        buttonStyle: 'vibrant_gradient',
        cardStyle: 'glass_soft',
        defaultMode: 'dark',
        allowLightMode: false,
        allowDarkMode: false,
        allowSystemMode: true,
      }),
    );

    expect(parsed.primaryColor).toBe(DEFAULT_THEME_APPEARANCE.primaryColor);
    expect(parsed.secondaryColor).toBe('#12AB34');
    expect(parsed.fontPreset).toBe('vazirmatn');
    expect(parsed.radiusPreset).toBe('pill_soft');
    expect(parsed.buttonStyle).toBe('vibrant_gradient');
    expect(parsed.cardStyle).toBe('glass_soft');
    expect(parsed.defaultMode).toBe('dark');
    // At least one mode stays enabled
    expect(parsed.allowLightMode).toBe(true);
  });

  it('generates clean CSS custom properties with zero script tokens', () => {
    const css = buildStorefrontAppearanceCss({
      ...DEFAULT_THEME_APPEARANCE,
      primaryColor: '#5B46F6',
      radiusPreset: 'sharp',
    });
    expect(css).toContain('--color-brand:#5B46F6');
    expect(css).toContain('--radius-button:0.5rem');
    expect(css).not.toContain('<script');
  });
});
