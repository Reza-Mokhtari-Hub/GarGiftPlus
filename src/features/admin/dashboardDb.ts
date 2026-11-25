import type { D1Database } from '@cloudflare/workers-types';
import {
  aggregateRevenueSeries,
  averageOrderValue,
  timeframeDays,
  type ChartBucketPoint,
  type ChartGranularity,
  type DailySeriesRow,
  type DashboardTimeframe,
} from './dashboardMetrics';
import type { Order } from '../orders/db';
import type { AdminAuditLog } from '../audit/db';

export interface DashboardKpis {
  grossRevenue: number;
  refundedTotal: number;
  netRevenue: number;
  paidOrdersCount: number;
  averageOrderValue: number;
  unfulfilledCount: number;
  inProgressCount: number;
  pendingReceiptsCount: number;
  openTicketsCount: number;
  failedEmailsCount: number;
  inventoryExceptionsCount: number;
  activeProductsCount: number;
  totalProductsCount: number;
  totalCustomersCount: number;
  activeCustomersCount: number;
  totalWalletLiability: number;
}

export interface TopSellingProductRow {
  product_id: number | null;
  product_public_id: string | null;
  name: string;
  units_sold: number;
  order_count: number;
  revenue_total: number;
}

export interface PaymentMethodMixRow {
  method: string;
  orders: number;
  net_revenue: number;
}

