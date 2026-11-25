export const PAYMENT_TX_STATUSES = [
  'CREATED',
  'INITIATED',
  'PAYMENT_REVIEW',
  'VERIFIED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
] as const;

export type PaymentTxStatus = (typeof PAYMENT_TX_STATUSES)[number];

export type PaymentTxTargetType = 'order' | 'wallet_topup';

const ALLOWED_TRANSITIONS: Record<PaymentTxStatus, ReadonlyArray<PaymentTxStatus>> = {
  CREATED: ['INITIATED', 'PAYMENT_REVIEW', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  INITIATED: ['PAYMENT_REVIEW', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  PAYMENT_REVIEW: ['VERIFIED', 'FAILED', 'CANCELLED'],
  FAILED: ['PAYMENT_REVIEW', 'CANCELLED'],
  VERIFIED: [], // Terminal — never allow double verification or reversal inside payment_transactions
  EXPIRED: [],
  CANCELLED: [],
};

export function isPaymentTxStatus(value: unknown): value is PaymentTxStatus {
  return (
    typeof value === 'string' && (PAYMENT_TX_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransitionPaymentTx(from: PaymentTxStatus, to: PaymentTxStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminalPaymentTxStatus(status: PaymentTxStatus): boolean {
  return status === 'VERIFIED' || status === 'EXPIRED' || status === 'CANCELLED';
}

export function verifyTransactionMatch(
  expected: { amount: number; currency: string; status: PaymentTxStatus },
  actual: { amount: number; currency: string },
):
  | { ok: true }
  | { ok: false; reason: 'already_verified' | 'terminal_status' | 'amount_mismatch' | 'currency_mismatch' } {
  if (expected.status === 'VERIFIED') {
    return { ok: false, reason: 'already_verified' };
  }
  if (expected.status === 'EXPIRED' || expected.status === 'CANCELLED') {
    return { ok: false, reason: 'terminal_status' };
  }
  if (expected.currency.trim().toLowerCase() !== actual.currency.trim().toLowerCase()) {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (expected.amount !== actual.amount) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  return { ok: true };
}

export const PAYMENT_TX_STATUS_LABELS: Record<PaymentTxStatus, string> = {
  CREATED: 'ایجادشده',
  INITIATED: 'در حال انتقال به درگاه',
  PAYMENT_REVIEW: 'در انتظار بررسی و تایید فیش',
  VERIFIED: 'تایید و پرداخت‌شده',
  FAILED: 'ناموفق / ردشده',
  EXPIRED: 'منقضی‌شده',
  CANCELLED: 'لغوشده',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  zarinpal: 'درگاه زرین‌پال',
  zibal: 'درگاه زیبال',
  bank_transfer: 'کارت‌به‌کارت / واریز بانکی',
  wallet: 'کیف پول گارگیفت+',
  stripe: 'Stripe',
  lightning: 'Lightning',
  opennode: 'OpenNode',
  demo: 'آزمایشی (Demo)',
};

