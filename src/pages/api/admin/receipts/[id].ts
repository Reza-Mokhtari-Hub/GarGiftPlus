import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import { settlePendingOrderFromTx } from '../../../../features/payments/iranProviders';
import {
  approveBankTransferReceipt,
  getReceiptByPublicId,
  rejectBankTransferReceipt,
} from '../../../../features/payments/receiptsDb';
import { getPaymentTxById } from '../../../../features/payments/transactionsDb';
import { settleWalletTopupOnce, updateWalletTopupStatus } from '../../../../features/wallet/db';

export const POST: APIRoute = async ({ params, request, url, locals, cookies, redirect }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'receipts.review');
  if (!guard.ok) return guard.response;

  const receiptPublicId = (params.id ?? '').trim();
  if (!receiptPublicId) {
    return redirect('/admin/receipts?error=' + encodeURIComponent('شناسه فیش نامعتبر است.'), 303);
  }

  const form = await request.formData();
  const action = String(form.get('_action') ?? '').trim();
  const note = String(form.get('admin_note') ?? '').trim();

  const existing = await getReceiptByPublicId(env.DB, receiptPublicId);
  if (!existing) {
    return redirect('/admin/receipts?error=' + encodeURIComponent('فیش واریزی یافت نشد.'), 303);
  }

  if (action === 'approve') {
    const res = await approveBankTransferReceipt(
      env.DB,
      receiptPublicId,
      guard.actor.id,
      note || 'تایید واریز بانکی توسط مدیر',
    );
    if (!res.ok) {
      return redirect(`/admin/receipts?error=${encodeURIComponent(res.error)}`, 303);
    }
    if (!res.wonClaim) {
      return redirect(
        `/admin/receipts?error=${encodeURIComponent('این فیش قبلاً تایید شده است و امکان تایید مجدد وجود ندارد.')}`,
        303,
      );
    }

    const tx = await getPaymentTxById(env.DB, res.receipt.payment_tx_id);
    if (res.receipt.target_type === 'wallet_topup') {
      await settleWalletTopupOnce(env.DB, res.receipt.target_public_id, 'bank_transfer', guard.actor.id);
    } else if (res.receipt.target_type === 'order' && tx) {
      const ctx = locals.cfContext;
      const waitUntil = ctx ? ctx.waitUntil.bind(ctx) : undefined;
      await settlePendingOrderFromTx(env.DB, tx, url.origin, locals.settings, waitUntil);
    }

    await recordAdminAuditLog(env.DB, {
      action: 'receipt.approved',
      module: 'receipts',
      targetType: 'receipt',
      targetId: receiptPublicId,
      actor: guard.actor.id,
      reason: note || 'تایید واریز بانکی',
      details: {
        amount: res.receipt.amount,
        targetType: res.receipt.target_type,
        targetPublicId: res.receipt.target_public_id,
      },
    });

    return redirect('/admin/receipts?msg=approved', 303);
  }

  if (action === 'reject') {
    const res = await rejectBankTransferReceipt(env.DB, receiptPublicId, guard.actor.id, note);
    if (!res.ok) {
      return redirect(`/admin/receipts?error=${encodeURIComponent(res.error)}`, 303);
    }

    if (res.receipt.target_type === 'wallet_topup') {
      await updateWalletTopupStatus(env.DB, res.receipt.target_public_id, 'failed');
    }

    await recordAdminAuditLog(env.DB, {
      action: 'receipt.rejected',
      module: 'receipts',
      targetType: 'receipt',
      targetId: receiptPublicId,
      actor: guard.actor.id,
      reason: note,
      details: {
        amount: res.receipt.amount,
        targetType: res.receipt.target_type,
        targetPublicId: res.receipt.target_public_id,
      },
    });

    return redirect('/admin/receipts?msg=rejected', 303);
  }

  return redirect('/admin/receipts', 303);
};
