import type { D1Database } from '@cloudflare/workers-types';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  WebhookResult,
} from './provider';
import { createPendingPayment, getPendingByPublicId, pendingToPaidOrder } from './lightning/pending';
import {
  createPaymentTransaction,
  markPaymentTxInitiated,
  transitionPaymentTxStatus,
  type PaymentTransactionRow,
} from './transactionsDb';
import {
  buildZarinpalRequestBody,
  parseZarinpalRequestResponse,
  zarinpalApiBase,
} from './zarinpal';
import {
  buildZibalRequestBody,
  parseZibalRequestResponse,
  ZIBAL_API_BASE,
} from './zibal';
import { recordPaidWebhookOrder } from '../orders/recordWebhook';
import type { StoreSettings } from '../settings/db';
import { getGuestAccess } from '../orders/guestAccess';

export const BANK_TRANSFER_TTL_SECONDS = 48 * 60 * 60; // 48 hours
export const IRAN_GATEWAY_TTL_SECONDS = 30 * 60; // 30 minutes

export function createBankTransferProvider(db: D1Database): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const subtotal = params.lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0);
      const shippingCents = params.selectedShipping?.amountCents ?? 0;
      const total = subtotal + shippingCents;
      const currency = (params.lineItems[0]?.currency ?? 'irt').toLowerCase();
      const publicId = params.metadata?.public_id ?? crypto.randomUUID();
      const customerEmail =
        params.selectedShipping?.email ?? params.metadata?.customer_email ?? null;
      const customerId = params.metadata?.customer_id
        ? Number(params.metadata.customer_id)
        : null;

      await createPendingPayment(db, {
        publicId,
        paymentHash: `bt_${publicId}`,
        backend: 'bank_transfer',
        bolt11: null,
        amountSat: null,
        amountTotalCents: total,
        currency,
        email: customerEmail,
        itemsJson: params.orderItemsJson ?? null,
        shippingCents,
        shippingLabel: params.selectedShipping?.label ?? null,
        shippingWeightGrams: params.selectedShipping?.weightGrams ?? null,
        deliveryMethod: params.selectedShipping?.deliveryMethod ?? null,
        shipAddressJson: params.selectedShipping
          ? JSON.stringify(params.selectedShipping.address)
          : null,
        reservationId: params.metadata?.reservation_id ?? null,
        expiresAt: new Date(Date.now() + BANK_TRANSFER_TTL_SECONDS * 1000).toISOString(),
      });

      await createPaymentTransaction(db, {
        targetType: 'order',
        targetPublicId: publicId,
        customerId: Number.isFinite(customerId) ? customerId : null,
        customerEmail,
        method: 'bank_transfer',
        amount: total,
        currency,
        status: 'INITIATED',
        idempotencyKey: `order:bank_transfer:${publicId}`,
        payload: {
          accessToken: params.accessToken ?? null,
        },
      });

      return { url: new URL(`/pay/${params.accessToken ?? publicId}`, params.successUrl).href };
    },

    async verifyWebhook(): Promise<WebhookResult> {
      throw new Error('Bank transfer settles via admin receipt verification.');
    },
  };
}

