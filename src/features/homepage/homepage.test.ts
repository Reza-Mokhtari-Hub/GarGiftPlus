import { describe, expect, it } from 'vitest';
import {
  HOMEPAGE_SECTION_KEYS,
  containsUnsafeMarkup,
  isValidBannerAccentTheme,
  isValidFaqCategory,
  isValidHomepageSectionKey,
  isWithinScheduleWindow,
  parseFooterConfigInput,
  parseHomepageSectionInput,
  parsePromotionalBannerInput,
  parseStorefrontFaqInput,
  validateOptionalImageKey,
  validateSafeStorefrontHref,
  validateScheduleWindow,
} from './schema';

describe('GarGift+ Phase 4 — Homepage & Storefront CMS Schema Validation', () => {
  it('recognizes all 13 allowlisted homepage section keys and rejects unknown keys', () => {
    expect(HOMEPAGE_SECTION_KEYS).toHaveLength(13);
    for (const key of HOMEPAGE_SECTION_KEYS) {
      expect(isValidHomepageSectionKey(key)).toBe(true);
    }
    expect(isValidHomepageSectionKey('custom_html')).toBe(false);
    expect(isValidHomepageSectionKey('script_injection')).toBe(false);
    expect(isValidHomepageSectionKey('')).toBe(false);
    expect(isValidHomepageSectionKey(null)).toBe(false);
  });

  it('detects unsafe HTML tags and script/event-handler payloads', () => {
    expect(containsUnsafeMarkup('دنیای دیجیتال، یک قدم نزدیک‌تر')).toBe(false);
    expect(containsUnsafeMarkup('ChatGPT Plus & Claude Pro')).toBe(false);
    expect(containsUnsafeMarkup('<script>alert(1)</script>')).toBe(true);
    expect(containsUnsafeMarkup('<img src=x onerror=alert(1)>')).toBe(true);
    expect(containsUnsafeMarkup('javascript:alert(1)')).toBe(true);
    expect(containsUnsafeMarkup('onload= evil()')).toBe(true);
  });

  it('validates safe storefront hrefs and rejects dangerous protocols', () => {
    expect(validateSafeStorefrontHref('/products')).toEqual({
      ok: true,
      value: '/products',
    });
    expect(validateSafeStorefrontHref('/categories/gift-cards?sort=price')).toEqual({
      ok: true,
      value: '/categories/gift-cards?sort=price',
    });
    expect(validateSafeStorefrontHref('https://t.me/gargift')).toEqual({
      ok: true,
      value: 'https://t.me/gargift',
    });
    expect(validateSafeStorefrontHref('')).toEqual({
      ok: true,
      value: null,
    });
    expect(validateSafeStorefrontHref('', { required: true }).ok).toBe(false);
    expect(validateSafeStorefrontHref('//evil.example.com').ok).toBe(false);
    expect(validateSafeStorefrontHref('javascript:alert(1)').ok).toBe(false);
    expect(validateSafeStorefrontHref('data:text/html,<script>alert(1)</script>').ok).toBe(false);
    expect(validateSafeStorefrontHref('http://insecure.example.com').ok).toBe(false);
  });

  it('validates optional R2 media image keys and rejects path traversal', () => {
    expect(validateOptionalImageKey('media/0123456789abcdef0123.webp')).toEqual({
      ok: true,
      value: 'media/0123456789abcdef0123.webp',
    });
    expect(validateOptionalImageKey('')).toEqual({ ok: true, value: null });
    expect(validateOptionalImageKey('../secrets/vault').ok).toBe(false);
    expect(validateOptionalImageKey('media/<script>.png').ok).toBe(false);
  });

  it('validates and evaluates schedule windows accurately', () => {
    const valid = validateScheduleWindow('2026-05-01T00:00:00Z', '2026-05-10T23:59:59Z');
    expect(valid.ok).toBe(true);

    const inverted = validateScheduleWindow('2026-05-10T00:00:00Z', '2026-05-01T00:00:00Z');
    expect(inverted.ok).toBe(false);

    const malformed = validateScheduleWindow('not-a-date', null);
    expect(malformed.ok).toBe(false);

    const now = Date.parse('2026-05-05T12:00:00Z');
    expect(isWithinScheduleWindow(null, null, now)).toBe(true);
    expect(
      isWithinScheduleWindow('2026-05-01T00:00:00Z', '2026-05-10T00:00:00Z', now),
    ).toBe(true);
    // Future scheduled item is not yet active
    expect(
      isWithinScheduleWindow('2026-05-08T00:00:00Z', '2026-05-10T00:00:00Z', now),
    ).toBe(false);
    // Expired item is no longer active
    expect(
      isWithinScheduleWindow('2026-05-01T00:00:00Z', '2026-05-04T00:00:00Z', now),
    ).toBe(false);
  });

  it('parses valid homepage section updates and rejects invalid section keys or HTML injection', () => {
    const validHero = parseHomepageSectionInput({
      section_key: 'hero',
      title: 'دنیای دیجیتال، یک قدم نزدیک‌تر',
      subtitle: 'خرید امن گیفت‌کارت و اشتراک هوش مصنوعی',
      description: 'تحویل تخصصی توسط تیم گرگیفت+',
      badge_text: 'GarGift+',
      cta_text: 'مشاهده محصولات',
      cta_href: '/products',
      secondary_cta_text: 'ورود به حساب کاربری',
      secondary_cta_href: '/account',
      desktop_image_key: 'media/hero-desktop.webp',
      mobile_image_key: 'media/hero-mobile.webp',
      max_items: 6,
      sort_order: 20,
      is_enabled: '1',
    });
    expect(validHero.ok).toBe(true);
    if (validHero.ok) {
      expect(validHero.data.sectionKey).toBe('hero');
      expect(validHero.data.isEnabled).toBe(true);
      expect(validHero.data.desktopImageKey).toBe('media/hero-desktop.webp');
      expect(validHero.data.mobileImageKey).toBe('media/hero-mobile.webp');
    }

    const badKey = parseHomepageSectionInput({
      section_key: 'arbitrary_widget',
      title: 'تست',
    });
    expect(badKey.ok).toBe(false);

    const xssTitle = parseHomepageSectionInput({
      section_key: 'hero',
      title: '<script>alert("xss")</script>',
    });
    expect(xssTitle.ok).toBe(false);
  });

  it('parses promotional banners and enforces safe CTA hrefs and accent themes', () => {
    expect(isValidBannerAccentTheme('violet')).toBe(true);
    expect(isValidBannerAccentTheme('turquoise')).toBe(true);
    expect(isValidBannerAccentTheme('neon-green')).toBe(false);

    const validBanner = parsePromotionalBannerInput({
      title: 'کمپین ویژه اشتراک‌های هوش مصنوعی',
      subtitle: 'ChatGPT Plus · Claude Pro',
      cta_text: 'مشاهده پیشنهادها',
      cta_href: '/categories/ai-subscriptions',
      desktop_image_key: 'media/banner-d.webp',
      mobile_image_key: 'media/banner-m.webp',
      accent_theme: 'turquoise',
      sort_order: 15,
      is_active: true,
    });
    expect(validBanner.ok).toBe(true);
    if (validBanner.ok) {
      expect(validBanner.data.accentTheme).toBe('turquoise');
      expect(validBanner.data.ctaHref).toBe('/categories/ai-subscriptions');
    }

    const unsafeBanner = parsePromotionalBannerInput({
      title: 'بنر مخرب',
      cta_href: 'javascript:evil()',
    });
    expect(unsafeBanner.ok).toBe(false);
  });

  it('parses storefront FAQs and footer configuration safely', () => {
    expect(isValidFaqCategory('delivery')).toBe(true);
    expect(isValidFaqCategory('unknown')).toBe(false);

    const faq = parseStorefrontFaqInput({
      question: 'نحوه تحویل سفارش چگونه است؟',
      answer: 'توسط تیم تخصصی تحویل گرگیفت+ در پنل کاربری ثبت می‌شود.',
      category: 'delivery',
      sort_order: 10,
      is_active: '1',
    });
    expect(faq.ok).toBe(true);

    const footer = parseFooterConfigInput({
      description: 'فروشگاه تخصصی محصولات دیجیتال GarGift+',
      supportHours: '۹ الی ۲۴',
      supportEmail: 'support@gargift.ir',
      supportPhone: '۰۲۱-۹۱۰۰۲۴۰۰',
      copyrightText: 'تمامی حقوق محفوظ است.',
      trustNote: 'تحویل دستی توسط اپراتورهای مجاز',
    });
    expect(footer.ok).toBe(true);
  });
});
