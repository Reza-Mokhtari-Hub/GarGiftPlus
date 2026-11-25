import type { D1Database } from '@cloudflare/workers-types';
import { deliverOrderNotifications } from './outbox';
import { getStoreSettings } from '../settings/db';

export interface AdminOutboxLogRow {
  order_id: number;
  order_public_id: string | null;
  customer_email: string | null;
  kind: string;
  state: 'pending' | 'processing' | 'sent' | 'skipped' | 'dead';
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface OutboxStats {
  pending: number;
  processing: number;
  sent: number;
  skipped: number;
  dead: number;
}

export async function getOutboxStats(db: D1Database): Promise<OutboxStats> {
  try {
    const { results } = await db
      .prepare(`SELECT state, COUNT(*) AS n FROM order_notifications GROUP BY state`)
      .all<{ state: string; n: number }>();
    const map = new Map((results ?? []).map((r) => [r.state, r.n]));
    return {
      pending: map.get('pending') ?? 0,
      processing: map.get('processing') ?? 0,
      sent: map.get('sent') ?? 0,
      skipped: map.get('skipped') ?? 0,
      dead: map.get('dead') ?? 0,
    };
  } catch {
    return { pending: 0, processing: 0, sent: 0, skipped: 0, dead: 0 };
  }
}

export async function listAdminOutboxLogs(
  db: D1Database,
  options: { state?: string; q?: string; limit?: number; offset?: number } = {},
): Promise<AdminOutboxLogRow[]> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (options.state && ['pending', 'processing', 'sent', 'skipped', 'dead'].includes(options.state)) {
    clauses.push('n.state = ?');
    params.push(options.state);
  }
  if (options.q?.trim()) {
    const q = `%${options.q.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(COALESCE(o.public_id, '')) LIKE ? OR LOWER(COALESCE(o.email, '')) LIKE ? OR LOWER(n.kind) LIKE ?)`,
    );
    params.push(q, q, q);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, options.limit ?? 60));
  const offset = Math.max(0, options.offset ?? 0);

  try {
    const { results } = await db
      .prepare(
        `SELECT n.order_id,
                o.public_id AS order_public_id,
                o.email AS customer_email,
                n.kind,
                n.state,
                n.attempts,
                n.last_error,
                n.created_at,
                n.sent_at
           FROM order_notifications n
           LEFT JOIN orders o ON o.id = n.order_id
           ${where}
          ORDER BY n.created_at DESC, n.order_id DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all<AdminOutboxLogRow>();
    return results ?? [];
  } catch {
    return [];
  }
}

/**
 * بازنشانی امن ردیف ناموفق/متوقف برای ارسال مجدد از همان سازوکار idempotent outbox.
 */
export async function retryOutboxNotification(
  db: D1Database,
  orderPublicId: string,
  kind: string,
  origin: string,
): Promise<{ ok: boolean; error?: string }> {
  const order = await db
    .prepare('SELECT id FROM orders WHERE public_id = ?')
    .bind(orderPublicId)
    .first<{ id: number }>();
  if (!order) return { ok: false, error: 'سفارش مورد نظر یافت نشد.' };

  const res = await db
    .prepare(
      `UPDATE order_notifications
          SET state = 'pending',
              attempts = 0,
              lease_expires_at = NULL,
              last_error = NULL
        WHERE order_id = ? AND kind = ? AND state IN ('dead', 'pending', 'skipped')`,
    )
    .bind(order.id, kind)
    .run();

  if ((res.meta?.changes ?? 0) === 0) {
    return { ok: false, error: 'این پیام قبلاً ارسال شده یا در حال پردازش است.' };
  }

  const settings = await getStoreSettings(db);
  await deliverOrderNotifications(db, order.id, origin, settings);
  return { ok: true };
}
