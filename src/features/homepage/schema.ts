/**
 * GarGift+ Phase 4: Dynamic Homepage & Storefront CMS Validation Schema.
 *
 * Pure module (zero Cloudflare runtime imports) so it can be unit-tested in
 * Vitest and reused across API routes, admin forms, and storefront builders.
 *
 * Security invariants:
 * 1. Only allowlisted section keys may be configured or rendered.
 * 2. Arbitrary raw HTML, <script>, inline event handlers, and javascript:/data:
 *    URLs are rejected at validation time.
 * 3. Schedule windows (start_at / end_at) are validated and evaluated
 *    deterministically.
 */

export const HOMEPAGE_SECTION_KEYS = [
  'announcement',
  'hero',
  'categories',
  'featured_products',
  'popular_products',
  'ai_products',
  'gaming_products',
  'gift_cards',
  'promotional_banners',
  'service_benefits',
  'testimonials',
  'faq',
  'final_cta',
] as const;

export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

export const BANNER_ACCENT_THEMES = [
  'violet',
  'turquoise',
  'coral',
  'amber',
  'navy',
] as const;

export type BannerAccentTheme = (typeof BANNER_ACCENT_THEMES)[number];

export const FAQ_CATEGORIES = [
  'general',
  'delivery',
  'payment',
  'security',
  'tracking',
  'wallet',
] as const;

export type FaqCategory = (typeof FAQ_CATEGORIES)[number];

export const SECTION_LABELS_FA: Record<HomepageSectionKey, string> = {
  announcement: 'نوار اطلاع‌رسانی بالای سایت (Announcement Bar)',
  hero: 'بخش اصلی بالای صفحه (Hero Section)',
  categories: 'دسته‌بندی‌های اصلی محصولات (Main Categories)',
  featured_products: 'محصولات ویژه و منتخب (Featured Products)',
  popular_products: 'پرفروش‌ترین و محبوب‌ترین محصولات (Popular Products)',
  ai_products: 'بخش اشتراک‌های هوش مصنوعی (AI Subscriptions)',
  gaming_products: 'بخش شارژ بازی‌ها و گیمینگ (Gaming Products)',
  gift_cards: 'بخش گیفت‌کارت‌های بین‌المللی (Gift Cards)',
  promotional_banners: 'بنرهای تبلیغاتی و کمپین‌ها (Promotional Banners)',
  service_benefits: 'مزایا و تضمین خدمات گرگیفت+ (Trust & Service Benefits)',
  testimonials: 'دیدگاه‌های تاییدشده مشتریان (Customer Reviews)',
  faq: 'پرسش‌های متداول (FAQ Section)',
  final_cta: 'بخش دعوت به اقدام پایانی (Final CTA)',
};

export interface ServiceBenefitItem {
  icon: 'support' | 'shield' | 'delivery' | 'tracking' | 'history';
  title: string;
  description: string;
}

export interface FooterConfig {
  description: string;
  supportHours: string;
  supportEmail: string;
  supportPhone: string;
  telegramUrl: string | null;
  instagramUrl: string | null;
  copyrightText: string;
  trustNote: string;
}

export const DEFAULT_FOOTER_CONFIG: FooterConfig = {
  description:
    'گرگیفت+ (GarGift+) پلتفرم تخصصی خرید گیفت‌کارت‌های اورجینال، اشتراک‌های هوش مصنوعی و شارژ بازی‌های آنلاین با پرداخت امن ریالی، کیف پول اختصاصی و تحویل تخصصی توسط تیم پشتیبانی است.',
  supportHours: 'همه‌روزه از ساعت ۹:۰۰ تا ۲۴:۰۰',
  supportEmail: 'support@gargift.ir',
  supportPhone: '۰۲۱-۹۱۰۰۲۴۰۰',
  telegramUrl: null,
  instagramUrl: null,
  copyrightText: 'تمامی حقوق برای پلتفرم محصولات دیجیتال GarGift+ محفوظ است.',
  trustNote:
    'تمامی سفارش‌ها پس از تایید پرداخت، توسط تیم تخصصی گرگیفت+ بررسی و تحویل می‌شوند و جزئیات کامل تحویل در حساب کاربری شما ثبت می‌گردد.',
};

