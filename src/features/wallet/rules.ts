import { assertValidIntegerAmount, parsePersianIntegerInput } from '../currency/iran';

export const WALLET_TX_TYPES = [
  'TOPUP_GATEWAY',
  'TOPUP_BANK',
  'ORDER_DEBIT',
  'REFUND_CREDIT',
  'ADMIN_CREDIT',
  'ADMIN_DEBIT',
] as const;

export type WalletTxType = (typeof WALLET_TX_TYPES)[number];

export const DEFAULT_WALLET_MIN_TOPUP = 10_000;
export const DEFAULT_WALLET_MAX_TOPUP = 50_000_000;

export function isWalletTxType(value: unknown): value is WalletTxType {
  return typeof value === 'string' && (WALLET_TX_TYPES as readonly string[]).includes(value);
}

export function isDebitTxType(type: WalletTxType): boolean {
  return type === 'ORDER_DEBIT' || type === 'ADMIN_DEBIT';
}

export function isCreditTxType(type: WalletTxType): boolean {
  return !isDebitTxType(type);
}

export function signedWalletDelta(type: WalletTxType, positiveAmount: number): number {
  const amt = assertValidIntegerAmount(positiveAmount, { min: 1, label: 'walletAmount' });
  return isDebitTxType(type) ? -amt : amt;
}

export function validateWalletTransition(
  currentBalance: number,
  delta: number,
): { ok: true; nextBalance: number } | { ok: false; error: string } {
  if (!Number.isSafeInteger(currentBalance) || currentBalance < 0) {
    return { ok: false, error: 'موجودی فعلی کیف پول معتبر نیست.' };
  }
  if (!Number.isSafeInteger(delta) || delta === 0) {
    return { ok: false, error: 'تغییر مبلغ تراکنش باید عدد صحیح غیرصفر باشد.' };
  }
  const nextBalance = currentBalance + delta;
  if (!Number.isSafeInteger(nextBalance) || nextBalance < 0) {
    return { ok: false, error: 'موجودی کیف پول کافی نیست.' };
  }
  return { ok: true, nextBalance };
}

export function validateTopupAmount(
  rawAmount: unknown,
  min = DEFAULT_WALLET_MIN_TOPUP,
  max = DEFAULT_WALLET_MAX_TOPUP,
): { ok: true; amount: number } | { ok: false; error: string } {
  const amount = parsePersianIntegerInput(rawAmount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: 'لطفاً مبلغ شارژ را به‌صورت عدد صحیح وارد کنید.' };
  }
  if (amount < min) {
    return { ok: false, error: `حداقل مبلغ شارژ ${min.toLocaleString('en-US')} است.` };
  }
  if (amount > max) {
    return { ok: false, error: `حداکثر مبلغ شارژ ${max.toLocaleString('en-US')} است.` };
  }
  return { ok: true, amount };
}

export function validateAdminAdjustmentInput(
  type: unknown,
  rawAmount: unknown,
  rawReason: unknown,
):
  | { ok: true; type: 'ADMIN_CREDIT' | 'ADMIN_DEBIT'; amount: number; reason: string }
  | { ok: false; error: string } {
  if (type !== 'ADMIN_CREDIT' && type !== 'ADMIN_DEBIT') {
    return { ok: false, error: 'نوع عملیات کیف پول معتبر نیست.' };
  }
  const amount = parsePersianIntegerInput(rawAmount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: 'مبلغ باید عدد صحیح مثبت باشد.' };
  }
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (reason.length < 3 || reason.length > 300) {
    return { ok: false, error: 'درج توضیح (حداقل ۳ کاراکتر) برای تعدیل دستی کیف پول الزامی است.' };
  }
  return { ok: true, type, amount, reason };
}

export const WALLET_TX_LABELS: Record<WalletTxType, string> = {
  TOPUP_GATEWAY: 'شارژ آنلاین کیف پول',
  TOPUP_BANK: 'شارژ کارت‌به‌کارت',
  ORDER_DEBIT: 'پرداخت سفارش از کیف پول',
  REFUND_CREDIT: 'بازگشت وجه به کیف پول',
  ADMIN_CREDIT: 'افزایش اعتبار توسط مدیر',
  ADMIN_DEBIT: 'کسر اعتبار توسط مدیر',
};
