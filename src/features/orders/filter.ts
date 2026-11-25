// Admin order list filters.
//
// Same contract as sort.ts: the query param selects a FIXED SQL fragment from a
// whitelist and every value is bound, so nothing a caller types reaches SQL.

export type OrderFulfillmentFilter =
  | 'unfulfilled'
  | 'processing'
  | 'ready_for_delivery'
  | 'partially_fulfilled'
  | 'fulfilled'
  | 'cancelled';

export interface OrderFilters {
  status: OrderStatusFilter | null;
  fulfillment: OrderFulfillmentFilter | null;
  method: string | null;
  /** Only orders still needing refund reconciliation. */
  review: boolean;
}

export interface OrderAdvancedFilters {
  dateFrom: string | null;
  dateTo: string | null;
  minTotal: number | null;
  maxTotal: number | null;
}

export type OrderStatusFilter = 'paid' | 'partially_refunded' | 'refunded' | 'pending';

const STATUS: Record<OrderStatusFilter, string> = {
  paid: "status = 'paid' AND refunded_cents = 0",
  partially_refunded: 'refunded_cents > 0 AND refunded_cents < amount_total_cents',
  refunded: 'refunded_cents > 0 AND refunded_cents >= amount_total_cents',
  pending: "status = 'pending'",
};

export const ORDER_STATUS_OPTIONS: { value: OrderStatusFilter; label: string }[] = [
  { value: 'paid', label: 'پرداخت‌شده (Paid)' },
  { value: 'partially_refunded', label: 'بازگشت جزئی (Partial Refund)' },
  { value: 'refunded', label: 'مستردشده کامل (Refunded)' },
  { value: 'pending', label: 'در انتظار پرداخت (Pending)' },
];

export const ORDER_FULFILLMENT_OPTIONS: { value: OrderFulfillmentFilter; label: string }[] = [
  { value: 'unfulfilled', label: 'در انتظار پردازش (Unfulfilled)' },
  { value: 'processing', label: 'در حال آماده‌سازی (Processing)' },
  { value: 'ready_for_delivery', label: 'آماده تحویل (Ready)' },
  { value: 'partially_fulfilled', label: 'تحویل ناقص (Partial)' },
  { value: 'fulfilled', label: 'تحویل‌شده (Fulfilled)' },
  { value: 'cancelled', label: 'لغو شده (Cancelled)' },
];

export const ORDER_METHOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'wallet', label: 'کیف پول GarGift+ (Wallet)' },
  { value: 'bank_transfer', label: 'کارت‌به‌کارت بانکی (Bank Transfer)' },
  { value: 'zarinpal', label: 'درگاه زرین‌پال (Zarinpal)' },
  { value: 'zibal', label: 'درگاه زیبال (Zibal)' },
  { value: 'stripe', label: 'کارت بین‌المللی (Stripe)' },
  { value: 'lightning', label: 'لابتنینگ (Lightning)' },
  { value: 'opennode', label: 'بیت‌کوین (OpenNode)' },
  { value: 'demo', label: 'آزمایشی (Demo)' },
];

const isStatus = (v: string | null): v is OrderStatusFilter =>
  v !== null && Object.prototype.hasOwnProperty.call(STATUS, v);

const isFulfillment = (v: string | null): v is OrderFulfillmentFilter =>
  v !== null && ORDER_FULFILLMENT_OPTIONS.some((o) => o.value === v);

export function parseOrderFilters(params: URLSearchParams): OrderFilters {
  const status = params.get('status');
  const fulfillment = params.get('fulfillment');
  const method = params.get('method');
  return {
    status: isStatus(status) ? status : null,
    fulfillment: isFulfillment(fulfillment) ? fulfillment : null,
    method: ORDER_METHOD_OPTIONS.some((o) => o.value === method) ? method : null,
    review: params.get('review') === '1',
  };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseNonNegInt(raw: string | null): number | null {
  if (!raw || raw.trim() === '') return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

export function parseOrderAdvancedFilters(params: URLSearchParams): OrderAdvancedFilters {
  const fromRaw = (params.get('from') ?? '').trim();
  const toRaw = (params.get('to') ?? '').trim();
  return {
    dateFrom: ISO_DATE_RE.test(fromRaw) ? fromRaw : null,
    dateTo: ISO_DATE_RE.test(toRaw) ? toRaw : null,
    minTotal: parseNonNegInt(params.get('min')),
    maxTotal: parseNonNegInt(params.get('max')),
  };
}

export function hasOrderFilters(f: OrderFilters): boolean {
  return f.status !== null || f.fulfillment !== null || f.method !== null || f.review;
}

export function hasOrderAdvancedFilters(f: OrderAdvancedFilters): boolean {
  return f.dateFrom !== null || f.dateTo !== null || f.minTotal !== null || f.maxTotal !== null;
}

export function orderFilterParams(f: OrderFilters): Record<string, string | undefined> {
  return {
    status: f.status ?? undefined,
    fulfillment: f.fulfillment ?? undefined,
    method: f.method ?? undefined,
    review: f.review ? '1' : undefined,
  };
}

export function orderAdvancedFilterParams(
  f: OrderAdvancedFilters,
): Record<string, string | undefined> {
  return {
    from: f.dateFrom ?? undefined,
    to: f.dateTo ?? undefined,
    min: f.minTotal != null ? String(f.minTotal) : undefined,
    max: f.maxTotal != null ? String(f.maxTotal) : undefined,
  };
}

export function orderFilterClause(f: OrderFilters): { where: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];

  if (f.status) parts.push(`(${STATUS[f.status]})`);
  if (f.fulfillment) {
    parts.push('fulfillment_status = ?');
    params.push(f.fulfillment);
  }
  if (f.method) {
    parts.push(
      f.method === 'stripe'
        ? '(payment_method = ? OR payment_method IS NULL)'
        : 'payment_method = ?',
    );
    params.push(f.method);
  }
  if (f.review) parts.push('refund_review_reason IS NOT NULL AND refund_reviewed_at IS NULL');

  return {
    where: parts.length ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  };
}

export function combineOrderFilterClauses(
  base: OrderFilters,
  adv: OrderAdvancedFilters,
): { where: string; params: (string | number)[] } {
  const baseClause = orderFilterClause(base);
  const parts: string[] = [];
  const params: (string | number)[] = [...baseClause.params];
  if (baseClause.where) {
    parts.push(baseClause.where.replace(/^WHERE\s+/, ''));
  }
  if (adv.dateFrom) {
    parts.push('date(created_at) >= date(?)');
    params.push(adv.dateFrom);
  }
  if (adv.dateTo) {
    parts.push('date(created_at) <= date(?)');
    params.push(adv.dateTo);
  }
  if (adv.minTotal != null) {
    parts.push('amount_total_cents >= ?');
    params.push(adv.minTotal);
  }
  if (adv.maxTotal != null) {
    parts.push('amount_total_cents <= ?');
    params.push(adv.maxTotal);
  }
  return {
    where: parts.length ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  };
}