export function createZarinpalProvider(
  db: D1Database,
  merchantId: string,
  sandbox: boolean,
): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const subtotal = params.lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0);
      const shippingCents = params.selectedShipping?.amountCents ?? 0;
      const total = subtotal + shippingCents;
      const currency = (params.lineItems[0]?.currency ?? 'irt').toLowerCase();
      const publicId = params.metadata?.public_id ?? crypto.randomUUID();
      const customerEmail =
        params.selectedShipping?.email ?? params.metadata?.customer_email ?? null;
      const customerId = params.metadata?.customer_id
        ? Number(params.metadata.customer_id)
        : null;
      const origin = new URL(params.successUrl).origin;

      await createPendingPayment(db, {
        publicId,
        paymentHash: `zp_${publicId}`,
        backend: 'zarinpal',
        bolt11: null,
        amountSat: null,
        amountTotalCents: total,
        currency,
        email: customerEmail,
        itemsJson: params.orderItemsJson ?? null,
        shippingCents,
        shippingLabel: params.selectedShipping?.label ?? null,
        shippingWeightGrams: params.selectedShipping?.weightGrams ?? null,
        deliveryMethod: params.selectedShipping?.deliveryMethod ?? null,
        shipAddressJson: params.selectedShipping
          ? JSON.stringify(params.selectedShipping.address)
          : null,
        reservationId: params.metadata?.reservation_id ?? null,
        expiresAt: new Date(Date.now() + IRAN_GATEWAY_TTL_SECONDS * 1000).toISOString(),
      });

      const tx = await createPaymentTransaction(db, {
        targetType: 'order',
        targetPublicId: publicId,
        customerId: Number.isFinite(customerId) ? customerId : null,
        customerEmail,
        method: 'zarinpal',
        amount: total,
        currency,
        status: 'CREATED',
        idempotencyKey: `order:zarinpal:${publicId}`,
        payload: {
          accessToken: params.accessToken ?? null,
        },
      });

      const callbackUrl = `${origin}/api/payments/zarinpal/callback?ptx=${encodeURIComponent(tx.public_id)}`;
      const reqBody = buildZarinpalRequestBody({
        merchantId,
        amount: total,
        currency,
        callbackUrl,
        description: `پرداخت سفارش ${publicId} در GarGift+`,
        orderId: tx.public_id,
        email: customerEmail,
      });

      let parsed;
      try {
        const res = await fetch(`${zarinpalApiBase(sandbox)}/pg/v4/payment/request.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const json = await res.json();
        parsed = parseZarinpalRequestResponse(json, sandbox);
      } catch (err) {
        await transitionPaymentTxStatus(db, tx.public_id, 'FAILED', {
          failureReason: err instanceof Error ? err.message : 'Network error calling Zarinpal',
        });
        throw new Error('خطا در برقراری ارتباط با درگاه زرین‌پال.');
      }

      if (!parsed.ok) {
        await transitionPaymentTxStatus(db, tx.public_id, 'FAILED', {
          failureReason: `${parsed.code}: ${parsed.message}`,
        });
        throw new Error(parsed.message);
      }

      await markPaymentTxInitiated(db, tx.public_id, parsed.authority);
      return { url: parsed.startPayUrl };
    },

    async verifyWebhook(): Promise<WebhookResult> {
      throw new Error('Zarinpal uses callback verification (/api/payments/zarinpal/callback).');
    },
  };
}

export function createZibalProvider(
  db: D1Database,
  merchant: string,
  sandbox: boolean,
): PaymentProvider {
  const effectiveMerchant = sandbox ? 'zibal' : merchant;
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const subtotal = params.lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0);
      const shippingCents = params.selectedShipping?.amountCents ?? 0;
      const total = subtotal + shippingCents;
      const currency = (params.lineItems[0]?.currency ?? 'irt').toLowerCase();
      const publicId = params.metadata?.public_id ?? crypto.randomUUID();
      const customerEmail =
        params.selectedShipping?.email ?? params.metadata?.customer_email ?? null;
      const customerId = params.metadata?.customer_id
        ? Number(params.metadata.customer_id)
        : null;
      const origin = new URL(params.successUrl).origin;

      await createPendingPayment(db, {
        publicId,
        paymentHash: `zb_${publicId}`,
        backend: 'zibal',
        bolt11: null,
        amountSat: null,
        amountTotalCents: total,
        currency,
        email: customerEmail,
        itemsJson: params.orderItemsJson ?? null,
        shippingCents,
        shippingLabel: params.selectedShipping?.label ?? null,
        shippingWeightGrams: params.selectedShipping?.weightGrams ?? null,
        deliveryMethod: params.selectedShipping?.deliveryMethod ?? null,
        shipAddressJson: params.selectedShipping
          ? JSON.stringify(params.selectedShipping.address)
          : null,
        reservationId: params.metadata?.reservation_id ?? null,
        expiresAt: new Date(Date.now() + IRAN_GATEWAY_TTL_SECONDS * 1000).toISOString(),
      });

      const tx = await createPaymentTransaction(db, {
        targetType: 'order',
        targetPublicId: publicId,
        customerId: Number.isFinite(customerId) ? customerId : null,
        customerEmail,
        method: 'zibal',
        amount: total,
        currency,
        status: 'CREATED',
        idempotencyKey: `order:zibal:${publicId}`,
        payload: {
          accessToken: params.accessToken ?? null,
        },
      });

      const callbackUrl = `${origin}/api/payments/zibal/callback?ptx=${encodeURIComponent(tx.public_id)}`;
      const reqBody = buildZibalRequestBody({
        merchant: effectiveMerchant,
        amount: total,
        currency,
        callbackUrl,
        description: `پرداخت سفارش ${publicId} در GarGift+`,
        orderId: tx.public_id,
      });

      let parsed;
      try {
        const res = await fetch(`${ZIBAL_API_BASE}/v1/request`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(reqBody),
        });
        const json = await res.json();
        parsed = parseZibalRequestResponse(json);
      } catch (err) {
        await transitionPaymentTxStatus(db, tx.public_id, 'FAILED', {
          failureReason: err instanceof Error ? err.message : 'Network error calling Zibal',
        });
        throw new Error('خطا در برقراری ارتباط با درگاه زیبال.');
      }

      if (!parsed.ok) {
        await transitionPaymentTxStatus(db, tx.public_id, 'FAILED', {
          failureReason: `${parsed.result}: ${parsed.message}`,
        });
        throw new Error(parsed.message);
      }

      await markPaymentTxInitiated(db, tx.public_id, parsed.trackId, reqBody.amount);
      return { url: parsed.startPayUrl };
    },

    async verifyWebhook(): Promise<WebhookResult> {
      throw new Error('Zibal uses callback verification (/api/payments/zibal/callback).');
    },
  };
}

/**
 * تسویه نهایی سفارش از روی یک payment_transactions تاییدشده (درگاه یا کارت‌به‌کارت).
 */
export async function settlePendingOrderFromTx(
  db: D1Database,
  tx: PaymentTransactionRow,
  origin: string,
  settings?: StoreSettings,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<{ ok: true; redirectPath: string } | { ok: false; error: string }> {
  const pending = await getPendingByPublicId(db, tx.target_public_id);
  if (!pending) {
    return { ok: false, error: 'اطلاعات سفارش در انتظار پرداخت یافت نشد.' };
  }
  const email = tx.customer_email || pending.email || 'customer@gargift.local';
  const orderInput = {
    ...pendingToPaidOrder(pending),
    email,
    providerPaymentId: tx.ref_id ?? tx.public_id,
  };

  await recordPaidWebhookOrder(
    {
      type: `${tx.method}.verified`,
      order: orderInput,
    },
    origin,
    tx.method,
    settings,
    waitUntil,
  );

  if (tx.customer_id) {
    await db
      .prepare(
        `UPDATE orders
            SET customer_id = COALESCE(customer_id, ?),
                payment_status = 'VERIFIED'
          WHERE public_id = ?`,
      )
      .bind(tx.customer_id, pending.public_id)
      .run();
  } else {
    await db
      .prepare(`UPDATE orders SET payment_status = 'VERIFIED' WHERE public_id = ?`)
      .bind(pending.public_id)
      .run();
  }

  let accessToken: string | null = null;
  if (tx.payload_json) {
    try {
      const payload = JSON.parse(tx.payload_json) as { accessToken?: string | null };
      accessToken = payload.accessToken ?? null;
    } catch {
      accessToken = null;
    }
  }
  if (!accessToken) {
    const guest = await getGuestAccess(db, pending.public_id);
    accessToken = guest?.access_token ?? null;
  }
  return {
    ok: true,
    redirectPath: accessToken ? `/order/${accessToken}` : `/account/orders`,
  };
}
