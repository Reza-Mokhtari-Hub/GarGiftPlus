/**
 * پیکربندی امن و اعتبارسنجی‌شده ظاهر فروشگاه (Storefront Theme Appearance)
 *
 * ماژول خالص بدون وابستگی به Cloudflare تا توسط تست‌های واحد، پنل ادمین (`/admin/theme`)
 * و قالب فروشگاه (`Layout.astro`) به‌طور یکسان استفاده شود.
 *
 * تمام مقادیر قبل از صدور در CSS با لیست سفید (Allowlist) و الگوهای سخت‌گیرانه اعتبارسنجی می‌شوند
 * تا امکان تزریق CSS/HTML به هیچ وجه وجود نداشته باشد.
 */

export type ThemeFontPreset = 'vazirmatn' | 'vazirmatn_tight' | 'vazirmatn_mono';
export type ThemeRadiusPreset = 'sharp' | 'balanced' | 'rounded' | 'pill_soft';
export type ThemeButtonPreset = 'solid_soft' | 'vibrant_gradient' | 'crisp_outline';
export type ThemeCardPreset = 'elevated' | 'bordered' | 'glass_soft';
export type StorefrontThemeMode = 'light' | 'dark' | 'system';

export interface ThemeAppearanceConfig {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontPreset: ThemeFontPreset;
  radiusPreset: ThemeRadiusPreset;
  buttonStyle: ThemeButtonPreset;
  cardStyle: ThemeCardPreset;
  defaultMode: StorefrontThemeMode;
  allowLightMode: boolean;
  allowDarkMode: boolean;
  allowSystemMode: boolean;
}

export const DEFAULT_THEME_APPEARANCE: ThemeAppearanceConfig = {
  primaryColor: '#7043E8',
  secondaryColor: '#35D9CC',
  accentColor: '#FF6C9B',
  fontPreset: 'vazirmatn',
  radiusPreset: 'rounded',
  buttonStyle: 'solid_soft',
  cardStyle: 'elevated',
  defaultMode: 'system',
  allowLightMode: true,
  allowDarkMode: true,
  allowSystemMode: true,
};

export const CURATED_COLOR_SWATCHES: ReadonlyArray<{
  label: string;
  primary: string;
  secondary: string;
  accent: string;
}> = [
  {
    label: 'بنفش گرگیفت+ و فیروزه‌ای (پیشنهادی)',
    primary: '#7043E8',
    secondary: '#35D9CC',
    accent: '#FF6C9B',
  },
  {
    label: 'نیلی مدرن و سبز نعنایی',
    primary: '#5B46F6',
    secondary: '#10B981',
    accent: '#F59E0B',
  },
  {
    label: 'ارغوانی دیجیتال و آبی نئون',
    primary: '#8657FF',
    secondary: '#06B6D4',
    accent: '#EC4899',
  },
  {
    label: 'لاجوردی کلاسیک و طلایی',
    primary: '#2563EB',
    secondary: '#14B8A6',
    accent: '#F59E0B',
  },
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return fallback;
  return trimmed.toUpperCase();
}

export function hexToHoverHex(hex: string): string {
  const clean = normalizeHexColor(hex, '#7043E8').slice(1);
  const r = Math.max(0, Math.min(255, parseInt(clean.slice(0, 2), 16) - 18));
  const g = Math.max(0, Math.min(255, parseInt(clean.slice(2, 4), 16) - 18));
  const b = Math.max(0, Math.min(255, parseInt(clean.slice(4, 6), 16) - 18));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function parseThemeAppearanceConfig(raw: string | null | undefined): ThemeAppearanceConfig {
  if (!raw || !raw.trim()) return { ...DEFAULT_THEME_APPEARANCE };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_THEME_APPEARANCE };

    const fontPreset: ThemeFontPreset =
      parsed.fontPreset === 'vazirmatn_tight' || parsed.fontPreset === 'vazirmatn_mono'
        ? parsed.fontPreset
        : 'vazirmatn';

    const radiusPreset: ThemeRadiusPreset =
      parsed.radiusPreset === 'sharp' ||
      parsed.radiusPreset === 'balanced' ||
      parsed.radiusPreset === 'pill_soft'
        ? parsed.radiusPreset
        : 'rounded';

    const buttonStyle: ThemeButtonPreset =
      parsed.buttonStyle === 'vibrant_gradient' || parsed.buttonStyle === 'crisp_outline'
        ? parsed.buttonStyle
        : 'solid_soft';

    const cardStyle: ThemeCardPreset =
      parsed.cardStyle === 'bordered' || parsed.cardStyle === 'glass_soft'
        ? parsed.cardStyle
        : 'elevated';

    const defaultMode: StorefrontThemeMode =
      parsed.defaultMode === 'light' || parsed.defaultMode === 'dark'
        ? parsed.defaultMode
        : 'system';

    const allowLightMode = parsed.allowLightMode !== false;
    const allowDarkMode = parsed.allowDarkMode !== false;
    const allowSystemMode = parsed.allowSystemMode !== false;

    // حداقل یک حالت باید مجاز باقی بماند
    const safeAllowLight = allowLightMode || !allowDarkMode;

    return {
      primaryColor: normalizeHexColor(parsed.primaryColor, DEFAULT_THEME_APPEARANCE.primaryColor),
      secondaryColor: normalizeHexColor(parsed.secondaryColor, DEFAULT_THEME_APPEARANCE.secondaryColor),
      accentColor: normalizeHexColor(parsed.accentColor, DEFAULT_THEME_APPEARANCE.accentColor),
      fontPreset,
      radiusPreset,
      buttonStyle,
      cardStyle,
      defaultMode,
      allowLightMode: safeAllowLight,
      allowDarkMode,
      allowSystemMode,
    };
  } catch {
    return { ...DEFAULT_THEME_APPEARANCE };
  }
}

export function resolveRadiusTokens(preset: ThemeRadiusPreset): {
  button: string;
  card: string;
} {
  switch (preset) {
    case 'sharp':
      return { button: '0.5rem', card: '0.75rem' };
    case 'balanced':
      return { button: '0.75rem', card: '1rem' };
    case 'pill_soft':
      return { button: '9999px', card: '1.5rem' };
    case 'rounded':
    default:
      return { button: '0.875rem', card: '1.125rem' };
  }
}

/**
 * تبدیل تنظیمات تاییدشده به متغیرهای CSS امن (بدون هیچ کد اجرایی)
 */
export function buildStorefrontAppearanceCss(config: ThemeAppearanceConfig): string {
  const radii = resolveRadiusTokens(config.radiusPreset);
  const hover = hexToHoverHex(config.primaryColor);
  return `:root{--color-brand:${config.primaryColor};--color-brand-hover:${hover};--color-accent:${config.secondaryColor};--gg-accent-coral:${config.accentColor};--radius-button:${radii.button};--radius-card:${radii.card};}`;
}
