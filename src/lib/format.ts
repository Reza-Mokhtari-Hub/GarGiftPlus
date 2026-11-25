/**
 * ابزارهای خالص فرمت‌بندی اعداد فارسی، پول (تومان/ریال) و تاریخ شمسی برای GarGift+
 *
 * طراحی‌شده با محاسبات تمام‌صحیح (Integer) و بدون وابستگی به Cloudflare Workers
 * تا در تست‌های واحد، کنترل‌های SSR و پردازش‌های مالی آینده به‌طور ایمن استفاده شود.
 */

export const DEFAULT_PERSIAN_TIME_ZONE = 'Asia/Tehran';

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

/** تبدیل تمام ارقام لاتین (0-9) به ارقام فارسی (۰-۹). */
export function toPersianDigits(input: string | number): string {
  const str = String(input);
  return str.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

/** تبدیل تمام ارقام فارسی (۰-۹) و عربی (٠-٩) به ارقام انگلیسی (0-9). */
export function toEnglishDigits(input: string | number): string {
  return String(input)
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
}

function assertSafeIntegerAmount(amount: number, fnName: string): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`${fnName}: amount must be a finite number`);
  }
  return Math.trunc(amount);
}

/** تبدیل تمام‌صحیح ریال به تومان (حذف رقم یکان ریال بدون اعشار شناور). */
export function rialToToman(amountRial: number): number {
  const rial = assertSafeIntegerAmount(amountRial, 'rialToToman');
  return Math.trunc(rial / 10);
}

/** تبدیل تمام‌صحیح تومان به ریال برای درگاه‌های بانکی ایران. */
export function tomanToRial(amountToman: number): number {
  const toman = assertSafeIntegerAmount(amountToman, 'tomanToRial');
  return toman * 10;
}

const integerGroupingFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  useGrouping: true,
});

function formatGroupedInteger(value: number, persianDigits: boolean): string {
  const intVal = assertSafeIntegerAmount(value, 'formatGroupedInteger');
  const sign = intVal < 0 ? '−' : '';
  const grouped = integerGroupingFormatter.format(Math.abs(intVal)).replace(/,/g, '٬');
  const formatted = `${sign}${grouped}`;
  return persianDigits ? toPersianDigits(formatted) : formatted;
}

export interface MoneyFormatOptions {
  /** نمایش با ارقام فارسی (پیش‌فرض: true) */
  persianDigits?: boolean;
  /** افزودن واحد «تومان» یا «ریال» (پیش‌فرض: true) */
  includeUnit?: boolean;
}

export interface TomanFormatOptions extends MoneyFormatOptions {
  /** اگر ورودی بر حسب ریال ذخیره شده باشد با تقسیم صحیح بر ۱۰ به تومان تبدیل می‌شود */
  fromRial?: boolean;
}

/**
 * فرمت‌بندی مبلغ بر حسب تومان با محاسبات تمام‌صحیح.
 * به‌طور پیش‌فرض ورودی را عدد صحیح تومان در نظر می‌گیرد؛ در صورت نیاز به تبدیل از ریال `fromRial: true` بدهید.
 */
export function formatToman(amount: number, options: TomanFormatOptions = {}): string {
  const { persianDigits = true, includeUnit = true, fromRial = false } = options;
  const toman = fromRial ? rialToToman(amount) : assertSafeIntegerAmount(amount, 'formatToman');
  const numStr = formatGroupedInteger(toman, persianDigits);
  return includeUnit ? `${numStr} تومان` : numStr;
}

/**
 * فرمت‌بندی مبلغ بر حسب ریال با محاسبات تمام‌صحیح.
 */
export function formatRial(amountRial: number, options: MoneyFormatOptions = {}): string {
  const { persianDigits = true, includeUnit = true } = options;
  const numStr = formatGroupedInteger(amountRial, persianDigits);
  return includeUnit ? `${numStr} ریال` : numStr;
}

