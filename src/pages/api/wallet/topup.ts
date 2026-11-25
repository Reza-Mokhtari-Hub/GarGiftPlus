import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getVerifiedCustomer } from '../../../features/auth/customer';
import { getStoreSettings } from '../../../features/settings/db';
import { getSecret } from '../../../features/secrets/store';
import { validateTopupAmount } from '../../../features/wallet/rules';
import {
  attachPaymentTxToTopup,
  createWalletTopup,
} from '../../../features/wallet/db';
import {
  createPaymentTransaction,
  markPaymentTxInitiated,
  transitionPaymentTxStatus,
} from '../../../features/payments/transactionsDb';
import {
  buildZarinpalRequestBody,
  parseZarinpalRequestResponse,
  zarinpalApiBase,
} from '../../../features/payments/zarinpal';
import {
  buildZibalRequestBody,
  parseZibalRequestResponse,
  ZIBAL_API_BASE,
} from '../../../features/payments/zibal';
import { countActiveBankAccounts } from '../../../features/payments/bankAccountsDb';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const customer = await getVerifiedCustomer(cookies);
  if (!customer) {
    return redirect('/account/login', 303);
  }

  const settings = await getStoreSettings(env.DB);
  if (!settings.walletEnabled) {
    return redirect(
      `/account/wallet?error=${encodeURIComponent('کیف پول در حال حاضر غیرفعال است.')}`,
      303,
    );
  }

  const form = await request.formData();
  const rawAmount = form.get('amount');
  const method = String(form.get('method') ?? '').trim();

  const amountCheck = validateTopupAmount(
    rawAmount,
    settings.walletMinTopup,
    settings.walletMaxTopup,
  );
  if (!amountCheck.ok) {
    return redirect(`/account/wallet?error=${encodeURIComponent(amountCheck.error)}`, 303);
  }

  if (method !== 'bank_transfer' && method !== 'zarinpal' && method !== 'zibal') {
    return redirect(
      `/account/wallet?error=${encodeURIComponent('روش پرداخت انتخاب‌شده برای شارژ کیف پول معتبر نیست.')}`,
      303,
    );
  }

  const amount = amountCheck.amount;
  const currency = 'irt';
  const origin = url.origin;

  if (method === 'bank_transfer') {
    const activeBanks = await countActiveBankAccounts(env.DB);
    if (!settings.bankTransferEnabled || activeBanks === 0) {
      return redirect(
        `/account/wallet?error=${encodeURIComponent('کارت‌به‌کارت در حال حاضر فعال نیست.')}`,
        303,
      );
    }

    const topup = await createWalletTopup(env.DB, {
      customerId: customer.id,
      amount,
      currency,
      paymentMethod: 'bank_transfer',
      status: 'pending',
    });

    const tx = await createPaymentTransaction(env.DB, {
      targetType: 'wallet_topup',
      targetPublicId: topup.public_id,
      customerId: customer.id,
      customerEmail: customer.email,
      method: 'bank_transfer',
      amount,
      currency,
      status: 'INITIATED',
      idempotencyKey: `topup:bank_transfer:${topup.public_id}`,
    });

    await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id);
    return redirect(`/account/wallet?topup=${encodeURIComponent(topup.public_id)}#topup-bank`, 303);
  }

  if (method === 'zarinpal') {
    const merchantId = await getSecret(env.DB, 'zarinpal_merchant_id');
    if (!merchantId) {
      return redirect(
        `/account/wallet?error=${encodeURIComponent('درگاه زرین‌پال پیکربندی نشده است.')}`,
        303,
      );
    }

    const topup = await createWalletTopup(env.DB, {
      customerId: customer.id,
      amount,
      currency,
      paymentMethod: 'zarinpal',
      status: 'pending',
    });

    const tx = await createPaymentTransaction(env.DB, {
      targetType: 'wallet_topup',
      targetPublicId: topup.public_id,
      customerId: customer.id,
      customerEmail: customer.email,
      method: 'zarinpal',
      amount,
      currency,
      status: 'CREATED',
      idempotencyKey: `topup:zarinpal:${topup.public_id}`,
    });

    await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id);

    const callbackUrl = `${origin}/api/payments/zarinpal/callback?ptx=${encodeURIComponent(tx.public_id)}`;
    const reqBody = buildZarinpalRequestBody({
      merchantId,
      amount,
      currency,
      callbackUrl,
      description: `شارژ کیف پول GarGift+ (${topup.public_id})`,
      orderId: tx.public_id,
      email: customer.email,
      mobile: customer.phone,
    });

    try {
      const res = await fetch(
        `${zarinpalApiBase(settings.zarinpalSandbox)}/pg/v4/payment/request.json`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(reqBody),
        },
      );
      const parsed = parseZarinpalRequestResponse(await res.json(), settings.zarinpalSandbox);
      if (!parsed.ok) {
        await transitionPaymentTxStatus(env.DB, tx.public_id, 'FAILED', {
          failureReason: parsed.message,
        });
        await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id, 'failed');
        return redirect(`/account/wallet?error=${encodeURIComponent(parsed.message)}`, 303);
      }
      await markPaymentTxInitiated(env.DB, tx.public_id, parsed.authority);
      return redirect(parsed.startPayUrl, 303);
    } catch {
      await transitionPaymentTxStatus(env.DB, tx.public_id, 'FAILED', {
        failureReason: 'خطای شبکه در اتصال به درگاه زرین‌پال',
      });
      await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id, 'failed');
      return redirect(
        `/account/wallet?error=${encodeURIComponent('خطا در اتصال به درگاه زرین‌پال. لطفاً مجدداً تلاش کنید.')}`,
        303,
      );
    }
  }

  // method === 'zibal'
  const zibalMerchant =
    (await getSecret(env.DB, 'zibal_merchant_id')) ||
    (settings.zibalSandbox ? 'zibal' : null);
  if (!zibalMerchant) {
    return redirect(
      `/account/wallet?error=${encodeURIComponent('درگاه زیبال پیکربندی نشده است.')}`,
      303,
    );
  }

  const topup = await createWalletTopup(env.DB, {
    customerId: customer.id,
    amount,
    currency,
    paymentMethod: 'zibal',
    status: 'pending',
  });

  const tx = await createPaymentTransaction(env.DB, {
    targetType: 'wallet_topup',
    targetPublicId: topup.public_id,
    customerId: customer.id,
    customerEmail: customer.email,
    method: 'zibal',
    amount,
    currency,
    status: 'CREATED',
    idempotencyKey: `topup:zibal:${topup.public_id}`,
  });

  await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id);

  const callbackUrl = `${origin}/api/payments/zibal/callback?ptx=${encodeURIComponent(tx.public_id)}`;
  const reqBody = buildZibalRequestBody({
    merchant: settings.zibalSandbox ? 'zibal' : zibalMerchant,
    amount,
    currency,
    callbackUrl,
    description: `شارژ کیف پول GarGift+ (${topup.public_id})`,
    orderId: tx.public_id,
    mobile: customer.phone,
  });

  try {
    const res = await fetch(`${ZIBAL_API_BASE}/v1/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(reqBody),
    });
    const parsed = parseZibalRequestResponse(await res.json());
    if (!parsed.ok) {
      await transitionPaymentTxStatus(env.DB, tx.public_id, 'FAILED', {
        failureReason: parsed.message,
      });
      await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id, 'failed');
      return redirect(`/account/wallet?error=${encodeURIComponent(parsed.message)}`, 303);
    }
    await markPaymentTxInitiated(env.DB, tx.public_id, parsed.trackId, reqBody.amount);
    return redirect(parsed.startPayUrl, 303);
  } catch {
    await transitionPaymentTxStatus(env.DB, tx.public_id, 'FAILED', {
      failureReason: 'خطای شبکه در اتصال به درگاه زیبال',
    });
    await attachPaymentTxToTopup(env.DB, topup.public_id, tx.public_id, 'failed');
    return redirect(
      `/account/wallet?error=${encodeURIComponent('خطا در اتصال به درگاه زیبال. لطفاً مجدداً تلاش کنید.')}`,
      303,
    );
  }
};
