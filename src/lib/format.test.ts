import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSIAN_TIME_ZONE,
  formatJalaliDate,
  formatJalaliDateTime,
  formatRelativeTime,
  formatRial,
  formatToman,
  rialToToman,
  toEnglishDigits,
  toPersianDigits,
  tomanToRial,
} from './format';

describe('Persian and English digit conversion', () => {
  it('converts ASCII digits to Persian digits while preserving non-digits', () => {
    expect(toPersianDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
    expect(toPersianDigits('Order #1042 - 250,000')).toBe('Order #۱۰۴۲ - ۲۵۰,۰۰۰');
    expect(toPersianDigits(98765)).toBe('۹۸۷۶۵');
  });

  it('converts Persian and Arabic-Indic digits back to English digits', () => {
    expect(toEnglishDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toEnglishDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toEnglishDigits('شماره ۹۱۲۳۴۵۶۷۸۹')).toBe('شماره 9123456789');
  });
});

describe('Toman and Rial integer formatting', () => {
  it('formats integer Toman amounts with Persian digits and grouping', () => {
    expect(formatToman(0)).toBe('۰ تومان');
    expect(formatToman(125000)).toBe('۱۲۵٬۰۰۰ تومان');
    expect(formatToman(1500000)).toBe('۱٬۵۰۰٬۰۰۰ تومان');
    expect(formatToman(-5000)).toBe('−۵٬۰۰۰ تومان');
  });

  it('supports Latin digits and omitting unit', () => {
    expect(formatToman(45000, { persianDigits: false })).toBe('45٬000 تومان');
    expect(formatToman(45000, { includeUnit: false })).toBe('۴۵٬۰۰۰');
  });

  it('converts cleanly between Rial and Toman using integer arithmetic', () => {
    expect(rialToToman(1_250_000)).toBe(125_000);
    expect(tomanToRial(125_000)).toBe(1_250_000);
    expect(formatToman(1_250_000, { fromRial: true })).toBe('۱۲۵٬۰۰۰ تومان');
    expect(formatRial(1_250_000)).toBe('۱٬۲۵۰٬۰۰۰ ریال');
  });

  it('rejects non-finite amounts', () => {
    expect(() => formatToman(Number.NaN)).toThrow();
    expect(() => formatRial(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('Jalali date formatting', () => {
  it('defaults to Asia/Tehran timezone', () => {
    expect(DEFAULT_PERSIAN_TIME_ZONE).toBe('Asia/Tehran');
  });

  it('returns empty string for null, undefined, or invalid dates', () => {
    expect(formatJalaliDate(null)).toBe('');
    expect(formatJalaliDate(undefined)).toBe('');
    expect(formatJalaliDate('')).toBe('');
    expect(formatJalaliDate('not-a-date')).toBe('');
  });

  it('formats UTC SQLite timestamps into Tehran Jalali dates', () => {
    // 2026-03-21 00:00:00Z is 1405/01/01 03:30 in Asia/Tehran (+03:30)
    const nowruzShort = formatJalaliDate('2026-03-21 00:00:00', { style: 'short' });
    expect(nowruzShort).toBe('۱۴۰۵/۰۱/۰۱');

    // 2026-03-20 21:00:00Z is already 2026-03-21 00:30 in Tehran -> 1405/01/01
    const boundaryTehran = formatJalaliDate('2026-03-20 21:00:00', { style: 'short' });
    expect(boundaryTehran).toBe('۱۴۰۵/۰۱/۰۱');
  });

  it('formats Jalali date and time with Tehran offset', () => {
    const dt = formatJalaliDateTime('2026-03-21T00:15:00Z');
    expect(dt).toContain('۱۴۰۵');
    expect(dt).toContain('۰۳:۴۵');
  });

  it('formats relative time in natural Persian', () => {
    const base = Date.UTC(2026, 2, 21, 12, 0, 0);
    expect(formatRelativeTime(base - 10_000, { now: base })).toBe('هم‌اکنون');
    expect(formatRelativeTime(base - 5 * 60_000, { now: base })).toBe('۵ دقیقه پیش');
    expect(formatRelativeTime(base - 3 * 3600_000, { now: base })).toBe('۳ ساعت پیش');
    expect(formatRelativeTime(base + 2 * 86400_000, { now: base })).toBe('۲ روز دیگر');
  });
});
