import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { resolveGatewayRialAmount } from '../../../../features/currency/iran';
import { getGuestAccess } from '../../../../features/orders/guestAccess';
import { settlePendingOrderFromTx } from '../../../../features/payments/iranProviders';
import {
  claimPaymentTxVerified,
  getPaymentTxByAuthority,
  getPaymentTxByPublicId,
  transitionPaymentTxStatus,
} from '../../../../features/payments/transactionsDb';
import {
  buildZibalVerifyBody,
  parseZibalVerifyResponse,
  ZIBAL_API_BASE,
} from '../../../../features/payments/zibal';
import { getSecret } from '../../../../features/secrets/store';
import { settleWalletTopupOnce, updateWalletTopupStatus } from '../../../../features/wallet/db';
import { gatewayCallbackOrigin } from '../../../../features/http/origin';

async function resolveOrderToken(orderPublicId: string): Promise<string> {
  const access = await getGuestAccess(env.DB, orderPublicId);
  return access?.access_token ?? orderPublicId;
}

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const ptxId = (url.searchParams.get('ptx') ?? '').trim();
  const trackId = (url.searchParams.get('trackId') ?? url.searchParams.get('track_id') ?? '').trim();
  const successParam = (url.searchParams.get('success') ?? '').trim();

  const tx = ptxId
    ? await getPaymentTxByPublicId(env.DB, ptxId)
    : trackId
      ? await getPaymentTxByAuthority(env.DB, 'zibal', trackId)
      : null;

  if (!tx || tx.method !== 'zibal') {
    return redirect('/cart?error=' + encodeURIComponent('تراکنش زیبال یافت نشد.'), 303);
  }

  const orderToken = tx.target_type === 'order' ? await resolveOrderToken(tx.target_public_id) : '';
  const failureDestination =
    tx.target_type === 'wallet_topup'
      ? `/account/wallet?error=${encodeURIComponent('پرداخت در درگاه زیبال لغو شد یا ناموفق بود.')}`
      : `/pay/${orderToken}?error=${encodeURIComponent('پرداخت در درگاه زیبال لغو شد یا ناموفق بود.')}`;

  if (tx.status === 'VERIFIED') {
    if (tx.target_type === 'wallet_topup') {
      await settleWalletTopupOnce(env.DB, tx.target_public_id, 'gateway', 'zibal_callback');
      return redirect('/account/wallet?success=topup_verified', 303);
    }
    return redirect(`/order/${orderToken}`, 303);
  }

  if (tx.authority_or_track_id && trackId && tx.authority_or_track_id !== trackId) {
    return redirect(failureDestination, 303);
  }

  if (successParam !== '1' || !trackId) {
    await transitionPaymentTxStatus(env.DB, tx.public_id, 'CANCELLED', {
      failureReason: 'لغو توسط کاربر یا بازگشت ناموفق از درگاه زیبال',
    });
    if (tx.target_type === 'wallet_topup') {
      await updateWalletTopupStatus(env.DB, tx.target_public_id, 'cancelled');
    }
    return redirect(failureDestination, 303);
  }

  const sandbox = locals.settings?.zibalSandbox ?? false;
  const vaultMerchant = await getSecret(env.DB, 'zibal_merchant_id');
  const merchant = vaultMerchant?.trim() || (sandbox ? 'zibal' : '');
  if (!merchant) {
    return redirect(failureDestination, 303);
  }

  const verifyBody = buildZibalVerifyBody({ merchant, trackId });
  let rawResponse: unknown;
  try {
    const res = await fetch(`${ZIBAL_API_BASE}/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(verifyBody),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 500) throw new Error(`Zibal verify HTTP ${res.status}`);
    rawResponse = await res.json();
  } catch (err) {
    console.error('[GarGift+] Zibal verify HTTP error:', err);
    return redirect(
      tx.target_type === 'wallet_topup'
        ? `/account/wallet?error=${encodeURIComponent('خطا در ارتباط با سرور تایید زیبال.')}`
        : `/pay/${orderToken}?error=${encodeURIComponent('خطا در ارتباط با سرور تایید زیبال.')}`,
      303,
    );
  }

  const expectedRial =
    tx.gateway_amount_rial ?? resolveGatewayRialAmount(tx.amount, tx.currency);
  const parsed = parseZibalVerifyResponse(rawResponse, expectedRial);

  if (!parsed.ok) {
    await transitionPaymentTxStatus(env.DB, tx.public_id, 'FAILED', {
      failureReason: `${parsed.result}: ${parsed.message}`,
    });
    if (tx.target_type === 'wallet_topup') {
      await updateWalletTopupStatus(env.DB, tx.target_public_id, 'failed');
    }
    return redirect(failureDestination, 303);
  }

  const claim = await claimPaymentTxVerified(env.DB, tx.public_id, {
    amount: tx.amount,
    currency: tx.currency,
    refId: parsed.refNumber,
    cardPan: parsed.cardNumber,
  });

  if (!claim.ok) {
    return redirect(failureDestination, 303);
  }

  if (tx.target_type === 'wallet_topup') {
    await settleWalletTopupOnce(env.DB, tx.target_public_id, 'gateway', 'zibal_verify');
    return redirect('/account/wallet?success=topup_verified', 303);
  }

  const settled = await settlePendingOrderFromTx(
    env.DB,
    claim.tx,
    gatewayCallbackOrigin(url, env.CANONICAL_ORIGIN),
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
