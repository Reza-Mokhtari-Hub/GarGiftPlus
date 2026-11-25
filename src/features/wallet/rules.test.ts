import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WALLET_MAX_TOPUP,
  DEFAULT_WALLET_MIN_TOPUP,
  signedWalletDelta,
  validateAdminAdjustmentInput,
  validateTopupAmount,
  validateWalletTransition,
} from './rules';

describe('wallet rules', () => {
  it('computes signed delta for credit and debit transaction types', () => {
    expect(signedWalletDelta('TOPUP_GATEWAY', 50000)).toBe(50000);
    expect(signedWalletDelta('TOPUP_BANK', 75000)).toBe(75000);
    expect(signedWalletDelta('REFUND_CREDIT', 20000)).toBe(20000);
    expect(signedWalletDelta('ADMIN_CREDIT', 10000)).toBe(10000);
    expect(signedWalletDelta('ORDER_DEBIT', 45000)).toBe(-45000);
    expect(signedWalletDelta('ADMIN_DEBIT', 5000)).toBe(-5000);
  });

  it('prevents negative wallet balances', () => {
    expect(validateWalletTransition(100000, -40000)).toEqual({ ok: true, nextBalance: 60000 });
    expect(validateWalletTransition(100000, -100000)).toEqual({ ok: true, nextBalance: 0 });
    expect(validateWalletTransition(25000, -30000).ok).toBe(false);
    expect(validateWalletTransition(25000, 0).ok).toBe(false);
  });

  it('validates top-up amount bounds and Persian digit inputs', () => {
    expect(validateTopupAmount('۵۰٬۰۰۰', DEFAULT_WALLET_MIN_TOPUP, DEFAULT_WALLET_MAX_TOPUP)).toEqual({
      ok: true,
      amount: 50000,
    });
    expect(validateTopupAmount('5000', 10000, 1000000).ok).toBe(false);
    expect(validateTopupAmount('2000000', 10000, 1000000).ok).toBe(false);
    expect(validateTopupAmount('abc', 10000, 1000000).ok).toBe(false);
  });

  it('requires mandatory reason for admin wallet adjustments', () => {
    expect(validateAdminAdjustmentInput('ADMIN_CREDIT', '100000', '')).toMatchObject({ ok: false });
    expect(validateAdminAdjustmentInput('ADMIN_DEBIT', '25000', 'اصلاح تراکنش تکراری')).toEqual({
      ok: true,
      type: 'ADMIN_DEBIT',
      amount: 25000,
      reason: 'اصلاح تراکنش تکراری',
    });
  });
});
