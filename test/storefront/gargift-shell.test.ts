import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import BrandLogo from '../../src/features/storefront/controls/BrandLogo.astro';
import ThemeSwitcher from '../../src/features/storefront/controls/ThemeSwitcher.astro';

describe('GarGift+ Phase 0 components', () => {
  it('renders BrandLogo in full, compact, and icon variants with isolated LTR brand wordmark', async () => {
    const container = await AstroContainer.create();

    const fullHtml = await container.renderToString(BrandLogo as never, {
      props: { variant: 'full' },
    });
    expect(fullHtml).toContain('dir="ltr"');
    expect(fullHtml).toContain('GarGift');
    expect(fullHtml).toContain('فروشگاه محصولات دیجیتال');

    const iconHtml = await container.renderToString(BrandLogo as never, {
      props: { variant: 'icon' },
    });
    expect(iconHtml).toContain('<svg');
    expect(iconHtml).not.toContain('GarGift');
  });

  it('renders ThemeSwitcher with accessible labels and scope-specific storage keys', async () => {
    const container = await AstroContainer.create();

    const storefrontHtml = await container.renderToString(ThemeSwitcher as never, {
      props: { scope: 'storefront' },
    });
    expect(storefrontHtml).toContain('data-storage-key="gargift_theme_mode"');
    expect(storefrontHtml).toContain('role="group"');
    expect(storefrontHtml).toContain('data-theme-option="light"');
    expect(storefrontHtml).toContain('data-theme-option="dark"');
    expect(storefrontHtml).toContain('data-theme-option="system"');
    expect(storefrontHtml).toContain('aria-pressed="false"');

    const adminHtml = await container.renderToString(ThemeSwitcher as never, {
      props: { scope: 'admin' },
    });
    expect(adminHtml).toContain('data-storage-key="gargift_theme_mode_admin"');
  });
});