export const DEFAULT_SERVICE_BENEFITS: ServiceBenefitItem[] = [
  {
    icon: 'support',
    title: 'پشتیبانی تخصصی مشتریان',
    description: 'همراهی تیم پشتیبانی گرگیفت+ در تمامی مراحل ثبت و تکمیل سفارش.',
  },
  {
    icon: 'shield',
    title: 'پرداخت امن ریالی و کیف پول',
    description: 'تسویه از طریق درگاه بانکی، کیف پول کاربری یا واریز کارت‌به‌کارت با ثبت رسید.',
  },
  {
    icon: 'delivery',
    title: 'تحویل توسط تیم گرگیفت+',
    description: 'بررسی و انجام دقیق هر ردیف سفارش توسط اپراتورهای مجاز به همراه ثبت کد و فایل پیوست.',
  },
  {
    icon: 'tracking',
    title: 'پیگیری شفاف وضعیت سفارش',
    description: 'مشاهده وضعیت لحظه‌ای هر آیتم سفارش، تایم‌لاین رویدادها و اعلان ایمیلی.',
  },
  {
    icon: 'history',
    title: 'دسترسی دائمی به سوابق خرید',
    description: 'آرشیو کامل کدهای تحویلی، فایل‌های پیوست و تراکنش‌های مالی در حساب کاربری شما.',
  },
];

export function isValidHomepageSectionKey(value: unknown): value is HomepageSectionKey {
  return (
    typeof value === 'string' &&
    (HOMEPAGE_SECTION_KEYS as readonly string[]).includes(value)
  );
}

export function isValidBannerAccentTheme(value: unknown): value is BannerAccentTheme {
  return (
    typeof value === 'string' &&
    (BANNER_ACCENT_THEMES as readonly string[]).includes(value)
  );
}

export function isValidFaqCategory(value: unknown): value is FaqCategory {
  return (
    typeof value === 'string' &&
    (FAQ_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Rejects strings containing HTML tags or script/event injection vectors.
 */
const HTML_TAG_RE = /<[a-z!/][\s\S]*?>/i;
const DANGEROUS_ATTR_OR_PROTO_RE = /\b(?:javascript|vbscript|data)\s*:|on[a-z]{3,}\s*=/i;

export function containsUnsafeMarkup(text: string): boolean {
  return HTML_TAG_RE.test(text) || DANGEROUS_ATTR_OR_PROTO_RE.test(text);
}

/**
 * Validates that a link destination is either a safe root-relative path (`/products`)
 * or an `https://` URL. Rejects `javascript:`, `data:`, `vbscript:`, `http://`, and `//`.
 */
export function validateSafeStorefrontHref(
  raw: unknown,
  options: { required?: boolean } = {},
): { ok: true; value: string | null } | { ok: false; error: string } {
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (!str) {
    if (options.required) {
      return { ok: false, error: 'وارد کردن لینک مقصد الزامی است.' };
    }
    return { ok: true, value: null };
  }
  if (str.length > 500) {
    return { ok: false, error: 'طول لینک مقصد بیش از حد مجاز است.' };
  }
  if (containsUnsafeMarkup(str)) {
    return { ok: false, error: 'لینک مقصد حاوی کاراکترهای غیرمجاز است.' };
  }
  if (str.startsWith('/')) {
    if (str.startsWith('//') || str.startsWith('/\\')) {
      return { ok: false, error: 'لینک نسبی نامعتبر است.' };
    }
    return { ok: true, value: str };
  }
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'فقط لینک‌های داخلی (با شروع /) یا https:// مجاز هستند.' };
    }
    return { ok: true, value: parsed.toString() };
  } catch {
    return { ok: false, error: 'فرمت آدرس لینک مقصد معتبر نیست.' };
  }
}

