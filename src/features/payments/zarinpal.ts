import { assertValidIntegerAmount, normalizeCurrencyCode } from '../currency/iran';

export function zarinpalApiBase(sandbox: boolean): string {
  return sandbox ? 'https://sandbox.zarinpal.com' : 'https://api.zarinpal.com';
}

export function zarinpalStartPayUrl(authority: string, sandbox: boolean): string {
  const safeAuth = encodeURIComponent(authority.trim());
  return sandbox
    ? `https://sandbox.zarinpal.com/pg/StartPay/${safeAuth}`
    : `https://www.zarinpal.com/pg/StartPay/${safeAuth}`;
}

export interface ZarinpalRequestInput {
  merchantId: string;
  amount: number;
  currency: string;
  callbackUrl: string;
  description: string;
  orderId?: string;
  email?: string | null;
  mobile?: string | null;
}

export function resolveZarinpalCurrency(currency: string): 'IRT' | 'IRR' {
  const c = normalizeCurrencyCode(currency, '');
  if (c === 'irt') return 'IRT';
  if (c === 'irr') return 'IRR';
  throw new Error(`Zarinpal requires IRT or IRR currency, received: ${currency}`);
}

export function buildZarinpalRequestBody(input: ZarinpalRequestInput) {
  const zpCurrency = resolveZarinpalCurrency(input.currency);
  const minAmount = zpCurrency === 'IRT' ? 1000 : 10000;
  const amount = assertValidIntegerAmount(input.amount, { min: minAmount, label: 'zarinpalAmount' });
  const merchantId = input.merchantId.trim();
  if (!merchantId) throw new Error('Zarinpal merchantId is required');

  const metadata: Record<string, string> = {};
  if (input.orderId) metadata.order_id = input.orderId;
  if (input.email) metadata.email = input.email.trim();
  if (input.mobile) metadata.mobile = input.mobile.trim();

  return {
    merchant_id: merchantId,
    amount,
    currency: zpCurrency,
    callback_url: input.callbackUrl,
    description: input.description.slice(0, 255),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

export type ZarinpalRequestParsed =
  | { ok: true; authority: string; startPayUrl: string; fee: number }
  | { ok: false; code: number; message: string };

export function parseZarinpalRequestResponse(
  raw: unknown,
  sandbox: boolean,
): ZarinpalRequestParsed {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const data =
    obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
  if (data && Number(data.code) === 100 && typeof data.authority === 'string' && data.authority) {
    const authority = data.authority.trim();
    return {
      ok: true,
      authority,
      startPayUrl: zarinpalStartPayUrl(authority, sandbox),
      fee: typeof data.fee === 'number' ? data.fee : 0,
    };
  }
  const errors =
    obj.errors && typeof obj.errors === 'object' && !Array.isArray(obj.errors)
      ? (obj.errors as Record<string, unknown>)
      : null;
  const code = Number(errors?.code ?? data?.code ?? -1);
  const message = String(errors?.message ?? data?.message ?? 'خطا در اتصال به درگاه زرین‌پال');
  return { ok: false, code: Number.isFinite(code) ? code : -1, message };
}

export function buildZarinpalVerifyBody(params: {
  merchantId: string;
  authority: string;
  amount: number;
}) {
  const amount = assertValidIntegerAmount(params.amount, { min: 1000, label: 'verifyAmount' });
  const merchantId = params.merchantId.trim();
  const authority = params.authority.trim();
  if (!merchantId || !authority) {
    throw new Error('Zarinpal verify requires merchantId and authority');
  }
  return {
    merchant_id: merchantId,
    amount,
    authority,
  };
}

export type ZarinpalVerifyParsed =
  | {
      ok: true;
      code: 100 | 101;
      alreadyVerified: boolean;
      refId: string;
      cardPan: string | null;
      fee: number;
    }
  | { ok: false; code: number; message: string };

export function parseZarinpalVerifyResponse(raw: unknown): ZarinpalVerifyParsed {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const data =
    obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
  const code = Number(data?.code ?? -1);
  if (data && (code === 100 || code === 101)) {
    return {
      ok: true,
      code,
      alreadyVerified: code === 101,
      refId: String(data.ref_id ?? ''),
      cardPan: typeof data.card_pan === 'string' ? data.card_pan : null,
      fee: typeof data.fee === 'number' ? data.fee : 0,
    };
  }
  const errors =
    obj.errors && typeof obj.errors === 'object' && !Array.isArray(obj.errors)
      ? (obj.errors as Record<string, unknown>)
      : null;
  const errCode = Number(errors?.code ?? data?.code ?? -1);
  const message = String(errors?.message ?? data?.message ?? 'تایید تراکنش زرین‌پال ناموفق بود');
  return { ok: false, code: Number.isFinite(errCode) ? errCode : -1, message };
}
