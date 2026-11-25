import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('GarGift+ Phase 0 RTL, font & dual-theme source contracts', () => {
  it('sets lang="fa" dir="rtl", local fonts, and anti-FOUC init script on both layouts', () => {
    const layout = readFileSync('src/layouts/Layout.astro', 'utf8');
    const adminLayout = readFileSync('src/layouts/AdminLayout.astro', 'utf8');

    for (const source of [layout, adminLayout]) {
      expect(source).toContain('lang="fa"');
      expect(source).toContain('dir="rtl"');
      expect(source).toContain('buildThemeInitScript(');
      expect(source).toContain('@fontsource/vazirmatn/arabic-400.css');
      expect(source).toContain('@fontsource/jetbrains-mono/latin-400.css');
    }
  });

  it('declares both light and dark GarGift+ semantic tokens in tokens.css and admin.css', () => {
    const themeTokens = readFileSync('src/themes/gargift/tokens.css', 'utf8');
    const adminCss = readFileSync('src/styles/admin.css', 'utf8');

    for (const css of [themeTokens, adminCss]) {
      expect(css).toContain(":root[data-theme='dark']");
      expect(css).toContain('#17142b');
      expect(css).toContain('#252044');
      expect(css).toContain('#f8f6ff');
      expect(css).toContain('#35d9cc');
      expect(css).toContain("'Vazirmatn'");
      expect(css).toContain("'JetBrains Mono'");
    }
  });
});