export interface RecentEmailFailure {
  order_id: number;
  order_public_id: string | null;
  kind: string;
  state: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface TopbarAlertsSummary {
  pendingReceipts: number;
  pendingFulfillment: number;
  failedEmails: number;
  openTickets: number;
  inventoryExceptions: number;
  totalAttention: number;
}

/**
 * شمارش سریع اعلان‌های عملیاتی برای زنگوله بالای پنل مدیریت.
 * در صورت نبودن جدول‌های تازه روی دیتابیس قدیمی بدون خطا صفر برمی‌گرداند.
 */
export async function getTopbarAlertsSummary(db: D1Database): Promise<TopbarAlertsSummary> {
  const safeCount = async (sql: string): Promise<number> => {
    try {
      const row = await db.prepare(sql).first<{ n: number }>();
      return row?.n ?? 0;
    } catch {
      return 0;
    }
  };

  const [pendingReceipts, pendingFulfillment, failedEmails, openTickets, inventoryExceptions] =
    await Promise.all([
      safeCount(`SELECT COUNT(*) AS n FROM bank_transfer_receipts WHERE status = 'pending_review'`),
      safeCount(`SELECT COUNT(*) AS n FROM orders WHERE status = 'paid' AND fulfillment_status != 'fulfilled'`),
      safeCount(`SELECT COUNT(*) AS n FROM order_notifications WHERE state = 'dead'`),
      safeCount(`SELECT COUNT(*) AS n FROM support_tickets WHERE status IN ('open', 'in_progress')`),
      safeCount(`SELECT COUNT(*) AS n FROM order_inventory_exceptions WHERE resolved_at IS NULL`),
    ]);

  return {
    pendingReceipts,
    pendingFulfillment,
    failedEmails,
    openTickets,
    inventoryExceptions,
    totalAttention:
      pendingReceipts + pendingFulfillment + failedEmails + openTickets + inventoryExceptions,
  };
}

/**
 * استخراج آمار جامع و واقعی داشبورد GarGift+:
 * - درآمد ناخالص و خالص فقط از سفارش‌های تسویه‌شده (`status IN ('paid', 'refunded')`) محاسبه می‌شود.
 * - فیش‌های بانکی در انتظار تایید یا شارژهای در انتظار هیچ‌گاه به عنوان فروش محاسبه نمی‌شوند.
 * - بازگشت وجه (`refunded_cents`) از درآمد ناخالص کسر می‌شود.
 */
export async function loadDashboardOverview(
  db: D1Database,
  options: {
    timeframe: DashboardTimeframe;
    granularity: ChartGranularity;
  },
): Promise<{
  kpis: DashboardKpis;
  series: ChartBucketPoint[];
  topProducts: TopSellingProductRow[];
  paymentMix: PaymentMethodMixRow[];
  recentOrders: Order[];
  recentAudits: AdminAuditLog[];
  recentEmailFailures: RecentEmailFailure[];
}> {
  const days = timeframeDays(options.timeframe);
  const sinceArg = options.timeframe === 'today' ? '0 days' : `-${days - 1} days`;
  const chartDays = options.granularity === 'monthly' ? Math.max(days, 180) : days;
  const chartSinceArg = chartDays === 1 ? '0 days' : `-${chartDays - 1} days`;

  const [
    orderAgg,
    fulfillAgg,
    productAgg,
    customerAgg,
    walletAgg,
    alerts,
    seriesRows,
    topProductsRes,
    paymentMixRes,
    recentOrdersRes,
    recentAuditsRes,
    emailFailuresRes,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS cnt,
                COALESCE(SUM(amount_total_cents), 0) AS gross,
                COALESCE(SUM(refunded_cents), 0) AS refunded,
                COALESCE(SUM(amount_total_cents - refunded_cents), 0) AS net
           FROM orders
          WHERE status IN ('paid', 'refunded')
            AND date(created_at) >= date('now', ?)`,
      )
      .bind(sinceArg)
      .first<{ cnt: number; gross: number; refunded: number; net: number }>(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'paid' AND fulfillment_status != 'fulfilled' AND processing_started_at IS NULL THEN 1 ELSE 0 END) AS unfulfilled_n,
           SUM(CASE WHEN status = 'paid' AND fulfillment_status != 'fulfilled' AND processing_started_at IS NOT NULL THEN 1 ELSE 0 END) AS in_progress_n
         FROM orders`,
      )
      .first<{ unfulfilled_n: number | null; in_progress_n: number | null }>()
      .catch(() => ({ unfulfilled_n: 0, in_progress_n: 0 })),
    db
      .prepare(
        `SELECT COUNT(*) AS total_n,
                SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_n
           FROM products`,
      )
      .first<{ total_n: number; active_n: number | null }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total_n,
                SUM(CASE WHEN COALESCE(status, 'active') = 'active' THEN 1 ELSE 0 END) AS active_n
           FROM customers`,
      )
      .first<{ total_n: number; active_n: number | null }>()
      .catch(async () => {
        const fallback = await db.prepare('SELECT COUNT(*) AS total_n FROM customers').first<{ total_n: number }>();
        return { total_n: fallback?.total_n ?? 0, active_n: fallback?.total_n ?? 0 };
      }),
    db
      .prepare(`SELECT COALESCE(SUM(balance), 0) AS total_balance FROM wallets`)
      .first<{ total_balance: number }>()
      .catch(() => ({ total_balance: 0 })),
    getTopbarAlertsSummary(db),
    db
      .prepare(
        `SELECT date(created_at) AS day,
                COUNT(*) AS orders,
                COALESCE(SUM(amount_total_cents), 0) AS gross_cents,
                COALESCE(SUM(refunded_cents), 0) AS refunded_cents,
                COALESCE(SUM(amount_total_cents - refunded_cents), 0) AS net_cents
           FROM orders
          WHERE status IN ('paid', 'refunded')
            AND date(created_at) >= date('now', ?)
          GROUP BY day
          ORDER BY day ASC`,
      )
      .bind(chartSinceArg)
      .all<DailySeriesRow>(),
    db
      .prepare(
        `SELECT oi.product_id,
                p.public_id AS product_public_id,
                oi.name,
                COALESCE(SUM(oi.quantity), 0) AS units_sold,
                COUNT(DISTINCT oi.order_id) AS order_count,
                COALESCE(SUM(oi.price_cents * oi.quantity), 0) AS revenue_total
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           LEFT JOIN products p ON p.id = oi.product_id
          WHERE o.status IN ('paid', 'refunded')
            AND o.refunded_cents < o.amount_total_cents
            AND date(o.created_at) >= date('now', ?)
          GROUP BY COALESCE(oi.product_id, oi.name), oi.name, p.public_id
          ORDER BY units_sold DESC, revenue_total DESC
          LIMIT 6`,
      )
      .bind(sinceArg)
      .all<TopSellingProductRow>(),
    db
      .prepare(
        `SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'unknown') AS method,
                COUNT(*) AS orders,
                COALESCE(SUM(amount_total_cents - refunded_cents), 0) AS net_revenue
           FROM orders
          WHERE status IN ('paid', 'refunded')
            AND date(created_at) >= date('now', ?)
          GROUP BY method
          ORDER BY net_revenue DESC`,
      )
      .bind(sinceArg)
      .all<PaymentMethodMixRow>(),
    db
      .prepare(`SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 8`)
      .all<Order>(),
    db
      .prepare(`SELECT * FROM admin_audit_logs ORDER BY created_at DESC, id DESC LIMIT 10`)
      .all<AdminAuditLog>()
      .catch(() => ({ results: [] as AdminAuditLog[] })),
    db
      .prepare(
        `SELECT n.order_id, o.public_id AS order_public_id, n.kind, n.state, n.attempts, n.last_error, n.created_at
           FROM order_notifications n
           LEFT JOIN orders o ON o.id = n.order_id
          WHERE n.state IN ('dead', 'pending') AND n.last_error IS NOT NULL
          ORDER BY n.created_at DESC
          LIMIT 6`,
      )
      .all<RecentEmailFailure>()
      .catch(() => ({ results: [] as RecentEmailFailure[] })),
  ]);

  const gross = orderAgg?.gross ?? 0;
  const refunded = orderAgg?.refunded ?? 0;
  const net = orderAgg?.net ?? 0;
  const paidOrdersCount = orderAgg?.cnt ?? 0;

  // پر کردن روزهای بدون فروش برای رسم پیوسته نمودار در حالت روزانه
  const rowMap = new Map((seriesRows.results ?? []).map((r) => [r.day, r]));
  const filledDaily: DailySeriesRow[] = [];
  const now = Date.now();
  for (let i = chartDays - 1; i >= 0; i--) {
    const day = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const existing = rowMap.get(day);
    filledDaily.push(
      existing ?? {
        day,
        orders: 0,
        gross_cents: 0,
        refunded_cents: 0,
        net_cents: 0,
      },
    );
  }

  return {
    kpis: {
      grossRevenue: gross,
      refundedTotal: refunded,
      netRevenue: net,
      paidOrdersCount,
      averageOrderValue: averageOrderValue(net, paidOrdersCount),
      unfulfilledCount: fulfillAgg?.unfulfilled_n ?? 0,
      inProgressCount: fulfillAgg?.in_progress_n ?? 0,
      pendingReceiptsCount: alerts.pendingReceipts,
      openTicketsCount: alerts.openTickets,
      failedEmailsCount: alerts.failedEmails,
      inventoryExceptionsCount: alerts.inventoryExceptions,
      activeProductsCount: productAgg?.active_n ?? 0,
      totalProductsCount: productAgg?.total_n ?? 0,
      totalCustomersCount: customerAgg?.total_n ?? 0,
      activeCustomersCount: customerAgg?.active_n ?? 0,
      totalWalletLiability: walletAgg?.total_balance ?? 0,
    },
    series: aggregateRevenueSeries(filledDaily, options.granularity),
    topProducts: topProductsRes.results ?? [],
    paymentMix: paymentMixRes.results ?? [],
    recentOrders: recentOrdersRes.results ?? [],
    recentAudits: recentAuditsRes.results ?? [],
    recentEmailFailures: emailFailuresRes.results ?? [],
  };
}
