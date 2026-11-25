import { describe, expect, it } from 'vitest';
import {
  canTransitionPaymentTx,
  isTerminalPaymentTxStatus,
  verifyTransactionMatch,
} from './transactions';

describe('payment transaction state machine', () => {
  it('enforces allowed status transitions and blocks replay from VERIFIED', () => {
    expect(canTransitionPaymentTx('CREATED', 'INITIATED')).toBe(true);
    expect(canTransitionPaymentTx('INITIATED', 'VERIFIED')).toBe(true);
    expect(canTransitionPaymentTx('PAYMENT_REVIEW', 'VERIFIED')).toBe(true);
    expect(canTransitionPaymentTx('PAYMENT_REVIEW', 'FAILED')).toBe(true);
    expect(canTransitionPaymentTx('FAILED', 'PAYMENT_REVIEW')).toBe(true);
    expect(canTransitionPaymentTx('VERIFIED', 'FAILED')).toBe(false);
    expect(canTransitionPaymentTx('VERIFIED', 'VERIFIED')).toBe(false);
    expect(canTransitionPaymentTx('EXPIRED', 'VERIFIED')).toBe(false);
    expect(isTerminalPaymentTxStatus('VERIFIED')).toBe(true);
    expect(isTerminalPaymentTxStatus('PAYMENT_REVIEW')).toBe(false);
  });

  it('rejects amount mismatch, currency mismatch, and already verified callbacks', () => {
    expect(
      verifyTransactionMatch(
        { amount: 150000, currency: 'irt', status: 'INITIATED' },
        { amount: 150000, currency: 'irt' },
      ),
    ).toEqual({ ok: true });

    expect(
      verifyTransactionMatch(
        { amount: 150000, currency: 'irt', status: 'VERIFIED' },
        { amount: 150000, currency: 'irt' },
      ),
    ).toEqual({ ok: false, reason: 'already_verified' });

    expect(
      verifyTransactionMatch(
        { amount: 150000, currency: 'irt', status: 'INITIATED' },
        { amount: 140000, currency: 'irt' },
      ),
    ).toEqual({ ok: false, reason: 'amount_mismatch' });

    expect(
      verifyTransactionMatch(
        { amount: 150000, currency: 'irt', status: 'INITIATED' },
        { amount: 150000, currency: 'irr' },
      ),
    ).toEqual({ ok: false, reason: 'currency_mismatch' });
  });
});
