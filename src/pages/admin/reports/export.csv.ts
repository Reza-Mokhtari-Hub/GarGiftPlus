import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { generateAdminReports } from '../../../features/admin/reportsDb';
import { buildCsvDocument } from '../../../features/admin/csv';
import { getConfig, toMajorUnits, currencyDecimals } from '../../../config';

export const prerender = false;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: APIRoute = async ({ url, locals, cookies, request }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'reports.view');
  if (!auth.ok) return auth.response;

  const rawFrom = (url.searchParams.get('from') ?? '').trim();
  const rawTo = (url.searchParams.get('to') ?? '').trim();
  const dateFrom = DATE_RE.test(rawFrom) ? rawFrom : null;
  const dateTo = DATE_RE.test(rawTo) ? rawTo : null;

  const report = await generateAdminReports(env.DB, dateFrom, dateTo);
  const currency = getConfig().currency;
  const fmt = (amount: number) => toMajorUnits(amount, currency).toFixed(currencyDecimals(currency));

  const rows: Array<Array<string | number>> = [
    ['SUMMARY', 'Total Paid/Settled Orders', report.summary.totalOrders, currency.toUpperCase()],
    ['SUMMARY', 'Gross Sales', fmt(report.summary.grossSales), currency.toUpperCase()],
    ['SUMMARY', 'Refunded Amount', fmt(report.summary.refundedAmount), currency.toUpperCase()],
    ['SUMMARY', 'Net Revenue', fmt(report.summary.netSales), currency.toUpperCase()],
    ['SUMMARY', 'Average Order Value', fmt(report.summary.averageOrderValue), currency.toUpperCase()],
    ...report.byMethod.map((m) => [
      'PAYMENT_METHOD',
      m.method,
      m.orders,
      fmt(m.net),
    ]),
    ...report.topProducts.map((p) => [
      'TOP_PRODUCT',
      p.name,
      p.units,
      fmt(p.revenue),
    ]),
    ...report.byCategory.map((c) => [
      'CATEGORY',
      c.category_name,
      c.units_sold,
      fmt(c.revenue_total),
    ]),
  ];

  await recordAdminAuditLog(env.DB, {
    action: 'reports_exported_csv',
    module: 'reports',
    targetType: 'reports',
    targetId: `${dateFrom ?? 'all'}_${dateTo ?? 'all'}`,
    actor: auth.actor.id,
    details: { rows: rows.length, dateFrom, dateTo },
  });

  const csv = buildCsvDocument(['Section', 'Label', 'Count', 'Amount'], rows);
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="gargift-reports.csv"',
      'cache-control': 'private, no-store',
    },
  });
};
