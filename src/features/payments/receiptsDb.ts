import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId';
import {
  verifyTransactionMatch,
  type PaymentTxTargetType,
} from './transactions';
import {
  claimPaymentTxVerified,
  getPaymentTxById,
  transitionPaymentTxStatus,
} from './transactionsDb';
import { recordAdminAuditLog } from '../audit/db';

export type ReceiptStatus = 'pending_review' | 'approved' | 'rejected';

export interface BankTransferReceiptRow {
  id: number;
  public_id: string;
  payment_tx_id: number;
  bank_account_id: number | null;
  customer_id: number | null;
  customer_email: string | null;
  target_type: PaymentTxTargetType;
  target_public_id: string;
  amount: number;
  currency: string;
  tracking_code: string | null;
  r2_object_key: string;
  mime_type: string;
  size_bytes: number;
  status: ReceiptStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateReceiptInput {
  paymentTxId: number;
  bankAccountId?: number | null;
  customerId?: number | null;
  customerEmail?: string | null;
  targetType: PaymentTxTargetType;
  targetPublicId: string;
  amount: number;
  currency: string;
  trackingCode?: string | null;
  r2ObjectKey: string;
  mimeType: string;
  sizeBytes: number;
  receiptPublicId?: string;
}

/**
 * ثبت رسید کارت‌به‌کارت و انتقال وضعیت تراکنش به PAYMENT_REVIEW.
 * آپلود رسید هرگز تراکنش یا سفارش را به‌صورت خودکار پرداخت‌شده علامت نمی‌زند.
 */
export async function recordBankTransferReceipt(
  db: D1Database,
  input: CreateReceiptInput,
): Promise<BankTransferReceiptRow> {
  const tx = await getPaymentTxById(db, input.paymentTxId);
  if (!tx) {
    throw new Error('تراکنش پرداخت مرتبط یافت نشد.');
  }
  if (tx.status === 'VERIFIED') {
    throw new Error('این تراکنش قبلاً تایید شده است.');
  }

  // Reject any new receipt while another receipt on the same payment_tx is already pending_review or approved
  const activeExisting = await db
    .prepare(
      `SELECT public_id, status FROM bank_transfer_receipts
       WHERE payment_tx_id = ? AND status IN ('pending_review', 'approved')
       LIMIT 1`,
    )
    .bind(tx.id)
    .first<{ public_id: string; status: string }>();

  if (activeExisting) {
    throw new Error('یک رسید در حال بررسی برای این تراکنش ثبت شده است.');
  }

  const insertFn = async (publicId: string) => {
    await db.batch([
      db
        .prepare(
          `INSERT INTO bank_transfer_receipts
             (public_id, payment_tx_id, bank_account_id, customer_id, customer_email,
              target_type, target_public_id, amount, currency, tracking_code,
              r2_object_key, mime_type, size_bytes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
        )
        .bind(
          publicId,
          tx.id,
          input.bankAccountId ?? null,
          input.customerId ?? tx.customer_id ?? null,
          input.customerEmail ?? tx.customer_email ?? null,
          input.targetType,
          input.targetPublicId,
          input.amount,
          input.currency,
          input.trackingCode?.trim().slice(0, 80) || null,
          input.r2ObjectKey,
          input.mimeType,
          input.sizeBytes,
        ),
      db
        .prepare(
          `UPDATE payment_transactions
              SET status = 'PAYMENT_REVIEW',
                  failure_reason = NULL,
                  updated_at = datetime('now')
            WHERE id = ? AND status IN ('CREATED', 'INITIATED', 'FAILED', 'PAYMENT_REVIEW')`,
        )
        .bind(tx.id),
    ]);
    return publicId;
  };

  const publicId = input.receiptPublicId
    ? await insertFn(input.receiptPublicId)
    : await withPublicId('receipt', insertFn);

  const row = await getReceiptByPublicId(db, publicId);
  if (!row) throw new Error('ثبت رسید بانکی انجام نشد.');
  return row;
}

export async function getReceiptByPublicId(
  db: D1Database,
  publicId: string,
): Promise<BankTransferReceiptRow | null> {
  return db
    .prepare('SELECT * FROM bank_transfer_receipts WHERE public_id = ?')
    .bind(publicId)
    .first<BankTransferReceiptRow>();
}

export async function listReceiptsForTarget(
  db: D1Database,
  targetType: PaymentTxTargetType,
  targetPublicId: string,
): Promise<BankTransferReceiptRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM bank_transfer_receipts
       WHERE target_type = ? AND target_public_id = ?
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(targetType, targetPublicId)
    .all<BankTransferReceiptRow>();
  return results ?? [];
}

export async function listReceiptsAdmin(
  db: D1Database,
  statusFilter?: ReceiptStatus | 'all',
  limit = 60,
): Promise<BankTransferReceiptRow[]> {
  if (statusFilter && statusFilter !== 'all') {
    const { results } = await db
      .prepare(
        `SELECT * FROM bank_transfer_receipts
         WHERE status = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(statusFilter, limit)
      .all<BankTransferReceiptRow>();
    return results ?? [];
  }
  const { results } = await db
    .prepare(
      `SELECT * FROM bank_transfer_receipts
       ORDER BY CASE WHEN status = 'pending_review' THEN 0 ELSE 1 END, created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<BankTransferReceiptRow>();
  return results ?? [];
}

export async function countPendingReceipts(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM bank_transfer_receipts WHERE status = 'pending_review'`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * تایید رسید توسط مدیر: تغییر اتمیک وضعیت رسید از pending_review به approved و تایید تراکنش پرداخت.
 */
export async function approveBankTransferReceipt(
  db: D1Database,
  receiptPublicId: string,
  actor: string,
  reviewNote?: string | null,
): Promise<
  | { ok: true; wonClaim: boolean; receipt: BankTransferReceiptRow }
  | { ok: false; error: string }
> {
  const receipt = await getReceiptByPublicId(db, receiptPublicId);
  if (!receipt) return { ok: false, error: 'رسید مورد نظر یافت نشد.' };
  if (receipt.status === 'approved') {
    return { ok: true, wonClaim: false, receipt };
  }
  if (receipt.status === 'rejected') {
    return { ok: false, error: 'این رسید قبلاً رد شده است؛ مشتری باید رسید جدید ارسال کند.' };
  }

  const tx = await getPaymentTxById(db, receipt.payment_tx_id);
  if (!tx) return { ok: false, error: 'تراکنش پرداخت مرتبط یافت نشد.' };

  const precheck = verifyTransactionMatch(
    { amount: tx.amount, currency: tx.currency, status: tx.status },
    { amount: receipt.amount, currency: receipt.currency },
  );
  if (!precheck.ok) {
    if (precheck.reason === 'already_verified') {
      return { ok: true, wonClaim: false, receipt };
    }
    return {
      ok: false,
      error:
        precheck.reason === 'amount_mismatch'
          ? 'مبلغ فیش با مبلغ تراکنش ثبت‌شده مطابقت ندارد.'
          : precheck.reason === 'currency_mismatch'
            ? 'ارز فیش با ارز تراکنش مطابقت ندارد.'
            : 'وضعیت تراکنش مرتبط امکان تایید ندارد.',
    };
  }

  const res = await db
    .prepare(
      `UPDATE bank_transfer_receipts
          SET status = 'approved',
              review_note = ?,
              reviewed_by = ?,
              reviewed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE public_id = ? AND status = 'pending_review'`,
    )
    .bind(reviewNote?.trim() || null, actor, receiptPublicId)
    .run();

  if ((res.meta?.changes ?? 0) === 0) {
    const latest = (await getReceiptByPublicId(db, receiptPublicId)) ?? receipt;
    return { ok: latest.status === 'approved', wonClaim: false, receipt: latest } as
      | { ok: true; wonClaim: boolean; receipt: BankTransferReceiptRow }
      | { ok: false; error: string };
  }

  const claim = await claimPaymentTxVerified(db, tx.public_id, {
    amount: receipt.amount,
    currency: receipt.currency,
    refId: `rcp:${receipt.public_id}`,
  });

  if (!claim.ok) {
    await db
      .prepare(
        `UPDATE bank_transfer_receipts
            SET status = 'pending_review',
                updated_at = datetime('now')
          WHERE public_id = ? AND status = 'approved'`,
      )
      .bind(receiptPublicId)
      .run();
    return { ok: false, error: claim.error };
  }

  await recordAdminAuditLog(db, {
    action: 'receipt.approve',
    targetType: 'bank_transfer_receipt',
    targetId: receipt.public_id,
    actor,
    reason: reviewNote?.trim() || 'تایید واریز بانکی',
    details: {
      paymentTxPublicId: tx.public_id,
      targetType: receipt.target_type,
      targetPublicId: receipt.target_public_id,
      amount: receipt.amount,
      currency: receipt.currency,
    },
  });

  const updated = (await getReceiptByPublicId(db, receiptPublicId)) ?? receipt;
  return { ok: true, wonClaim: claim.wonClaim, receipt: updated };
}

/**
 * رد رسید توسط مدیر با الزام درج دلیل؛ وضعیت تراکنش به FAILED تغییر می‌کند تا مشتری بتواند رسید جایگزین بفرستد.
 */
export async function rejectBankTransferReceipt(
  db: D1Database,
  receiptPublicId: string,
  actor: string,
  reviewNote: string,
): Promise<{ ok: true; receipt: BankTransferReceiptRow } | { ok: false; error: string }> {
  const note = reviewNote.trim();
  if (note.length < 3 || note.length > 500) {
    return { ok: false, error: 'درج علت رد رسید (حداقل ۳ کاراکتر) الزامی است.' };
  }

  const receipt = await getReceiptByPublicId(db, receiptPublicId);
  if (!receipt) return { ok: false, error: 'رسید مورد نظر یافت نشد.' };
  if (receipt.status !== 'pending_review') {
    return { ok: false, error: 'فقط رسیدهای در انتظار بررسی قابل رد کردن هستند.' };
  }

  const tx = await getPaymentTxById(db, receipt.payment_tx_id);
  if (!tx) return { ok: false, error: 'تراکنش پرداخت مرتبط یافت نشد.' };

  await db
    .prepare(
      `UPDATE bank_transfer_receipts
          SET status = 'rejected',
              review_note = ?,
              reviewed_by = ?,
              reviewed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE public_id = ? AND status = 'pending_review'`,
    )
    .bind(note, actor, receiptPublicId)
    .run();

  await transitionPaymentTxStatus(db, tx.public_id, 'FAILED', {
    failureReason: note,
  });

  await recordAdminAuditLog(db, {
    action: 'receipt.reject',
    targetType: 'bank_transfer_receipt',
    targetId: receipt.public_id,
    actor,
    reason: note,
    details: {
      paymentTxPublicId: tx.public_id,
      targetType: receipt.target_type,
      targetPublicId: receipt.target_public_id,
    },
  });

  const updated = (await getReceiptByPublicId(db, receiptPublicId)) ?? receipt;
  return { ok: true, receipt: updated };
}
