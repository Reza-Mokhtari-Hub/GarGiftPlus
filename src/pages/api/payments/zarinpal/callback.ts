import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getGuestAccess } from '../../../../features/orders/guestAccess';
import { settlePendingOrderFromTx } from '../../../../features/payments/iranProviders';
import {
  claimPaymentTxVerified,
  getPaymentTxByAuthority,
  getPaymentTxByPublicId,
  transitionPaymentTxStatus,
} from '../../../../features/payments/transactionsDb';
import {
  buildZarinpalVerifyBody,
  parseZarinpalVerifyResponse,
  zarinpalApiBase,
} from '../../../../features/payments/zarinpal';
import { getSecret } from '../../../../features/secrets/store';
import { settleWalletTopupOnce, updateWalletTopupStatus } from '../../../../features/wallet/db';

async function resolveOrderToken(orderPublicId: string): Promise<string> {
  const access = await getGuestAccess(env.DB, orderPublicId);
  return access?.access_token ?? orderPublicId;
}

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const ptxId = (url.searchParams.get('ptx') ?? '').trim();
  const authority = (url.searchParams.get('Authority') ?? url.searchParams.get('authority') ?? '').trim();
  const statusParam = (url.searchParams.get('Status') ?? url.searchParams.get('status') ?? '').trim();

  const tx = ptxId
    ? await getPaymentTxByPublicId(env.DB, ptxId)
    : authority
      ? await getPaymentTxByAuthority(env.DB, 'zarinpal', authority)
      : null;

  if (!tx || tx.method !== 'zarinpal') {
    return redirect('/cart?error=' + encodeURIComponent('تراکنش زرین‌پال یافت نشد.'), 303);
  }

  const orderToken = tx.target_type === 'order' ? await resolveOrderToken(tx.target_public_id) : '';
  const failureDestination =
    tx.target_type === 'wallet_topup'
      ? `/account/wallet?error=${encodeURIComponent('پرداخت در درگاه زرین‌پال لغو شد یا ناموفق بود.')}`
      : `/pay/${orderToken}?error=${encodeURIComponent('پرداخت در درگاه زرین‌پال لغو شد یا ناموفق بود.')}`;

  // Replay guard: if already verified, idempotently redirect to destination
  if (tx.status === 'VERIFIED') {
    if (tx.target_type === 'wallet_topup') {
      await settleWalletTopupOnce(env.DB, tx.target_public_id, 'gateway', 'zarinpal_callback');
      return redirect('/account/wallet?success=topup_verified', 303);
    }
    return redirect(`/order/${orderToken}`, 303);
  }

  // Never trust query params alone to mark verified; if Status !== OK, mark cancelled
  if (statusParam.toUpperCase() !== 'OK' || !authority) {
    await transitionPaymentTxStatus(env.DB, tx.public_id, 'CANCELLED', {
      failureReason: 'لغو توسط کاربر یا بازگشت ناموفق از درگاه زرین‌پال',
    });
    if (tx.target_type === 'wallet_topup') {
      await updateWalletTopupStatus(env.DB, tx.target_public_id, 'cancelled');
    }
    return redirect(failureDestination, 303);
  }

  // Verify authority matches the initiated transaction if one was stored
  if (tx.authority_or_track_id && tx.authority_or_track_id !== authority) {
    return redirect(failureDestination, 303);
  }

  const sandbox = locals.settings?.zarinpalSandbox ?? false;
  const vaultMerchant = await getSecret(env.DB, 'zarinpal_merchant_id');
  const merchantId =
    vaultMerchant?.trim() || (sandbox ? '00000000-0000-0000-0000-000000000000' : '');

  if (!merchantId) {
    return redirect(failureDestination, 303);
  }

  const verifyUrl = `${zarinpalApiBase(sandbox)}/pg/v4/payment/verify.json`;
  const verifyBody = buildZarinpalVerifyBody({
    merchantId,
    authority,
    amount: tx.amount,
  });

  let rawResponse: unknown;
  try {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(verifyBody),
    });
    rawResponse = await res.json();
  } catch (err) {
    console.error('[GarGift+] Zarinpal verify HTTP error:', err);
    return redirect(
      tx.target_type === 'wallet_topup'
        ? `/account/wallet?error=${encodeURIComponent('خطا در ارتباط با سرور تایید زرین‌پال. لطفاً مجدداً بررسی کنید.')}`
        : `/pay/${orderToken}?error=${encodeURIComponent('خطا در ارتباط با سرور تایید زرین‌پال.')}`,
      303,
    );
  }

  const parsed = parseZarinpalVerifyResponse(rawResponse);
  if (!parsed.ok) {
    await transitionPaymentTxStatus(env.DB, tx.public_id, 'FAILED', {
      failureReason: `${parsed.code}: ${parsed.message}`,
    });
    if (tx.target_type === 'wallet_topup') {
      await updateWalletTopupStatus(env.DB, tx.target_public_id, 'failed');
    }
    return redirect(failureDestination, 303);
  }

  // Claim verified status atomically with amount/currency/replay check
  const claim = await claimPaymentTxVerified(env.DB, tx.public_id, {
    amount: tx.amount,
    currency: tx.currency,
    refId: parsed.refId,
    cardPan: parsed.cardPan,
  });

  if (!claim.ok) {
    return redirect(failureDestination, 303);
  }

  if (tx.target_type === 'wallet_topup') {
    await settleWalletTopupOnce(env.DB, tx.target_public_id, 'gateway', 'zarinpal_verify');
    return redirect('/account/wallet?success=topup_verified', 303);
  }

  const settled = await settlePendingOrderFromTx(
    env.DB,
    claim.tx,
    url.origin,
    locals.settings,
  );
  if (!settled.ok) {
    return redirect(
      `/pay/${orderToken}?error=${encodeURIComponent(settled.error)}`,
      303,
    );
  }

  return redirect(settled.redirectPath, 303);
};
