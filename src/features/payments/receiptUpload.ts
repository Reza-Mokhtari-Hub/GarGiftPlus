import type { AstroCookies } from 'astro';
import { env } from 'cloudflare:workers';
import { getVerifiedCustomer } from '../auth/customer';
import { generatePublicId } from '../ids/publicId';
import { resolveAccessToken } from '../orders/guestAccess';
import { getBankAccountByPublicId } from './bankAccountsDb';
import { buildReceiptObjectKey, validateReceiptBytes } from './bankTransfer';
import { getPendingByPublicId } from './lightning/pending';
import { recordBankTransferReceipt } from './receiptsDb';
import { getPaymentTxByPublicId } from './transactionsDb';
import { getFileStorage } from '../storage';
import { updateWalletTopupStatus } from '../wallet/db';

function safeReturnPath(raw: string | null | undefined, fallback: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback;
  return trimmed;
}

function appendQuery(basePath: string, params: Record<string, string>): string {
  const url = new URL(basePath, 'http://localhost');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return `${url.pathname}${url.search}`;
}

export async function handleBankTransferReceiptPost(
  request: Request,
  cookies: AstroCookies,
  fallbackReturnPath: string,
): Promise<{ redirectTo: string } | { badRequest: string }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { badRequest: 'فرم ارسالی نامعتبر است.' };
  }

  const paymentTxPublicId = String(form.get('payment_tx_id') ?? '').trim();
  const returnPath = safeReturnPath(
    typeof form.get('return_url') === 'string' ? (form.get('return_url') as string) : null,
    fallbackReturnPath,
  );

  if (!paymentTxPublicId) {
    return { redirectTo: appendQuery(returnPath, { error: 'شناسه تراکنش پرداخت یافت نشد.' }) };
  }

  const tx = await getPaymentTxByPublicId(env.DB, paymentTxPublicId);
  if (!tx || tx.method !== 'bank_transfer') {
    return { redirectTo: appendQuery(returnPath, { error: 'تراکنش کارت‌به‌کارت معتبر یافت نشد.' }) };
  }

  if (tx.status === 'VERIFIED') {
    return { redirectTo: appendQuery(returnPath, { success: 'already_verified' }) };
  }

  if (tx.status !== 'INITIATED' && tx.status !== 'CREATED' && tx.status !== 'FAILED') {
    return {
      redirectTo: appendQuery(returnPath, {
        error:
          tx.status === 'PAYMENT_REVIEW'
            ? 'فیش واریزی شما قبلاً ثبت شده و در صف بررسی کارشناس قرار دارد.'
            : 'وضعیت این تراکنش اجازه ثبت فیش جدید را نمی‌دهد.',
      }),
    };
  }

  const customer = await getVerifiedCustomer(cookies);

  if (tx.target_type === 'wallet_topup') {
    if (!customer || (tx.customer_id !== null && tx.customer_id !== customer.id)) {
      return { redirectTo: '/account/login?redirect=/account/wallet' };
    }
  } else if (tx.target_type === 'order') {
    const orderToken = String(form.get('order_token') ?? '').trim();
    let authorizedOrder = false;
    if (
      customer &&
      (tx.customer_id === customer.id ||
        (tx.customer_email && tx.customer_email.toLowerCase() === customer.email.toLowerCase()))
    ) {
      authorizedOrder = true;
    }
    if (!authorizedOrder && orderToken) {
      const access = await resolveAccessToken(env.DB, orderToken);
      const lookupId = access?.order_public_id ?? orderToken;
      if (lookupId === tx.target_public_id) {
        authorizedOrder = true;
      } else {
        const pending = await getPendingByPublicId(env.DB, lookupId);
        if (pending && pending.public_id === tx.target_public_id) {
          authorizedOrder = true;
        }
      }
    }
    if (!authorizedOrder) {
      return { redirectTo: appendQuery(returnPath, { error: 'دسترسی به این سفارش مجاز نیست.' }) };
    }
  }

  const fileEntry = form.get('receipt');
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return { redirectTo: appendQuery(returnPath, { error: 'لطفاً فایل تصویر فیش واریزی را انتخاب کنید.' }) };
  }

  const bytes = new Uint8Array(await fileEntry.arrayBuffer());
  const validation = validateReceiptBytes(bytes, fileEntry.type);
  if (!validation.ok) {
    return { redirectTo: appendQuery(returnPath, { error: validation.error }) };
  }

  const bankAccountPublicId = String(form.get('bank_account_id') ?? '').trim();
  const bankAccount = bankAccountPublicId
    ? await getBankAccountByPublicId(env.DB, bankAccountPublicId)
    : null;
  const trackingCode = String(form.get('tracking_code') ?? '')
    .trim()
    .slice(0, 80);
  const depositorNote = String(form.get('customer_note') ?? '')
    .trim()
    .slice(0, 300);

  const receiptPublicId = generatePublicId('receipt');
  const objectKey = buildReceiptObjectKey(receiptPublicId, validation.sniffed.ext);

  try {
    await getFileStorage().put(objectKey, bytes.buffer as ArrayBuffer, validation.sniffed.mime, {
      cacheControl: 'private, no-store',
    });

    await recordBankTransferReceipt(env.DB, {
      receiptPublicId,
      paymentTxId: tx.id,
      targetType: tx.target_type,
      targetPublicId: tx.target_public_id,
      customerId: customer?.id ?? tx.customer_id ?? null,
      customerEmail: customer?.email ?? tx.customer_email ?? null,
      bankAccountId: bankAccount?.id ?? null,
      amount: tx.amount,
      currency: tx.currency,
      r2ObjectKey: objectKey,
      mimeType: validation.sniffed.mime,
      sizeBytes: bytes.byteLength,
      trackingCode: trackingCode || depositorNote || null,
    });

    if (tx.target_type === 'wallet_topup') {
      await updateWalletTopupStatus(env.DB, tx.target_public_id, 'payment_review');
    }
  } catch (err) {
    console.error('[GarGift+] Bank receipt upload failed:', err);
    return {
      redirectTo: appendQuery(returnPath, {
        error: 'خطا در ذخیره تصویر فیش واریزی. لطفاً دوباره تلاش کنید.',
      }),
    };
  }

  return { redirectTo: appendQuery(returnPath, { success: 'receipt_submitted' }) };
}
