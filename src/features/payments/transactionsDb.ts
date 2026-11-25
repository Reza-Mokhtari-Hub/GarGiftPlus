import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId';
import {
  canTransitionPaymentTx,
  verifyTransactionMatch,
  type PaymentTxStatus,
  type PaymentTxTargetType,
} from './transactions';

export interface PaymentTransactionRow {
  id: number;
  public_id: string;
  target_type: PaymentTxTargetType;
  target_public_id: string;
  customer_id: number | null;
  customer_email: string | null;
  method: string;
  amount: number;
  currency: string;
  gateway_amount_rial: number | null;
  status: PaymentTxStatus;
  authority_or_track_id: string | null;
  ref_id: string | null;
  card_pan: string | null;
  idempotency_key: string;
  failure_reason: string | null;
  payload_json: string | null;
  initiated_at: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentTxInput {
  targetType: PaymentTxTargetType;
  targetPublicId: string;
  customerId?: number | null;
  customerEmail?: string | null;
  method: string;
  amount: number;
  currency: string;
  gatewayAmountRial?: number | null;
  status?: PaymentTxStatus;
  authorityOrTrackId?: string | null;
  refId?: string | null;
  idempotencyKey?: string;
  payload?: Record<string, unknown> | null;
}

export async function createPaymentTransaction(
  db: D1Database,
  input: CreatePaymentTxInput,
): Promise<PaymentTransactionRow> {
  const status = input.status ?? 'CREATED';
  const payloadJson = input.payload ? JSON.stringify(input.payload) : null;
  const publicId = await withPublicId('paymentTx', async (id) => {
    const idempotencyKey = input.idempotencyKey ?? `ptx:${id}`;
    await db
      .prepare(
        `INSERT INTO payment_transactions
           (public_id, target_type, target_public_id, customer_id, customer_email,
            method, amount, currency, gateway_amount_rial, status, authority_or_track_id, ref_id,
            idempotency_key, payload_json, initiated_at, verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 CASE WHEN ? = 'INITIATED' THEN datetime('now') ELSE NULL END,
                 CASE WHEN ? = 'VERIFIED' THEN datetime('now') ELSE NULL END)`,
      )
      .bind(
        id,
        input.targetType,
        input.targetPublicId,
        input.customerId ?? null,
        input.customerEmail?.trim().toLowerCase() ?? null,
        input.method,
        input.amount,
        input.currency.toLowerCase(),
        input.gatewayAmountRial ?? null,
        status,
        input.authorityOrTrackId ?? null,
        input.refId ?? null,
        idempotencyKey,
        payloadJson,
        status,
        status,
      )
      .run();
    return id;
  });

  const row = await getPaymentTxByPublicId(db, publicId);
  if (!row) throw new Error('Failed to create payment transaction');
  return row;
}

export async function getPaymentTxByPublicId(
  db: D1Database,
  publicId: string,
): Promise<PaymentTransactionRow | null> {
  return db
    .prepare('SELECT * FROM payment_transactions WHERE public_id = ?')
    .bind(publicId)
    .first<PaymentTransactionRow>();
}

export async function getPaymentTxById(
  db: D1Database,
  id: number,
): Promise<PaymentTransactionRow | null> {
  return db
    .prepare('SELECT * FROM payment_transactions WHERE id = ?')
    .bind(id)
    .first<PaymentTransactionRow>();
}

export async function getPaymentTxByAuthority(
  db: D1Database,
  method: string,
  authorityOrTrackId: string,
): Promise<PaymentTransactionRow | null> {
  return db
    .prepare(
      `SELECT * FROM payment_transactions
       WHERE method = ? AND authority_or_track_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(method, authorityOrTrackId)
    .first<PaymentTransactionRow>();
}

export async function getLatestPaymentTxForTarget(
  db: D1Database,
  targetType: PaymentTxTargetType,
  targetPublicId: string,
): Promise<PaymentTransactionRow | null> {
  return db
    .prepare(
      `SELECT * FROM payment_transactions
       WHERE target_type = ? AND target_public_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(targetType, targetPublicId)
    .first<PaymentTransactionRow>();
}

export async function markPaymentTxInitiated(
  db: D1Database,
  publicId: string,
  authorityOrTrackId: string,
  gatewayAmountRial?: number | null,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE payment_transactions
          SET status = 'INITIATED',
              authority_or_track_id = ?,
              gateway_amount_rial = COALESCE(?, gateway_amount_rial),
              initiated_at = datetime('now'),
              updated_at = datetime('now')
        WHERE public_id = ? AND status IN ('CREATED', 'INITIATED')`,
    )
    .bind(authorityOrTrackId, gatewayAmountRial ?? null, publicId)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function transitionPaymentTxStatus(
  db: D1Database,
  publicId: string,
  nextStatus: PaymentTxStatus,
  opts: {
    failureReason?: string | null;
    refId?: string | null;
    cardPan?: string | null;
  } = {},
): Promise<boolean> {
  const current = await getPaymentTxByPublicId(db, publicId);
  if (!current) return false;
  if (!canTransitionPaymentTx(current.status, nextStatus)) return false;

  const res = await db
    .prepare(
      `UPDATE payment_transactions
          SET status = ?,
              failure_reason = COALESCE(?, failure_reason),
              ref_id = COALESCE(?, ref_id),
              card_pan = COALESCE(?, card_pan),
              verified_at = CASE WHEN ? = 'VERIFIED' THEN datetime('now') ELSE verified_at END,
              updated_at = datetime('now')
        WHERE public_id = ? AND status = ?`,
    )
    .bind(
      nextStatus,
      opts.failureReason ?? null,
      opts.refId ?? null,
      opts.cardPan ?? null,
      nextStatus,
      publicId,
      current.status,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * تایید اتمیک یک تراکنش پرداخت با بررسی تطابق مبلغ و ارز و جلوگیری از Replay.
 */
export async function claimPaymentTxVerified(
  db: D1Database,
  publicId: string,
  actual: {
    amount: number;
    currency: string;
    refId: string;
    cardPan?: string | null;
  },
): Promise<
  | { ok: true; wonClaim: boolean; tx: PaymentTransactionRow }
  | { ok: false; error: string }
> {
  const current = await getPaymentTxByPublicId(db, publicId);
  if (!current) {
    return { ok: false, error: 'تراکنش پرداخت یافت نشد.' };
  }

  const check = verifyTransactionMatch(
    { amount: current.amount, currency: current.currency, status: current.status },
    { amount: actual.amount, currency: actual.currency },
  );
  if (!check.ok) {
    if (check.reason === 'already_verified') {
      return { ok: true, wonClaim: false, tx: current };
    }
    return {
      ok: false,
      error:
        check.reason === 'amount_mismatch'
          ? 'مبلغ تراکنش با مبلغ ثبت‌شده مطابقت ندارد.'
          : check.reason === 'currency_mismatch'
            ? 'ارز تراکنش مطابقت ندارد.'
            : 'وضعیت تراکنش امکان تایید ندارد.',
    };
  }

  // Prevent reusing the same provider ref_id across a different payment_transaction
  if (actual.refId && actual.refId.trim()) {
    const duplicateRef = await db
      .prepare(
        `SELECT public_id FROM payment_transactions
         WHERE method = ? AND ref_id = ? AND public_id != ? AND status = 'VERIFIED'
         LIMIT 1`,
      )
      .bind(current.method, actual.refId.trim(), publicId)
      .first<{ public_id: string }>();
    if (duplicateRef) {
      await transitionPaymentTxStatus(db, publicId, 'FAILED', {
        failureReason: 'شماره مرجع تراکنش قبلاً برای تراکنش دیگری استفاده شده است.',
      });
      return { ok: false, error: 'شماره مرجع تراکنش تکراری است.' };
    }
  }

  const res = await db
    .prepare(
      `UPDATE payment_transactions
          SET status = 'VERIFIED',
              ref_id = ?,
              card_pan = COALESCE(?, card_pan),
              verified_at = datetime('now'),
              updated_at = datetime('now')
        WHERE public_id = ? AND status IN ('CREATED', 'INITIATED', 'PAYMENT_REVIEW')`,
    )
    .bind(actual.refId.trim(), actual.cardPan ?? null, publicId)
    .run();

  const updated = (await getPaymentTxByPublicId(db, publicId)) ?? current;
  return {
    ok: true,
    wonClaim: (res.meta?.changes ?? 0) > 0,
    tx: updated,
  };
}

export async function listPaymentTransactionsByCustomer(
  db: D1Database,
  customerId: number,
  customerEmail: string,
  limit = 30,
): Promise<PaymentTransactionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM payment_transactions
       WHERE customer_id = ? OR LOWER(customer_email) = LOWER(?)
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(customerId, customerEmail, limit)
    .all<PaymentTransactionRow>();
  return results ?? [];
}

export async function listAllPaymentTransactions(
  db: D1Database,
  limit = 60,
  statusFilter?: string | null,
): Promise<PaymentTransactionRow[]> {
  if (statusFilter && statusFilter.trim()) {
    const { results } = await db
      .prepare(
        `SELECT * FROM payment_transactions
         WHERE status = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(statusFilter.trim(), limit)
      .all<PaymentTransactionRow>();
    return results ?? [];
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM payment_transactions
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<PaymentTransactionRow>();
  return results ?? [];
}

export async function listPaymentTransactions(
  db: D1Database,
  opts: { customerId?: number; status?: string | null; limit?: number } = {},
): Promise<PaymentTransactionRow[]> {
  const limit = opts.limit ?? 50;
  if (opts.customerId != null) {
    const { results } = await db
      .prepare(
        `SELECT * FROM payment_transactions
         WHERE customer_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(opts.customerId, limit)
      .all<PaymentTransactionRow>();
    return results ?? [];
  }
  return listAllPaymentTransactions(db, limit, opts.status ?? null);
}

