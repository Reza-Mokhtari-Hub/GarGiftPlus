/**
 * منطق خالص و مشترک مدیریت ظاهر (روشن / تاریک / سیستم) برای GarGift+
 *
 * مستقل از DOM یا Cloudflare Workers تا هم در اسکریپت ضدپرش <head>،
 * هم در کنترل سوئیچر کلاینت و هم در تست‌های واحد استفاده شود.
 */

export const THEME_PREFERENCE_KEY = 'gargift_theme_mode';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type ThemeScope = 'storefront' | 'admin';

export const VALID_THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** اعتبارسنجی و نرمال‌سازی مقدار تم؛ مقادیر نامعتبر به پیش‌فرض system برمی‌گردند. */
export function normalizeThemeMode(value: unknown, fallback: ThemeMode = 'system'): ThemeMode {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'light' || trimmed === 'dark' || trimmed === 'system') {
    return trimmed;
  }
  return fallback;
}

/** تبدیل حالت انتخابی کاربر و ترجیح سیستم‌عامل به تم نهایی ('light' | 'dark'). */
export function resolveThemeAppearance(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark ? 'dark' : 'light';
}

/** کلید ذخیره‌سازی مجزا برای حفظ استقلال انتخاب تم در فروشگاه و پنل مدیریت. */
export function storageKeyForScope(scope: ThemeScope): string {
  return scope === 'admin' ? `${THEME_PREFERENCE_KEY}_admin` : THEME_PREFERENCE_KEY;
}

export function cookieKeyForScope(scope: ThemeScope): string {
  return storageKeyForScope(scope);
}

/**
 * تولید اسکریپت سبک inline برای اجرا در <head> پیش از First Paint جهت جلوگیری کامل از FOUC.
 * دسترسی به localStorage و document.cookie کاملاً داخل try/catch ایزوله شده است.
 */
export function buildThemeInitScript(scope: ThemeScope, defaultMode: ThemeMode = 'system'): string {
  const key = JSON.stringify(storageKeyForScope(scope));
  const fallback = JSON.stringify(normalizeThemeMode(defaultMode));
  return `(function(){try{var k=${key},d=${fallback},m=null;try{m=localStorage.getItem(k)}catch(_){}if(!m){try{var c=document.cookie.match(new RegExp('(?:^|;\\\\s*)'+k+'=([^;]+)'));if(c)m=decodeURIComponent(c[1])}catch(_){}}if(m!=='light'&&m!=='dark'&&m!=='system')m=d;var sys=false;try{sys=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches}catch(_){}var r=m==='dark'||(m==='system'&&sys)?'dark':'light';var el=document.documentElement;el.dataset.theme=r;el.dataset.themeMode=m;el.dataset.themeScope=${JSON.stringify(scope)};el.classList.toggle('dark',r==='dark')}catch(_){}})();`;
}
