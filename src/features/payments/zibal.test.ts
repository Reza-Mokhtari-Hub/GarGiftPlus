import { describe, expect, it } from 'vitest';
import {
  buildZibalRequestBody,
  buildZibalVerifyBody,
  parseZibalRequestResponse,
  parseZibalVerifyResponse,
} from './zibal';

describe('Zibal adapter logic', () => {
  it('always converts IRT to IRR integer Rials on request', () => {
    expect(
      buildZibalRequestBody({
        merchant: 'zibal',
        amount: 75000,
        currency: 'irt',
        callbackUrl: 'https://gargift.ir/api/payments/zibal/callback',
        description: 'شارژ کیف پول',
        orderId: 'ptx_topup',
      }),
    ).toEqual({
      merchant: 'zibal',
      amount: 750000,
      callbackUrl: 'https://gargift.ir/api/payments/zibal/callback',
      description: 'شارژ کیف پول',
      orderId: 'ptx_topup',
    });
  });

  it('parses Zibal trackId and verify response with exact Rial match', () => {
    expect(parseZibalRequestResponse({ trackId: 123456789, result: 100, message: 'success' })).toEqual({
      ok: true,
      trackId: '123456789',
      startPayUrl: 'https://gateway.zibal.ir/start/123456789',
    });

    expect(buildZibalVerifyBody({ merchant: 'zibal', trackId: '123456789' })).toEqual({
      merchant: 'zibal',
      trackId: 123456789,
    });

    expect(
      parseZibalVerifyResponse(
        {
          result: 100,
          amount: 750000,
          refNumber: 555666,
          cardNumber: '6037-****-****-9999',
          orderId: 'ptx_topup',
          paidAt: '2026-01-01T10:00:00Z',
        },
        750000,
      ),
    ).toEqual({
      ok: true,
      result: 100,
      alreadyVerified: false,
      amountRial: 750000,
      refNumber: '555666',
      cardNumber: '6037-****-****-9999',
      orderId: 'ptx_topup',
      paidAt: '2026-01-01T10:00:00Z',
    });

    expect(
      parseZibalVerifyResponse({ result: 100, amount: 500000 }, 750000),
    ).toMatchObject({ ok: false, result: -200 });
  });
});
