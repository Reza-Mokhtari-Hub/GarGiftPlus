import { toEnglishDigits, tomanToRial, rialToToman } from '../../lib/format';

/**
 * قوانین پولی تمام‌صحیح برای تومان (IRT) و ریال (IRR).
 * خالص و بدون وابستگی به Cloudflare Runtime تا در تست‌های واحد و سمت سرور مشترک باشد.
 */

export type IranCurrency = 'irt' | 'irr';
export const DEFAULT_IRAN_CURRENCY: IranCurrency = 'irt';

export function isIranCurrency(currency: string): currency is IranCurrency {
  const c = currency.trim().toLowerCase();
  return c === 'irt' || c === 'irr';
}

export function normalizeCurrencyCode(currency: string | null | undefined, fallback = 'irt'): string {
  const trimmed = typeof currency === 'string' ? currency.trim().toLowerCase() : '';
  return /^[a-z]{3}$/.test(trimmed) ? trimmed : fallback;
}

/**
 * اعتبارسنجی دقیق مبلغ به صورت عدد صحیح (بدون اعشار و اعداد شناور).
 */
export function assertValidIntegerAmount(
  value: unknown,
  opts: { min?: number; max?: number; label?: string } = {},
): number {
  const label = opts.label ?? 'amount';
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new RangeError(`${label} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new RangeError(`${label} must be <= ${opts.max}`);
  }
  return value;
}

/**
 * تبدیل ورودی کاربر (با ارقام فارسی/عربی/لاتین و جداکننده هزارگان) به عدد صحیح غیرمنفی.
 * در صورت وجود اعشار، کاراکتر نامعتبر یا سرریز، null برمی‌گرداند.
 */
export function parsePersianIntegerInput(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const cleaned = toEnglishDigits(raw)
    .replace(/[,٬_\s\u200c]+/g, '')
    .trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isSafeInteger(num) ? num : null;
}

export function calcLineTotal(unitAmount: number, quantity: number): number {
  const unit = assertValidIntegerAmount(unitAmount, { min: 0, label: 'unitAmount' });
  const qty = assertValidIntegerAmount(quantity, { min: 1, max: 100_000, label: 'quantity' });
  const total = unit * qty;
  if (!Number.isSafeInteger(total)) {
    throw new RangeError('Line total exceeds safe integer range');
  }
  return total;
}

export interface OrderTotalResult {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export function calcOrderTotals(
  lines: ReadonlyArray<{ unitAmount: number; quantity: number }>,
  discount = 0,
  shipping = 0,
): OrderTotalResult {
  const subtotal = lines.reduce(
    (sum, line) => sum + calcLineTotal(line.unitAmount, line.quantity),
    0,
  );
  const safeDiscount = assertValidIntegerAmount(discount, { min: 0, label: 'discount' });
  const safeShipping = assertValidIntegerAmount(shipping, { min: 0, label: 'shipping' });
  const effectiveDiscount = Math.min(safeDiscount, subtotal);
  const total = subtotal - effectiveDiscount + safeShipping;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('Order total is invalid');
  }
  return {
    subtotal,
    discount: effectiveDiscount,
    shipping: safeShipping,
    total,
  };
}

/**
 * تبدیل مبلغ فروشگاه (تومان یا ریال) به ریال تمام‌صحیح برای ارسال به درگاه‌هایی که فقط ریال می‌پذیرند (مثل زیبال).
 */
export function resolveGatewayRialAmount(amount: number, currency: string): number {
  const safeAmount = assertValidIntegerAmount(amount, { min: 1, label: 'amount' });
  const c = normalizeCurrencyCode(currency, '');
  if (c === 'irt') return tomanToRial(safeAmount);
  if (c === 'irr') return safeAmount;
  throw new Error(`Unsupported Iranian gateway currency: ${currency}`);
}

export { tomanToRial, rialToToman };
