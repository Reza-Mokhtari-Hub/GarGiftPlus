import { describe, expect, it } from 'vitest';
import {
  buildZarinpalRequestBody,
  buildZarinpalVerifyBody,
  parseZarinpalRequestResponse,
  parseZarinpalVerifyResponse,
  zarinpalStartPayUrl,
} from './zarinpal';

describe('Zarinpal adapter logic', () => {
  it('builds request body with explicit IRT/IRR currency mapping', () => {
    expect(
      buildZarinpalRequestBody({
        merchantId: '00000000-0000-0000-0000-000000000000',
        amount: 120000,
        currency: 'irt',
        callbackUrl: 'https://gargift.ir/api/payments/zarinpal/callback',
        description: 'خرید گیفت کارت اپل',
        orderId: 'ptx_abc',
      }),
    ).toEqual({
      merchant_id: '00000000-0000-0000-0000-000000000000',
      amount: 120000,
      currency: 'IRT',
      callback_url: 'https://gargift.ir/api/payments/zarinpal/callback',
      description: 'خرید گیفت کارت اپل',
      metadata: { order_id: 'ptx_abc' },
    });

    expect(() =>
      buildZarinpalRequestBody({
        merchantId: 'm',
        amount: 2500,
        currency: 'usd',
        callbackUrl: 'https://x/cb',
        description: 'bad',
      }),
    ).toThrow(/requires IRT or IRR/);
  });

  it('parses request responses for production and sandbox', () => {
    expect(
      parseZarinpalRequestResponse(
        { data: { code: 100, authority: 'A00000000000000000000000000000000001', fee: 1200 } },
        true,
      ),
    ).toEqual({
      ok: true,
      authority: 'A00000000000000000000000000000000001',
      startPayUrl: zarinpalStartPayUrl('A00000000000000000000000000000000001', true),
      fee: 1200,
    });

    expect(
      parseZarinpalRequestResponse(
        { data: [], errors: { code: -9, message: 'Validation error' } },
        false,
      ),
    ).toEqual({
      ok: false,
      code: -9,
      message: 'Validation error',
    });
  });

  it('parses verify responses including 100 and 101 idempotency code', () => {
    expect(buildZarinpalVerifyBody({ merchantId: 'm', authority: 'A1', amount: 50000 })).toEqual({
      merchant_id: 'm',
      authority: 'A1',
      amount: 50000,
    });

    expect(
      parseZarinpalVerifyResponse({
        data: { code: 100, ref_id: 987654321, card_pan: '6219-86**-****-1234', fee: 500 },
      }),
    ).toEqual({
      ok: true,
      code: 100,
      alreadyVerified: false,
      refId: '987654321',
      cardPan: '6219-86**-****-1234',
      fee: 500,
    });

    expect(
      parseZarinpalVerifyResponse({
        data: { code: 101, ref_id: 987654321, fee: 500 },
      }),
    ).toMatchObject({ ok: true, code: 101, alreadyVerified: true });
  });
});
