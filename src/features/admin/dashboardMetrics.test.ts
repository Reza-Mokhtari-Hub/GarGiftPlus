import { describe, it, expect } from 'vitest';
import {
  normalizeTimeframe,
  normalizeGranularity,
  parseTimeframe,
  parseGranularity,
  timeframeLabel,
  timeframeDays,
  formatJalaliShortLabel,
  aggregateRevenueSeries,
  averageOrderValue,
  type DailySeriesRow,
} from './dashboardMetrics';

describe('dashboardMetrics', () => {
  it('normalizes supported timeframes and falls back to 30d', () => {
    expect(normalizeTimeframe('today')).toBe('today');
    expect(parseTimeframe('7d')).toBe('7d');
    expect(normalizeTimeframe('30d')).toBe('30d');
    expect(normalizeTimeframe('90d')).toBe('90d');
    expect(normalizeTimeframe('365d')).toBe('30d');
    expect(normalizeTimeframe(null)).toBe('30d');
    expect(timeframeLabel('today')).toBe('امروز');
    expect(timeframeLabel('30d')).toBe('۳۰ روز گذشته');
  });

  it('normalizes chart granularity and timeframe days', () => {
    expect(normalizeGranularity('daily')).toBe('daily');
    expect(parseGranularity('weekly')).toBe('weekly');
    expect(normalizeGranularity('monthly')).toBe('monthly');
    expect(normalizeGranularity('hourly')).toBe('daily');

    expect(timeframeDays('today')).toBe(1);
    expect(timeframeDays('7d')).toBe(7);
    expect(timeframeDays('30d')).toBe(30);
    expect(timeframeDays('90d')).toBe(90);
  });

  it('formats Jalali short date labels without throwing on bad inputs', () => {
    const label = formatJalaliShortLabel('2026-03-21', 'daily');
    expect(label.length).toBeGreaterThan(0);
    expect(formatJalaliShortLabel('not-a-date', 'daily')).toBe('not-a-date');
  });

  it('aggregates daily rows into daily, weekly, and monthly buckets with non-negative net revenue', () => {
    const rows: DailySeriesRow[] = [
      { day: '2026-03-01', orders: 2, gross_cents: 500000, refunded_cents: 100000, net_cents: 400000 },
      { day: '2026-03-02', orders: 1, gross_cents: 100000, refunded_cents: 200000, net_cents: -100000 },
      { day: '2026-03-03', orders: 3, gross_cents: 900000, refunded_cents: 0, net_cents: 900000 },
    ];

    const daily = aggregateRevenueSeries(rows, 'daily');
    expect(daily).toHaveLength(3);
    expect(daily[1]!.netAmount).toBe(0);
    expect(daily[2]!.orders).toBe(3);

    const weekly = aggregateRevenueSeries(rows, 'weekly');
    expect(weekly).toHaveLength(1);
    expect(weekly[0]!.orders).toBe(6);
    expect(weekly[0]!.grossAmount).toBe(1500000);
    expect(weekly[0]!.refundedAmount).toBe(300000);
    expect(weekly[0]!.netAmount).toBe(1200000);

    const monthly = aggregateRevenueSeries(rows, 'monthly');
    expect(monthly.length).toBeGreaterThanOrEqual(1);
    const totalOrders = monthly.reduce((acc, b) => acc + b.orders, 0);
    expect(totalOrders).toBe(6);
  });

  it('calculates average order value safely for zero and positive counts', () => {
    expect(averageOrderValue(0, 0)).toBe(0);
    expect(averageOrderValue(500000, -1)).toBe(0);
    expect(averageOrderValue(1000000, 3)).toBe(333333);
  });
});
