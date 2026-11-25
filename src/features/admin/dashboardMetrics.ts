import { toPersianDigits } from '../../lib/format.ts';

export type DashboardTimeframe = 'today' | '7d' | '30d' | '90d';
export type ChartGranularity = 'daily' | 'weekly' | 'monthly';

export function normalizeTimeframe(raw: string | null | undefined): DashboardTimeframe {
  if (raw === 'today' || raw === '7d' || raw === '30d' || raw === '90d') return raw;
  return '30d';
}

export const parseTimeframe = normalizeTimeframe;

export function normalizeGranularity(raw: string | null | undefined): ChartGranularity {
  if (raw === 'daily' || raw === 'weekly' || raw === 'monthly') return raw;
  return 'daily';
}

export const parseGranularity = normalizeGranularity;

export function timeframeLabel(tf: DashboardTimeframe): string {
  switch (tf) {
    case 'today':
      return 'امروز';
    case '7d':
      return '۷ روز گذشته';
    case '30d':
      return '۳۰ روز گذشته';
    case '90d':
      return '۹۰ روز گذشته';
  }
}

export function timeframeDays(tf: DashboardTimeframe): number {
  switch (tf) {
    case 'today':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
  }
}

export function formatJalaliShortLabel(isoDay: string, granularity: ChartGranularity): string {
  const date = new Date(`${isoDay}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDay;
  try {
    if (granularity === 'monthly') {
      return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        month: 'short',
        year: '2-digit',
        timeZone: 'Asia/Tehran',
      }).format(date);
    }
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      month: 'numeric',
      day: 'numeric',
      timeZone: 'Asia/Tehran',
    }).format(date);
  } catch {
    return toPersianDigits(isoDay);
  }
}

export interface DailySeriesRow {
  day: string;
  orders: number;
  gross_cents: number;
  refunded_cents: number;
  net_cents: number;
}

export interface ChartBucketPoint {
  key: string;
  label: string;
  orders: number;
  grossAmount: number;
  refundedAmount: number;
  netAmount: number;
}

/**
 * تجمیع سری روزانه سفارش‌های تسویه‌شده در بازه‌های روزانه، هفتگی یا ماهانه شمسی.
 * ماژول خالص برای تست واحد دقیق بدون نیاز به D1.
 */
export function aggregateRevenueSeries(
  rows: readonly DailySeriesRow[],
  granularity: ChartGranularity,
): ChartBucketPoint[] {
  if (rows.length === 0) return [];
  if (granularity === 'daily') {
    return rows.map((r) => ({
      key: r.day,
      label: formatJalaliShortLabel(r.day, 'daily'),
      orders: r.orders,
      grossAmount: r.gross_cents,
      refundedAmount: r.refunded_cents,
      netAmount: Math.max(0, r.net_cents),
    }));
  }

  if (granularity === 'weekly') {
    const buckets: ChartBucketPoint[] = [];
    for (let i = 0; i < rows.length; i += 7) {
      const slice = rows.slice(i, i + 7);
      const first = slice[0]!;
      const last = slice[slice.length - 1]!;
      buckets.push({
        key: `${first.day}..${last.day}`,
        label:
          slice.length === 1
            ? formatJalaliShortLabel(first.day, 'daily')
            : `${formatJalaliShortLabel(first.day, 'daily')}–${formatJalaliShortLabel(last.day, 'daily')}`,
        orders: slice.reduce((acc, r) => acc + r.orders, 0),
        grossAmount: slice.reduce((acc, r) => acc + r.gross_cents, 0),
        refundedAmount: slice.reduce((acc, r) => acc + r.refunded_cents, 0),
        netAmount: Math.max(
          0,
          slice.reduce((acc, r) => acc + r.net_cents, 0),
        ),
      });
    }
    return buckets;
  }

  // monthly (گروه‌بندی بر اساس ماه شمسی)
  const monthFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
    year: 'numeric',
    month: 'short',
    timeZone: 'Asia/Tehran',
  });
  const byMonth = new Map<string, ChartBucketPoint>();
  for (const r of rows) {
    const d = new Date(`${r.day}T12:00:00Z`);
    const label = Number.isNaN(d.getTime()) ? r.day.slice(0, 7) : monthFmt.format(d);
    const existing = byMonth.get(label);
    if (existing) {
      existing.orders += r.orders;
      existing.grossAmount += r.gross_cents;
      existing.refundedAmount += r.refunded_cents;
      existing.netAmount = Math.max(0, existing.netAmount + r.net_cents);
    } else {
      byMonth.set(label, {
        key: r.day.slice(0, 7),
        label,
        orders: r.orders,
        grossAmount: r.gross_cents,
        refundedAmount: r.refunded_cents,
        netAmount: Math.max(0, r.net_cents),
      });
    }
  }
  return [...byMonth.values()];
}

export function averageOrderValue(netRevenue: number, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return Math.round(netRevenue / orderCount);
}
