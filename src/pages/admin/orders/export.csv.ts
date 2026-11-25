import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listOrders } from '../../../features/orders/db';
import {
  parseOrderFilters,
  parseOrderAdvancedFilters,
  combineOrderFilterClauses,
} from '../../../features/orders/filter';
import { getConfig, toMajorUnits, currencyDecimals } from '../../../config';
import { orderReference } from '../../../features/orders/number';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { buildCsvDocument } from '../../../features/admin/csv';
import { recordAdminAuditLog } from '../../../features/audit/db';

export const prerender = false;

const money = (cents: number, currency: string): string =>
  toMajorUnits(cents, currency).toFixed(currencyDecimals(currency));

// GET /admin/orders/export.csv — دانلود خروجی CSV ایمن (با BOM و خنثی‌سازی فرمول اکسل)
export const GET: APIRoute = async ({ url, locals, cookies, request }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'orders.export');
  if (!guard.ok) return guard.response;

  const filter = combineOrderFilterClauses(
    parseOrderFilters(url.searchParams),
    parseOrderAdvancedFilters(url.searchParams),
  );
  const orders = await listOrders(env.DB, 100_000, 'created_at DESC', 0, filter);
  const onCfg = getConfig().orderNumber;

  const header = [
    'Order',
    'Date',
    'Email',
    'Method',
    'Status',
    'Fulfillment',
    'Subtotal',
    'Shipping',
    'Discount',
    'Tax',
    'Total',
    'Currency',
    'Provider refunded',
    'Externally refunded',
    'Total refunded',
    'Net',
    'Refund state',
    'Refund review',
    'Carrier',
    'Tracking',
  ];
  const rows = orders.map((o) => [
    orderReference(o.public_id, o.id, onCfg),
    o.created_at,
    o.email ?? '',
    o.payment_method ?? '',
    o.status,
    o.fulfillment_status,
    money(o.amount_total_cents - o.shipping_cents - o.tax_cents + o.discount_cents, o.currency),
    money(o.shipping_cents, o.currency),
    money(o.discount_cents, o.currency),
    money(o.tax_cents, o.currency),
    money(o.amount_total_cents, o.currency),
    o.currency.toUpperCase(),
    money(o.provider_refunded_cents, o.currency),
    money(o.external_refunded_cents, o.currency),
    money(o.refunded_cents, o.currency),
    money(o.amount_total_cents - o.refunded_cents, o.currency),
    o.refunded_cents === 0
      ? 'none'
      : o.refunded_cents >= o.amount_total_cents
        ? 'full'
        : 'partial',
    o.refund_review_reason && !o.refund_reviewed_at ? o.refund_review_reason : '',
    o.tracking_carrier ?? '',
    o.tracking_number ?? '',
  ]);

  await recordAdminAuditLog(env.DB, {
    action: 'orders.exported_csv',
    module: 'orders',
    targetType: 'orders',
    targetId: 'csv_export',
    actor: guard.actor.id,
    details: { rowCount: rows.length },
  });

  const csv = buildCsvDocument(header, rows);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="orders.csv"',
      'cache-control': 'private, no-store',
    },
  });
};
