import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, withPublicId } from '../ids/publicId';
import { ensureCustomerByEmail } from '../customers/accountsDb';
import {
  signedWalletDelta,
  validateAdminAdjustmentInput,
  type WalletTxType,
} from './rules';
import { recordAdminAuditLog } from '../audit/db';

export interface Wallet {
  id: number;
  public_id: string;
  customer_id: number;
  balance: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: number;
  public_id: string;
  wallet_id: number;
  customer_id: number;
  type: WalletTxType;
  amount: number;
  balance_after: number;
  currency: string;
  reference_type: string | null;
  reference_id: string | null;
  idempotency_key: string;
  reason: string | null;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

export interface WalletTopup {
  id: number;
  public_id: string;
  customer_id: number;
  wallet_id: number;
  amount: number;
  currency: string;
  payment_method: string;
  status: 'pending' | 'payment_review' | 'completed' | 'failed' | 'cancelled' | 'expired';
  payment_tx_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function getOrCreateWalletByCustomerId(
  db: D1Database,
  customerId: number,
  currency = 'irt',
): Promise<Wallet> {
  const existing = await db
    .prepare('SELECT * FROM wallets WHERE customer_id = ?')
    .bind(customerId)
    .first<Wallet>();
  if (existing) return existing;

  await withPublicId('wallet', async (publicId) => {
    await db
      .prepare(
        `INSERT INTO wallets (public_id, customer_id, balance, currency)
         VALUES (?, ?, 0, ?)
         ON CONFLICT(customer_id) DO NOTHING`,
      )
      .bind(publicId, customerId, currency)
      .run();
  });

  const wallet = await db
    .prepare('SELECT * FROM wallets WHERE customer_id = ?')
    .bind(customerId)
    .first<Wallet>();
  if (!wallet) throw new Error(`Failed to initialize wallet for customer ${customerId}`);
  return wallet;
}

export async function getOrCreateWalletByEmail(
  db: D1Database,
  email: string,
  currency = 'irt',
): Promise<{ customerId: number; wallet: Wallet }> {
  const customer = await ensureCustomerByEmail(db, email, false);
  const wallet = await getOrCreateWalletByCustomerId(db, customer.id, currency);
  return { customerId: customer.id, wallet };
}

export async function getWalletTxByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<WalletTransaction | null> {
  return db
    .prepare('SELECT * FROM wallet_transactions WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first<WalletTransaction>();
}

export interface WalletMutationInput {
  customerId: number;
  type: WalletTxType;
  positiveAmount: number;
  idempotencyKey: string;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  actorType?: 'customer' | 'admin' | 'system' | 'gateway';
  actorId?: string | null;
}

export type WalletMutationResult =
  | {
      ok: true;
      idempotentReplay: boolean;
      wallet: Wallet;
      transaction: WalletTransaction;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * اجرای اتمیک و Idempotent تراکنش کیف پول (افزایش یا کسر مشروط به موجودی کافی).
 */
export async function applyWalletMutation(
  db: D1Database,
  input: WalletMutationInput,
): Promise<WalletMutationResult> {
  const wallet = await getOrCreateWalletByCustomerId(db, input.customerId);
  const existingTx = await getWalletTxByIdempotencyKey(db, input.idempotencyKey);
  if (existingTx) {
    return {
      ok: true,
      idempotentReplay: true,
      wallet,
      transaction: existingTx,
    };
  }

  let signedDelta: number;
  try {
    signedDelta = signedWalletDelta(input.type, input.positiveAmount);
  } catch {
    return { ok: false, error: 'مبلغ تراکنش کیف پول معتبر نیست.' };
  }

  const txPublicId = generatePublicId('walletTx');
  const absAmount = Math.abs(signedDelta);

  if (signedDelta > 0) {
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE wallets
                SET balance = balance + ?,
                    updated_at = datetime('now')
              WHERE id = ?`,
          )
          .bind(absAmount, wallet.id),
        db
          .prepare(
            `INSERT INTO wallet_transactions
               (public_id, wallet_id, customer_id, type, amount, balance_after, currency,
                reference_type, reference_id, idempotency_key, reason, actor_type, actor_id)
             SELECT ?, w.id, w.customer_id, ?, ?, w.balance, w.currency, ?, ?, ?, ?, ?, ?
               FROM wallets w
              WHERE w.id = ? AND changes() > 0`,
          )
          .bind(
            txPublicId,
            input.type,
            signedDelta,
            input.referenceType ?? null,
            input.referenceId ?? null,
            input.idempotencyKey,
            input.reason?.trim() || null,
            input.actorType ?? 'system',
            input.actorId ?? null,
            wallet.id,
          ),
      ]);
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        const racedTx = await getWalletTxByIdempotencyKey(db, input.idempotencyKey);
        const updatedWallet = await getOrCreateWalletByCustomerId(db, input.customerId);
        if (racedTx) {
          return {
            ok: true,
            idempotentReplay: true,
            wallet: updatedWallet,
            transaction: racedTx,
          };
        }
      }
      throw err;
    }
  } else {
    // کسر مشروط اتمیک: تنها زمانی موجودی کم می‌شود که balance >= absAmount باشد
    try {
      const [updateRes] = await db.batch([
        db
          .prepare(
            `UPDATE wallets
                SET balance = balance - ?,
                    updated_at = datetime('now')
              WHERE id = ? AND balance >= ?`,
          )
          .bind(absAmount, wallet.id, absAmount),
        db
          .prepare(
            `INSERT INTO wallet_transactions
               (public_id, wallet_id, customer_id, type, amount, balance_after, currency,
                reference_type, reference_id, idempotency_key, reason, actor_type, actor_id)
             SELECT ?, w.id, w.customer_id, ?, ?, w.balance, w.currency, ?, ?, ?, ?, ?, ?
               FROM wallets w
              WHERE w.id = ? AND changes() > 0`,
          )
          .bind(
            txPublicId,
            input.type,
            signedDelta,
            input.referenceType ?? null,
            input.referenceId ?? null,
            input.idempotencyKey,
            input.reason?.trim() || null,
            input.actorType ?? 'system',
            input.actorId ?? null,
            wallet.id,
          ),
      ]);
      if ((updateRes?.meta?.changes ?? 0) === 0) {
        return { ok: false, error: 'موجودی کیف پول برای انجام این تراکنش کافی نیست.' };
      }
    } catch (err) {
      if (err instanceof Error && /UNIQUE/i.test(err.message)) {
        const racedTx = await getWalletTxByIdempotencyKey(db, input.idempotencyKey);
        const updatedWallet = await getOrCreateWalletByCustomerId(db, input.customerId);
        if (racedTx) {
          return {
            ok: true,
            idempotentReplay: true,
            wallet: updatedWallet,
            transaction: racedTx,
          };
        }
      }
      throw err;
    }
  }

  const updatedWallet = await getOrCreateWalletByCustomerId(db, input.customerId);
  const createdTx = await getWalletTxByIdempotencyKey(db, input.idempotencyKey);
  if (!createdTx) {
    return { ok: false, error: 'ثبت تراکنش کیف پول کامل نشد.' };
  }
  return {
    ok: true,
    idempotentReplay: false,
    wallet: updatedWallet,
    transaction: createdTx,
  };
}

export async function listWalletTransactionsByCustomer(
  db: D1Database,
  customerId: number,
  limit = 30,
  offset = 0,
): Promise<WalletTransaction[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM wallet_transactions
       WHERE customer_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(customerId, limit, offset)
    .all<WalletTransaction>();
  return results ?? [];
}

export async function createWalletTopup(
  db: D1Database,
  input: {
    customerId: number;
    amount: number;
    currency?: string;
    paymentMethod: string;
    status?: WalletTopup['status'];
  },
): Promise<WalletTopup> {
  const wallet = await getOrCreateWalletByCustomerId(
    db,
    input.customerId,
    input.currency ?? 'irt',
  );
  const publicId = await withPublicId('walletTopup', async (id) => {
    await db
      .prepare(
        `INSERT INTO wallet_topups
           (public_id, customer_id, wallet_id, amount, currency, payment_method, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.customerId,
        wallet.id,
        input.amount,
        input.currency ?? 'irt',
        input.paymentMethod,
        input.status ?? 'pending',
      )
      .run();
    return id;
  });

  const topup = await getWalletTopupByPublicId(db, publicId);
  if (!topup) throw new Error('Failed to create wallet topup');
  return topup;
}

export async function listWalletTransactions(
  db: D1Database,
  walletId: number,
  limit = 30,
  offset = 0,
): Promise<WalletTransaction[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM wallet_transactions
       WHERE wallet_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(walletId, limit, offset)
    .all<WalletTransaction>();
  return results ?? [];
}

export async function updateWalletTopupStatus(
  db: D1Database,
  topupPublicId: string,
  status: WalletTopup['status'],
): Promise<void> {
  await db
    .prepare(
      `UPDATE wallet_topups
          SET status = ?,
              updated_at = datetime('now')
        WHERE public_id = ? AND status != 'completed'`,
    )
    .bind(status, topupPublicId)
    .run();
}

export async function attachPaymentTxToTopup(
  db: D1Database,
  topupPublicId: string,
  paymentTxPublicId: string,
  status?: WalletTopup['status'],
): Promise<void> {
  if (status) {
    await db
      .prepare(
        `UPDATE wallet_topups
            SET payment_tx_id = ?,
                status = ?,
                updated_at = datetime('now')
          WHERE public_id = ?`,
      )
      .bind(paymentTxPublicId, status, topupPublicId)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE wallet_topups
            SET payment_tx_id = ?,
                updated_at = datetime('now')
          WHERE public_id = ?`,
      )
      .bind(paymentTxPublicId, topupPublicId)
      .run();
  }
}

export async function getWalletTopupByPublicId(
  db: D1Database,
  publicId: string,
): Promise<WalletTopup | null> {
  return db
    .prepare('SELECT * FROM wallet_topups WHERE public_id = ?')
    .bind(publicId)
    .first<WalletTopup>();
}

export async function listWalletTopupsByCustomer(
  db: D1Database,
  customerId: number,
  limit = 20,
): Promise<WalletTopup[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM wallet_topups
       WHERE customer_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(customerId, limit)
    .all<WalletTopup>();
  return results ?? [];
}

/**
 * تسویه یک‌باره شارژ کیف پول پس از تایید درگاه یا تایید فیش بانکی توسط مدیر.
 * با قفل وضعیت و کلید Idempotency، از دوبار شارژ شدن جلوگیری می‌کند.
 */
export async function settleWalletTopupOnce(
  db: D1Database,
  topupPublicId: string,
  source: 'gateway' | 'bank_transfer',
  actorId?: string | null,
): Promise<WalletMutationResult> {
  const topup = await getWalletTopupByPublicId(db, topupPublicId);
  if (!topup) {
    return { ok: false, error: 'درخواست شارژ کیف پول یافت نشد.' };
  }
  const idempotencyKey = `topup:${topup.public_id}`;
  const txType: WalletTxType = source === 'bank_transfer' ? 'TOPUP_BANK' : 'TOPUP_GATEWAY';
  const reason =
    source === 'bank_transfer'
      ? `شارژ کیف پول از طریق کارت‌به‌کارت (${topup.public_id})`
      : `شارژ کیف پول از طریق درگاه آنلاین (${topup.public_id})`;

  const mutation = await applyWalletMutation(db, {
    customerId: topup.customer_id,
    type: txType,
    positiveAmount: topup.amount,
    idempotencyKey,
    referenceType: 'wallet_topup',
    referenceId: topup.public_id,
    reason,
    actorType: source === 'bank_transfer' ? 'admin' : 'gateway',
    actorId: actorId ?? null,
  });

  if (mutation.ok && topup.status !== 'completed') {
    await db
      .prepare(
        `UPDATE wallet_topups
            SET status = 'completed',
                completed_at = datetime('now'),
                updated_at = datetime('now')
          WHERE public_id = ?`,
      )
      .bind(topup.public_id)
      .run();
  }
  return mutation;
}

export async function adminAdjustCustomerWallet(
  db: D1Database,
  params: {
    customerEmail: string;
    rawType: unknown;
    rawAmount: unknown;
    rawReason: unknown;
    adminActor: string;
    idempotencyToken?: string;
  },
): Promise<WalletMutationResult> {
  const validated = validateAdminAdjustmentInput(
    params.rawType,
    params.rawAmount,
    params.rawReason,
  );
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  const customer = await ensureCustomerByEmail(db, params.customerEmail, false);
  const idempotencyKey =
    params.idempotencyToken?.trim() ||
    `admin:${customer.id}:${validated.type}:${validated.amount}:${Date.now()}`;

  const result = await applyWalletMutation(db, {
    customerId: customer.id,
    type: validated.type,
    positiveAmount: validated.amount,
    idempotencyKey,
    referenceType: 'admin_adjustment',
    referenceId: customer.public_id,
    reason: validated.reason,
    actorType: 'admin',
    actorId: params.adminActor,
  });

  if (result.ok && !result.idempotentReplay) {
    await recordAdminAuditLog(db, {
      action: validated.type === 'ADMIN_CREDIT' ? 'wallet.admin_credit' : 'wallet.admin_debit',
      targetType: 'wallet',
      targetId: result.wallet.public_id,
      actor: params.adminActor,
      reason: validated.reason,
      details: {
        customerEmail: customer.email,
        amount: validated.amount,
        balanceAfter: result.wallet.balance,
        walletTxPublicId: result.transaction.public_id,
      },
    });
  }
  return result;
}
