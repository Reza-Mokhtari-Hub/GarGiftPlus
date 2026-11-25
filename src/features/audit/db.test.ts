import { describe, it, expect } from 'vitest';
import { sanitizeAuditDetails } from './db';

describe('audit log sanitization', () => {
  it('redacts sensitive credentials and gift codes while preserving safe identifiers', () => {
    const out = sanitizeAuditDetails({
      public_id: 'ord_1234',
      tracking_code: 'TRX-99',
      password: 'plain-password',
      api_key: 'sk_live_secret',
      gift_code: 'XXXX-YYYY-ZZZZ',
      nested: {
        token: 'jwt-secret',
        role: 'finance_manager',
      },
    });

    expect(out).toEqual({
      public_id: 'ord_1234',
      tracking_code: 'TRX-99',
      password: '[REDACTED]',
      api_key: '[REDACTED]',
      gift_code: '[REDACTED]',
      nested: {
        token: '[REDACTED]',
        role: 'finance_manager',
      },
    });
  });

  it('caps deep recursion safely', () => {
    expect(sanitizeAuditDetails(null)).toBeNull();
    expect(sanitizeAuditDetails({}, 5)).toBeNull();
  });
});
