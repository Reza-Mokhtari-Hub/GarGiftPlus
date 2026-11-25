import { resolveGatewayRialAmount } from '../currency/iran';

export const ZIBAL_API_BASE = 'https://gateway.zibal.ir';

export function zibalStartPayUrl(trackId: string | number): string {
  return `${ZIBAL_API_BASE}/start/${encodeURIComponent(String(trackId))}`;
}

export interface ZibalRequestInput {
  merchant: string;
  amount: number;
  currency: string;
  callbackUrl: string;
  description: string;
  orderId?: string;
  mobile?: string | null;
}

export function buildZibalRequestBody(input: ZibalRequestInput) {
  const merchant = input.merchant.trim();
  if (!merchant) throw new Error('Zibal merchant is required');
  // زیبال همیشه مبلغ را بر حسب ریال تمام‌صحیح دریافت می‌کند
  const amountRial = resolveGatewayRialAmount(input.amount, input.currency);
  if (amountRial < 10000) {
    throw new RangeError('Zibal minimum amount is 10,000 IRR (1,000 IRT)');
  }
  return {
    merchant,
    amount: amountRial,
    callbackUrl: input.callbackUrl,
    description: input.description.slice(0, 255),
    ...(input.orderId ? { orderId: input.orderId } : {}),
    ...(input.mobile ? { mobile: input.mobile.trim() } : {}),
  };
}

export type ZibalRequestParsed =
  | { ok: true; trackId: string; startPayUrl: string }
  | { ok: false; result: number; message: string };

export function parseZibalRequestResponse(raw: unknown): ZibalRequestParsed {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = Number(obj.result ?? -1);
  if (result === 100 && obj.trackId != null) {
    const trackId = String(obj.trackId);
    return {
      ok: true,
      trackId,
      startPayUrl: zibalStartPayUrl(trackId),
    };
  }
  return {
    ok: false,
    result: Number.isFinite(result) ? result : -1,
    message: String(obj.message ?? 'خطا در اتصال به درگاه زیبال'),
  };
}

export function buildZibalVerifyBody(params: { merchant: string; trackId: string | number }) {
  const merchant = params.merchant.trim();
  const trackId = String(params.trackId).trim();
  if (!merchant || !trackId) {
    throw new Error('Zibal verify requires merchant and trackId');
  }
  return {
    merchant,
    trackId: /^\d+$/.test(trackId) ? Number(trackId) : trackId,
  };
}

export type ZibalVerifyParsed =
  | {
      ok: true;
      result: 100 | 201;
      alreadyVerified: boolean;
      amountRial: number;
      refNumber: string;
      cardNumber: string | null;
      orderId: string | null;
      paidAt: string | null;
    }
  | { ok: false; result: number; message: string };

export function parseZibalVerifyResponse(
  raw: unknown,
  expectedAmountRial: number,
): ZibalVerifyParsed {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result = Number(obj.result ?? -1);
  if (result !== 100 && result !== 201) {
    return {
      ok: false,
      result: Number.isFinite(result) ? result : -1,
      message: String(obj.message ?? 'تایید تراکنش زیبال ناموفق بود'),
    };
  }
  const amountRial = Number(obj.amount ?? -1);
  if (!Number.isSafeInteger(amountRial) || amountRial !== expectedAmountRial) {
    return {
      ok: false,
      result: -200,
      message: 'مبلغ تاییدشده درگاه با مبلغ تراکنش مطابقت ندارد.',
    };
  }
  return {
    ok: true,
    result,
    alreadyVerified: result === 201,
    amountRial,
    refNumber: String(obj.refNumber ?? ''),
    cardNumber: typeof obj.cardNumber === 'string' ? obj.cardNumber : null,
    orderId: typeof obj.orderId === 'string' ? obj.orderId : null,
    paidAt: typeof obj.paidAt === 'string' ? obj.paidAt : null,
  };
}
