import { describe, expect, it } from 'vitest';
import {
  THEME_PREFERENCE_KEY,
  buildThemeInitScript,
  cookieKeyForScope,
  normalizeThemeMode,
  resolveThemeAppearance,
  storageKeyForScope,
} from './theme';

describe('theme preference resolution', () => {
  it('uses gargift_theme_mode as the canonical preference key', () => {
    expect(THEME_PREFERENCE_KEY).toBe('gargift_theme_mode');
    expect(storageKeyForScope('storefront')).toBe('gargift_theme_mode');
    expect(cookieKeyForScope('storefront')).toBe('gargift_theme_mode');
  });

  it('keeps storefront and admin storage keys independent', () => {
    expect(storageKeyForScope('admin')).not.toBe(storageKeyForScope('storefront'));
    expect(storageKeyForScope('admin')).toContain(THEME_PREFERENCE_KEY);
  });

  it('normalizes valid theme modes and falls back cleanly for invalid values', () => {
    expect(normalizeThemeMode('light')).toBe('light');
    expect(normalizeThemeMode('DARK')).toBe('dark');
    expect(normalizeThemeMode(' system ')).toBe('system');

    expect(normalizeThemeMode(null)).toBe('system');
    expect(normalizeThemeMode(undefined)).toBe('system');
    expect(normalizeThemeMode('')).toBe('system');
    expect(normalizeThemeMode('neon-purple')).toBe('system');
    expect(normalizeThemeMode(123)).toBe('system');
    expect(normalizeThemeMode('invalid', 'dark')).toBe('dark');
  });

  it('resolves light, dark, and system modes against OS preference', () => {
    expect(resolveThemeAppearance('light', true)).toBe('light');
    expect(resolveThemeAppearance('light', false)).toBe('light');
    expect(resolveThemeAppearance('dark', false)).toBe('dark');
    expect(resolveThemeAppearance('dark', true)).toBe('dark');
    expect(resolveThemeAppearance('system', true)).toBe('dark');
    expect(resolveThemeAppearance('system', false)).toBe('light');
  });

  it('builds a safe inline anti-FOUC init script per scope', () => {
    const storeScript = buildThemeInitScript('storefront');
    const adminScript = buildThemeInitScript('admin');

    expect(storeScript).toContain('"gargift_theme_mode"');
    expect(storeScript).toContain('prefers-color-scheme: dark');
    expect(storeScript).toContain('try{m=localStorage.getItem');
    expect(adminScript).toContain('"gargift_theme_mode_admin"');
  });
});
