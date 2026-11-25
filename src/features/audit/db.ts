import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId.ts';

export interface AdminAuditLog {
  id: number;
  public_id: string;
  action: string;
  module: string | null;
  target_type: string;
  target_id: string;
  actor: string;
  reason: string | null;
  result: string;
  details_json: string | null;
  created_at: string;
}

export interface NewAuditLogInput {
  action: string;
  module?: string | null;
  targetType: string;
  targetId: string;
  actor: string;
  reason?: string | null;
  result?: 'success' | 'denied' | 'failed';
  details?: Record<string, unknown> | null;
}

const SENSITIVE_KEY_RE =
  /^(?:password|password_hash|secret|secret_key|api_key|apikey|token|access_token|gift_code|giftcode|license_key|activation_key|card_pin|pin|cvv|auth_secret|secrets_kek|kek|payload_text|raw_secret)$/i;
const SENSITIVE_SUFFIX_RE =
  /(?:password|secret|token|apikey|api_key|gift_code|license_key|pin|cvv|private_key)$/i;

const SAFE_EXACT_KEYS = new Set([
  'public_id',
  'tracking_code',
  'key_name',
  'event_key',
  'role',
  'module',
  'method',
  'orderId',
  'orderPublicId',
  'paymentMethod',
]);

/**
 * پالایش و سانسور داده‌های حساس (رمز عبور، کلیدهای امنیتی، توکن و کد گیفت‌کارت)
 * پیش از ذخیره در لاگ‌های تغییرناپذیر ممیزی.
 */
export function sanitizeAuditDetails(
  input: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || depth > 4) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input)) {
    if (
      !SAFE_EXACT_KEYS.has(key) &&
      (SENSITIVE_KEY_RE.test(key) || SENSITIVE_SUFFIX_RE.test(key))
    ) {
      clean[key] = '[REDACTED]';
      continue;
    }
    if (Array.isArray(val)) {
      clean[key] = val.slice(0, 30).map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeAuditDetails(item as Record<string, unknown>, depth + 1)
          : typeof item === 'string'
            ? item.slice(0, 240)
            : item,
      );
      continue;
    }
    if (val && typeof val === 'object') {
      clean[key] = sanitizeAuditDetails(val as Record<string, unknown>, depth + 1);
      continue;
    }
    if (typeof val === 'string') {
      clean[key] = val.slice(0, 500);
      continue;
    }
    clean[key] = val;
  }
  return clean;
}

export async function recordAdminAuditLog(
  db: D1Database,
  input: NewAuditLogInput,
): Promise<string> {
  const sanitized = sanitizeAuditDetails(input.details);
  const detailsJson = sanitized ? JSON.stringify(sanitized) : null;
  const inferredModule =
    input.module?.trim() ||
    (input.targetType ? input.targetType.split('_')[0] : null);
  const result = input.result ?? 'success';
  const reason = input.reason?.trim() || null;

  return withPublicId('auditLog', async (publicId) => {
    try {
      await db
        .prepare(
          `INSERT INTO admin_audit_logs
             (public_id, action, module, target_type, target_id, actor, reason, result, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          publicId,
          input.action,
          inferredModule,
          input.targetType,
          input.targetId,
          input.actor,
          reason,
          result,
          detailsJson,
        )
        .run();
    } catch {
      // سازگاری با پایگاه‌داده پیش از اجرای مهاجرت 0044
      await db
        .prepare(
          `INSERT INTO admin_audit_logs
             (public_id, action, target_type, target_id, actor, reason, details_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          publicId,
          input.action,
          input.targetType,
          input.targetId,
          input.actor,
          reason,
          detailsJson,
        )
        .run();
    }
    return publicId;
  });
}

export type AdminAuditLogRow = AdminAuditLog;

export async function listAdminAuditLogs(
  db: D1Database,
  limit = 50,
  offset = 0,
): Promise<AdminAuditLog[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM admin_audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<AdminAuditLog>();
  return results ?? [];
}

export interface AuditLogFilter {
  actor?: string;
  module?: string;
  action?: string;
  result?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function listAdminAuditLogsFiltered(
  db: D1Database,
  filter: AuditLogFilter = {},
  limit = 50,
  offset = 0,
): Promise<{ logs: AdminAuditLog[]; total: number }> {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.actor?.trim()) {
    clauses.push('LOWER(actor) LIKE ?');
    params.push(`%${filter.actor.trim().toLowerCase()}%`);
  }
  if (filter.module?.trim()) {
    clauses.push('LOWER(COALESCE(module, target_type)) = ?');
    params.push(filter.module.trim().toLowerCase());
  }
  if (filter.action?.trim()) {
    clauses.push('LOWER(action) LIKE ?');
    params.push(`%${filter.action.trim().toLowerCase()}%`);
  }
  if (filter.result?.trim()) {
    clauses.push('LOWER(COALESCE(result, \'success\')) = ?');
    params.push(filter.result.trim().toLowerCase());
  }
  if (filter.dateFrom?.trim()) {
    clauses.push('date(created_at) >= date(?)');
    params.push(filter.dateFrom.trim());
  }
  if (filter.dateTo?.trim()) {
    clauses.push('date(created_at) <= date(?)');
    params.push(filter.dateTo.trim());
  }
  if (filter.q?.trim()) {
    const q = `%${filter.q.trim().toLowerCase()}%`;
    clauses.push(
      '(LOWER(target_id) LIKE ? OR LOWER(actor) LIKE ? OR LOWER(action) LIKE ? OR LOWER(COALESCE(reason, \'\')) LIKE ?)',
    );
    params.push(q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rowsRes, countRes] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM admin_audit_logs
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all<AdminAuditLog>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM admin_audit_logs ${where}`)
      .bind(...params)
      .first<{ n: number }>(),
  ]);

  return {
    logs: rowsRes.results ?? [],
    total: countRes?.n ?? 0,
  };
}

export async function listOrderFulfillmentAuditLogs(
  db: D1Database,
  orderId: number,
  orderPublicId: string | null | undefined,
  limit = 20,
): Promise<AdminAuditLog[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM admin_audit_logs
        WHERE target_id = ?
           OR details_json LIKE ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(orderPublicId ?? String(orderId), `%"orderId":${orderId}%`, limit)
    .all<AdminAuditLog>();
  return results ?? [];
}