/** تبدیل ورودی تاریخ (ISO / SQLite UTC / timestamp / Date) به Date معتبر یا null. */
function parseDateInput(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const trimmed = input.trim();
  if (!trimmed) return null;
  // SQLite datetime('now') produces "YYYY-MM-DD HH:MM:SS" in UTC without timezone designator.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export interface JalaliDateOptions {
  timeZone?: string;
  style?: 'short' | 'medium' | 'long' | 'full';
  persianDigits?: boolean;
}

function buildJalaliFormatter(
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
  persianDigits: boolean,
): Intl.DateTimeFormat {
  const locale = persianDigits ? 'fa-IR-u-ca-persian' : 'fa-IR-u-ca-persian-nu-latn';
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, ...opts });
  } catch {
    return new Intl.DateTimeFormat(locale, { timeZone: DEFAULT_PERSIAN_TIME_ZONE, ...opts });
  }
}

/**
 * فرمت تاریخ شمسی با منطقه زمانی پیش‌فرض Asia/Tehran.
 */
export function formatJalaliDate(
  input: Date | string | number | null | undefined,
  options: JalaliDateOptions = {},
): string {
  const date = parseDateInput(input);
  if (!date) return '';
  const {
    timeZone = DEFAULT_PERSIAN_TIME_ZONE,
    style = 'medium',
    persianDigits = true,
  } = options;

  const formatOpts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { year: 'numeric', month: '2-digit', day: '2-digit' }
      : style === 'long'
        ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }
        : style === 'full'
          ? { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }
          : { year: 'numeric', month: 'long', day: 'numeric' };

  const formatted = buildJalaliFormatter(timeZone, formatOpts, persianDigits).format(date);
  return persianDigits ? toPersianDigits(formatted) : toEnglishDigits(formatted);
}

export interface JalaliDateTimeOptions {
  timeZone?: string;
  persianDigits?: boolean;
  includeSeconds?: boolean;
}

/**
 * فرمت تاریخ و ساعت شمسی با منطقه زمانی پیش‌فرض Asia/Tehran.
 */
export function formatJalaliDateTime(
  input: Date | string | number | null | undefined,
  options: JalaliDateTimeOptions = {},
): string {
  const date = parseDateInput(input);
  if (!date) return '';
  const {
    timeZone = DEFAULT_PERSIAN_TIME_ZONE,
    persianDigits = true,
    includeSeconds = false,
  } = options;

  const formatOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  };

  const formatted = buildJalaliFormatter(timeZone, formatOpts, persianDigits).format(date);
  return persianDigits ? toPersianDigits(formatted) : toEnglishDigits(formatted);
}

export interface RelativeTimeOptions {
  now?: Date | number;
  persianDigits?: boolean;
  timeZone?: string;
}

/**
 * نمایش زمان نسبی به فارسی طبیعی (هم‌اکنون، ۵ دقیقه پیش، ۲ ساعت پیش، ...).
 */
export function formatRelativeTime(
  input: Date | string | number | null | undefined,
  options: RelativeTimeOptions = {},
): string {
  const date = parseDateInput(input);
  if (!date) return '';
  const {
    now = Date.now(),
    persianDigits = true,
    timeZone = DEFAULT_PERSIAN_TIME_ZONE,
  } = options;
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diffSeconds = Math.round((date.getTime() - nowMs) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  const formatOut = (text: string) => (persianDigits ? toPersianDigits(text) : toEnglishDigits(text));

  if (absSeconds < 45) return 'هم‌اکنون';

  const isFuture = diffSeconds > 0;
  const wrap = (amount: number, unit: string) =>
    formatOut(isFuture ? `${amount} ${unit} دیگر` : `${amount} ${unit} پیش`);

  const minutes = Math.round(absSeconds / 60);
  if (minutes < 60) return wrap(minutes, 'دقیقه');

  const hours = Math.round(absSeconds / 3600);
  if (hours < 24) return wrap(hours, 'ساعت');

  const days = Math.round(absSeconds / 86400);
  if (days < 30) return wrap(days, 'روز');

  const months = Math.round(days / 30);
  if (months < 12) return wrap(months, 'ماه');

  return formatJalaliDate(date, { timeZone, style: 'medium', persianDigits });
}