/**
 * Validates an optional R2 media image_key (`media/...` or `products/...`).
 */
export function validateOptionalImageKey(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (!str) return { ok: true, value: null };
  if (str.length > 200 || /\.\.|[\s<>'"\\]/.test(str)) {
    return { ok: false, error: 'کلید تصویر انتخاب‌شده معتبر نیست.' };
  }
  return { ok: true, value: str };
}

/**
 * Parses and validates optional start_at / end_at schedule timestamps.
 */
export function validateScheduleWindow(
  startRaw: unknown,
  endRaw: unknown,
): { ok: true; startAt: string | null; endAt: string | null } | { ok: false; error: string } {
  const normalizeDate = (val: unknown): string | null | 'INVALID' => {
    const s = typeof val === 'string' ? val.trim() : '';
    if (!s) return null;
    const ms = Date.parse(s);
    if (!Number.isFinite(ms)) return 'INVALID';
    return new Date(ms).toISOString();
  };

  const startAt = normalizeDate(startRaw);
  const endAt = normalizeDate(endRaw);
  if (startAt === 'INVALID' || endAt === 'INVALID') {
    return { ok: false, error: 'فرمت تاریخ شروع یا پایان زمان‌بندی معتبر نیست.' };
  }
  if (startAt && endAt && Date.parse(endAt) < Date.parse(startAt)) {
    return { ok: false, error: 'تاریخ پایان زمان‌بندی نمی‌تواند قبل از تاریخ شروع باشد.' };
  }
  return { ok: true, startAt, endAt };
}

/**
 * Evaluates whether an item with optional `start_at` and `end_at` is currently
 * active at `nowMs`.
 */
export function isWithinScheduleWindow(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (startAt && startAt.trim() !== '') {
    const startMs = Date.parse(startAt);
    if (Number.isFinite(startMs) && nowMs < startMs) return false;
  }
  if (endAt && endAt.trim() !== '') {
    const endMs = Date.parse(endAt);
    if (Number.isFinite(endMs) && nowMs > endMs) return false;
  }
  return true;
}

export interface ValidatedHomepageSectionUpdate {
  sectionKey: HomepageSectionKey;
  title: string;
  subtitle: string | null;
  description: string | null;
  badgeText: string | null;
  ctaText: string | null;
  ctaHref: string | null;
  secondaryCtaText: string | null;
  secondaryCtaHref: string | null;
  desktopImageKey: string | null;
  mobileImageKey: string | null;
  categoryFilterSlug: string | null;
  maxItems: number;
  isEnabled: boolean;
  sortOrder: number;
  startAt: string | null;
  endAt: string | null;
}

function cleanOptionalText(
  raw: unknown,
  maxLen: number,
  fieldLabel: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { ok: true, value: null };
  if (s.length > maxLen) {
    return { ok: false, error: `${fieldLabel} نباید بیشتر از ${maxLen} کاراکتر باشد.` };
  }
  if (containsUnsafeMarkup(s)) {
    return { ok: false, error: `${fieldLabel} نمی‌تواند حاوی تگ‌های HTML یا اسکریپت باشد.` };
  }
  return { ok: true, value: s };
}

export function parseHomepageSectionInput(
  raw: Record<string, unknown>,
): { ok: true; data: ValidatedHomepageSectionUpdate } | { ok: false; error: string } {
  const sectionKey = raw.sectionKey ?? raw.section_key;
  if (!isValidHomepageSectionKey(sectionKey)) {
    return { ok: false, error: 'نوع بخش انتخاب‌شده در لیست مجاز صفحه اصلی وجود ندارد.' };
  }

  const titleCheck = cleanOptionalText(raw.title, 180, 'عنوان بخش');
  if (!titleCheck.ok) return titleCheck;
  if (!titleCheck.value) {
    return { ok: false, error: 'وارد کردن عنوان بخش الزامی است.' };
  }

  const subtitleCheck = cleanOptionalText(raw.subtitle, 280, 'زیرعنوان بخش');
  if (!subtitleCheck.ok) return subtitleCheck;

  const descCheck = cleanOptionalText(raw.description, 1000, 'توضیحات بخش');
  if (!descCheck.ok) return descCheck;

  const badgeCheck = cleanOptionalText(raw.badgeText ?? raw.badge_text, 80, 'متن نشان (Badge)');
  if (!badgeCheck.ok) return badgeCheck;

  const ctaTextCheck = cleanOptionalText(raw.ctaText ?? raw.cta_text, 80, 'متن دکمه اصلی');
  if (!ctaTextCheck.ok) return ctaTextCheck;

  const ctaHrefCheck = validateSafeStorefrontHref(raw.ctaHref ?? raw.cta_href, { required: false });
  if (!ctaHrefCheck.ok) return ctaHrefCheck;

  const secCtaTextCheck = cleanOptionalText(
    raw.secondaryCtaText ?? raw.secondary_cta_text,
    80,
    'متن دکمه دوم',
  );
  if (!secCtaTextCheck.ok) return secCtaTextCheck;

  const secCtaHrefCheck = validateSafeStorefrontHref(
    raw.secondaryCtaHref ?? raw.secondary_cta_href,
    { required: false },
  );
  if (!secCtaHrefCheck.ok) return secCtaHrefCheck;

  const desktopImgCheck = validateOptionalImageKey(raw.desktopImageKey ?? raw.desktop_image_key);
  if (!desktopImgCheck.ok) return desktopImgCheck;

  const mobileImgCheck = validateOptionalImageKey(raw.mobileImageKey ?? raw.mobile_image_key);
  if (!mobileImgCheck.ok) return mobileImgCheck;

  const catSlugRaw =
    typeof (raw.categoryFilterSlug ?? raw.category_filter_slug) === 'string'
      ? String(raw.categoryFilterSlug ?? raw.category_filter_slug).trim()
      : '';
  if (catSlugRaw && (catSlugRaw.length > 100 || !/^[a-z0-9-]+$/i.test(catSlugRaw))) {
    return { ok: false, error: 'اسلاگ دسته‌بندی فیلتر معتبر نیست.' };
  }

  const rawMax = Number(raw.maxItems ?? raw.max_items ?? 8);
  const maxItems = Number.isFinite(rawMax)
    ? Math.max(1, Math.min(24, Math.trunc(rawMax)))
    : 8;

  const rawSort = Number(raw.sortOrder ?? raw.sort_order ?? 0);
  const sortOrder = Number.isFinite(rawSort)
    ? Math.max(-1000, Math.min(10000, Math.trunc(rawSort)))
    : 0;

  const isEnabledRaw = raw.isEnabled ?? raw.is_enabled;
  const isEnabled =
    isEnabledRaw === true ||
    isEnabledRaw === 1 ||
    isEnabledRaw === '1' ||
    isEnabledRaw === 'true' ||
    isEnabledRaw === 'on';

  const scheduleCheck = validateScheduleWindow(
    raw.startAt ?? raw.start_at,
    raw.endAt ?? raw.end_at,
  );
  if (!scheduleCheck.ok) return scheduleCheck;

  return {
    ok: true,
    data: {
      sectionKey,
      title: titleCheck.value,
      subtitle: subtitleCheck.value,
      description: descCheck.value,
      badgeText: badgeCheck.value,
      ctaText: ctaTextCheck.value,
      ctaHref: ctaHrefCheck.value,
      secondaryCtaText: secCtaTextCheck.value,
      secondaryCtaHref: secCtaHrefCheck.value,
      desktopImageKey: desktopImgCheck.value,
      mobileImageKey: mobileImgCheck.value,
      categoryFilterSlug: catSlugRaw || null,
      maxItems,
      isEnabled,
      sortOrder,
      startAt: scheduleCheck.startAt,
      endAt: scheduleCheck.endAt,
    },
  };
}

export interface ValidatedPromotionalBannerInput {
  title: string;
  subtitle: string | null;
  description: string | null;
  badgeText: string | null;
  ctaText: string | null;
  ctaHref: string;
  desktopImageKey: string | null;
  mobileImageKey: string | null;
  altText: string;
  accentTheme: BannerAccentTheme;
  startAt: string | null;
  endAt: string | null;
  sortOrder: number;
  isActive: boolean;
}

export function parsePromotionalBannerInput(
  raw: Record<string, unknown>,
): { ok: true; data: ValidatedPromotionalBannerInput } | { ok: false; error: string } {
  const titleCheck = cleanOptionalText(raw.title, 160, 'عنوان بنر');
  if (!titleCheck.ok) return titleCheck;
  if (!titleCheck.value) {
    return { ok: false, error: 'وارد کردن عنوان بنر الزامی است.' };
  }

  const subtitleCheck = cleanOptionalText(raw.subtitle, 200, 'زیرعنوان بنر');
  if (!subtitleCheck.ok) return subtitleCheck;

  const descCheck = cleanOptionalText(raw.description, 600, 'توضیحات بنر');
  if (!descCheck.ok) return descCheck;

  const badgeCheck = cleanOptionalText(raw.badgeText ?? raw.badge_text, 60, 'نشان بنر');
  if (!badgeCheck.ok) return badgeCheck;

  const ctaTextCheck = cleanOptionalText(raw.ctaText ?? raw.cta_text, 60, 'متن دکمه بنر');
  if (!ctaTextCheck.ok) return ctaTextCheck;

  const ctaHrefCheck = validateSafeStorefrontHref(raw.ctaHref ?? raw.cta_href, { required: true });
  if (!ctaHrefCheck.ok) return ctaHrefCheck;

  const desktopImgCheck = validateOptionalImageKey(raw.desktopImageKey ?? raw.desktop_image_key);
  if (!desktopImgCheck.ok) return desktopImgCheck;

  const mobileImgCheck = validateOptionalImageKey(raw.mobileImageKey ?? raw.mobile_image_key);
  if (!mobileImgCheck.ok) return mobileImgCheck;

  const altCheck = cleanOptionalText(raw.altText ?? raw.alt_text, 160, 'متن جایگزین تصویر (Alt)');
  if (!altCheck.ok) return altCheck;

  const rawAccent = raw.accentTheme ?? raw.accent_theme ?? 'violet';
  const accentTheme: BannerAccentTheme = isValidBannerAccentTheme(rawAccent)
    ? rawAccent
    : 'violet';

  const scheduleCheck = validateScheduleWindow(
    raw.startAt ?? raw.start_at,
    raw.endAt ?? raw.end_at,
  );
  if (!scheduleCheck.ok) return scheduleCheck;

  const rawSort = Number(raw.sortOrder ?? raw.sort_order ?? 0);
  const sortOrder = Number.isFinite(rawSort)
    ? Math.max(-1000, Math.min(10000, Math.trunc(rawSort)))
    : 0;

  const isActiveRaw = raw.isActive ?? raw.is_active;
  const isActive =
    isActiveRaw === true ||
    isActiveRaw === 1 ||
    isActiveRaw === '1' ||
    isActiveRaw === 'true' ||
    isActiveRaw === 'on';

  return {
    ok: true,
    data: {
      title: titleCheck.value,
      subtitle: subtitleCheck.value,
      description: descCheck.value,
      badgeText: badgeCheck.value,
      ctaText: ctaTextCheck.value ?? 'مشاهده پیشنهاد',
      ctaHref: ctaHrefCheck.value!,
      desktopImageKey: desktopImgCheck.value,
      mobileImageKey: mobileImgCheck.value,
      altText: altCheck.value ?? titleCheck.value,
      accentTheme,
      startAt: scheduleCheck.startAt,
      endAt: scheduleCheck.endAt,
      sortOrder,
      isActive,
    },
  };
}

export interface ValidatedStorefrontFaqInput {
  question: string;
  answer: string;
  category: FaqCategory;
  sortOrder: number;
  isActive: boolean;
}

export function parseStorefrontFaqInput(
  raw: Record<string, unknown>,
): { ok: true; data: ValidatedStorefrontFaqInput } | { ok: false; error: string } {
  const qCheck = cleanOptionalText(raw.question, 300, 'پرسش');
  if (!qCheck.ok) return qCheck;
  if (!qCheck.value) {
    return { ok: false, error: 'وارد کردن متن پرسش الزامی است.' };
  }

  const aCheck = cleanOptionalText(raw.answer, 2000, 'پاسخ');
  if (!aCheck.ok) return aCheck;
  if (!aCheck.value) {
    return { ok: false, error: 'وارد کردن متن پاسخ الزامی است.' };
  }

  const catRaw = raw.category ?? 'general';
  const category: FaqCategory = isValidFaqCategory(catRaw) ? catRaw : 'general';

  const rawSort = Number(raw.sortOrder ?? raw.sort_order ?? 0);
  const sortOrder = Number.isFinite(rawSort)
    ? Math.max(-1000, Math.min(10000, Math.trunc(rawSort)))
    : 0;

  const isActiveRaw = raw.isActive ?? raw.is_active;
  const isActive =
    isActiveRaw === true ||
    isActiveRaw === 1 ||
    isActiveRaw === '1' ||
    isActiveRaw === 'true' ||
    isActiveRaw === 'on';

  return {
    ok: true,
    data: {
      question: qCheck.value,
      answer: aCheck.value,
      category,
      sortOrder,
      isActive,
    },
  };
}

export function parseFooterConfigInput(
  raw: Record<string, unknown>,
): { ok: true; data: FooterConfig } | { ok: false; error: string } {
  const descCheck = cleanOptionalText(raw.description, 600, 'توضیحات فوتر');
  if (!descCheck.ok) return descCheck;

  const hoursCheck = cleanOptionalText(raw.supportHours, 120, 'ساعات پاسخگویی');
  if (!hoursCheck.ok) return hoursCheck;

  const emailCheck = cleanOptionalText(raw.supportEmail, 120, 'ایمیل پشتیبانی');
  if (!emailCheck.ok) return emailCheck;

  const phoneCheck = cleanOptionalText(raw.supportPhone, 60, 'تلفن پشتیبانی');
  if (!phoneCheck.ok) return phoneCheck;

  const tgCheck = validateSafeStorefrontHref(raw.telegramUrl, { required: false });
  if (!tgCheck.ok) return tgCheck;

  const igCheck = validateSafeStorefrontHref(raw.instagramUrl, { required: false });
  if (!igCheck.ok) return igCheck;

  const copyCheck = cleanOptionalText(raw.copyrightText, 240, 'متن کپی‌رایت');
  if (!copyCheck.ok) return copyCheck;

  const trustCheck = cleanOptionalText(raw.trustNote, 400, 'یادداشت اعتماد و تحویل');
  if (!trustCheck.ok) return trustCheck;

  return {
    ok: true,
    data: {
      description: descCheck.value ?? DEFAULT_FOOTER_CONFIG.description,
      supportHours: hoursCheck.value ?? DEFAULT_FOOTER_CONFIG.supportHours,
      supportEmail: emailCheck.value ?? DEFAULT_FOOTER_CONFIG.supportEmail,
      supportPhone: phoneCheck.value ?? DEFAULT_FOOTER_CONFIG.supportPhone,
      telegramUrl: tgCheck.value,
      instagramUrl: igCheck.value,
      copyrightText: copyCheck.value ?? DEFAULT_FOOTER_CONFIG.copyrightText,
      trustNote: trustCheck.value ?? DEFAULT_FOOTER_CONFIG.trustNote,
    },
  };
}
