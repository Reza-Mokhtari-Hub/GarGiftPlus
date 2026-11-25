import type { D1Database } from '@cloudflare/workers-types';

export interface SalesSummaryReport {
  totalOrders: number;
  grossSales: number;
  refundedAmount: number;
  netSales: number;
  averageOrderValue: number;
  fulfilledOrders: number;
  unfulfilledOrders: number;
}

export interface CategorySalesRow {
  category_name: string;
  category_slug: string | null;
  units_sold: number;
  revenue_total: number;
}

export interface WalletFlowSummary {
  totalWallets: number;
  circulatingBalance: number;
  totalTopupsCompleted: number;
  totalOrderDebits: number;
  totalRefundCredits: number;
  totalAdminCredits: number;
  totalAdminDebits: number;
}

export interface OperationalSlaSummary {
  pendingReceipts: number;
  approvedReceipts: number;
  rejectedReceipts: number;
  avgFulfillmentMinutes: number | null;
  avgReceiptReviewMinutes: number | null;
}

export async function generateAdminReports(
  db: D1Database,
  dateFrom: string | null,
  dateTo: string | null,
): Promise<{
  summary: SalesSummaryReport;
  byMethod: Array<{ method: string; orders: number; gross: number; refunded: number; net: number }>;
  topProducts: Array<{ name: string; units: number; orders: number; revenue: number }>;
  byCategory: CategorySalesRow[];
  walletSummary: WalletFlowSummary;
  sla: OperationalSlaSummary;
}> {
  const dateClauses: string[] = [`o.status IN ('paid', 'refunded')`];
  const dateParams: string[] = [];
  if (dateFrom) {
    dateClauses.push('date(o.created_at) >= date(?)');
    dateParams.push(dateFrom);
  }
  if (dateTo) {
    dateClauses.push('date(o.created_at) <= date(?)');
    dateParams.push(dateTo);
  }
  const orderWhere = `WHERE ${dateClauses.join(' AND ')}`;

  const walletDateClauses: string[] = [];
  const walletParams: string[] = [];
  if (dateFrom) {
    walletDateClauses.push('date(created_at) >= date(?)');
    walletParams.push(dateFrom);
  }
  if (dateTo) {
    walletDateClauses.push('date(created_at) <= date(?)');
    walletParams.push(dateTo);
  }
  const walletWhere = walletDateClauses.length > 0 ? `WHERE ${walletDateClauses.join(' AND ')}` : '';

  const [summaryRow, methodRes, topProductsRes, categoryRes, walletBalRow, walletFlowRes, receiptSlaRow, fulfillSlaRow] =
    await Promise.all([
      db
        .prepare(
          `SELECT COUNT(*) AS total_orders,
                  COALESCE(SUM(o.amount_total_cents), 0) AS gross_sales,
                  COALESCE(SUM(o.refunded_cents), 0) AS refunded_amount,
                  COALESCE(SUM(o.amount_total_cents - o.refunded_cents), 0) AS net_sales,
                  SUM(CASE WHEN o.fulfillment_status = 'fulfilled' THEN 1 ELSE 0 END) AS fulfilled_orders,
                  SUM(CASE WHEN o.fulfillment_status != 'fulfilled' THEN 1 ELSE 0 END) AS unfulfilled_orders
             FROM orders o
             ${orderWhere}`,
        )
        .bind(...dateParams)
        .first<{
          total_orders: number;
          gross_sales: number;
          refunded_amount: number;
          net_sales: number;
          fulfilled_orders: number | null;
          unfulfilled_orders: number | null;
        }>(),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(o.payment_method), ''), 'unknown') AS method,
                  COUNT(*) AS orders,
                  COALESCE(SUM(o.amount_total_cents), 0) AS gross,
                  COALESCE(SUM(o.refunded_cents), 0) AS refunded,
                  COALESCE(SUM(o.amount_total_cents - o.refunded_cents), 0) AS net
             FROM orders o
             ${orderWhere}
            GROUP BY method
            ORDER BY net DESC`,
        )
        .bind(...dateParams)
        .all<{ method: string; orders: number; gross: number; refunded: number; net: number }>(),
      db
        .prepare(
          `SELECT oi.name,
                  COALESCE(SUM(oi.quantity), 0) AS units,
                  COUNT(DISTINCT oi.order_id) AS orders,
                  COALESCE(SUM(oi.price_cents * oi.quantity), 0) AS revenue
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             ${orderWhere} AND o.refunded_cents < o.amount_total_cents
            GROUP BY COALESCE(oi.product_id, oi.name), oi.name
            ORDER BY revenue DESC, units DESC
            LIMIT 12`,
        )
        .bind(...dateParams)
        .all<{ name: string; units: number; orders: number; revenue: number }>(),
      db
        .prepare(
          `SELECT COALESCE(c.name, 'بدون دسته‌بندی') AS category_name,
                  c.slug AS category_slug,
                  COALESCE(SUM(oi.quantity), 0) AS units_sold,
                  COALESCE(SUM(oi.price_cents * oi.quantity), 0) AS revenue_total
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             LEFT JOIN product_categories pc ON pc.product_id = oi.product_id
             LEFT JOIN categories c ON c.id = pc.category_id
             ${orderWhere} AND o.refunded_cents < o.amount_total_cents
            GROUP BY COALESCE(c.id, 0), COALESCE(c.name, 'بدون دسته‌بندی'), c.slug
            ORDER BY revenue_total DESC`,
        )
        .bind(...dateParams)
        .all<CategorySalesRow>(),
      db
        .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS bal FROM wallets`)
        .first<{ n: number; bal: number }>()
        .catch(() => ({ n: 0, bal: 0 })),
      db
        .prepare(
          `SELECT type, COALESCE(SUM(ABS(amount)), 0) AS total_abs
             FROM wallet_transactions
             ${walletWhere}
            GROUP BY type`,
        )
        .bind(...walletParams)
        .all<{ type: string; total_abs: number }>()
        .catch(() => ({ results: [] as Array<{ type: string; total_abs: number }> })),
      db
        .prepare(
          `SELECT
             SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pending_n,
             SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved_n,
             SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected_n,
             AVG(CASE WHEN reviewed_at IS NOT NULL THEN (julianday(reviewed_at) - julianday(created_at)) * 1440.0 ELSE NULL END) AS avg_min
           FROM bank_transfer_receipts`,
        )
        .first<{
          pending_n: number | null;
          approved_n: number | null;
          rejected_n: number | null;
          avg_min: number | null;
        }>()
        .catch(() => ({ pending_n: 0, approved_n: 0, rejected_n: 0, avg_min: null })),
      db
        .prepare(
          `SELECT AVG((julianday(o.fulfilled_at) - julianday(o.created_at)) * 1440.0) AS avg_min
             FROM orders o
             ${orderWhere} AND o.fulfillment_status = 'fulfilled' AND o.fulfilled_at IS NOT NULL`,
        )
        .bind(...dateParams)
        .first<{ avg_min: number | null }>(),
    ]);

  const totalOrders = summaryRow?.total_orders ?? 0;
  const netSales = summaryRow?.net_sales ?? 0;

  const flowMap = new Map((walletFlowRes.results ?? []).map((r) => [r.type, r.total_abs]));

  return {
    summary: {
      totalOrders,
      grossSales: summaryRow?.gross_sales ?? 0,
      refundedAmount: summaryRow?.refunded_amount ?? 0,
      netSales,
      averageOrderValue: totalOrders > 0 ? Math.round(netSales / totalOrders) : 0,
      fulfilledOrders: summaryRow?.fulfilled_orders ?? 0,
      unfulfilledOrders: summaryRow?.unfulfilled_orders ?? 0,
    },
    byMethod: methodRes.results ?? [],
    topProducts: topProductsRes.results ?? [],
    byCategory: categoryRes.results ?? [],
    walletSummary: {
      totalWallets: walletBalRow?.n ?? 0,
      circulatingBalance: walletBalRow?.bal ?? 0,
      totalTopupsCompleted:
        (flowMap.get('TOPUP_GATEWAY') ?? 0) + (flowMap.get('TOPUP_BANK') ?? 0),
      totalOrderDebits: flowMap.get('ORDER_DEBIT') ?? 0,
      totalRefundCredits: flowMap.get('REFUND_CREDIT') ?? 0,
      totalAdminCredits: flowMap.get('ADMIN_CREDIT') ?? 0,
      totalAdminDebits: flowMap.get('ADMIN_DEBIT') ?? 0,
    },
    sla: {
      pendingReceipts: receiptSlaRow?.pending_n ?? 0,
      approvedReceipts: receiptSlaRow?.approved_n ?? 0,
      rejectedReceipts: receiptSlaRow?.rejected_n ?? 0,
      avgFulfillmentMinutes:
        fulfillSlaRow?.avg_min != null ? Math.round(fulfillSlaRow.avg_min) : null,
      avgReceiptReviewMinutes:
        receiptSlaRow?.avg_min != null ? Math.round(receiptSlaRow.avg_min) : null,
    },
  };
}
