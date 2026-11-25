import { describe, expect, it } from 'vitest';
import {
  assertValidIntegerAmount,
  calcLineTotal,
  calcOrderTotals,
  isIranCurrency,
  parsePersianIntegerInput,
  resolveGatewayRialAmount,
  rialToToman,
  tomanToRial,
} from './iran';

describe('Iranian currency rules', () => {
  it('identifies IRT and IRR accurately', () => {
    expect(isIranCurrency('irt')).toBe(true);
    expect(isIranCurrency('IRT')).toBe(true);
    expect(isIranCurrency('irr')).toBe(true);
    expect(isIranCurrency('usd')).toBe(false);
  });

  it('converts between Toman and Rial using pure integers', () => {
    expect(tomanToRial(50000)).toBe(500000);
    expect(rialToToman(500000)).toBe(50000);
    expect(rialToToman(123456)).toBe(12345);
  });

  it('parses Persian, Arabic, and grouped digit strings into safe integers', () => {
    expect(parsePersianIntegerInput('۱۲۵٬۰۰۰')).toBe(125000);
    expect(parsePersianIntegerInput('50,000')).toBe(50000);
    expect(parsePersianIntegerInput('٢٥٠٠٠')).toBe(25000);
    expect(parsePersianIntegerInput('12.5')).toBeNull();
    expect(parsePersianIntegerInput('-500')).toBeNull();
    expect(parsePersianIntegerInput('')).toBeNull();
  });

  it('calculates integer line and order totals without floats', () => {
    expect(calcLineTotal(89000, 3)).toBe(267000);
    expect(
      calcOrderTotals(
        [
          { unitAmount: 89000, quantity: 2 },
          { unitAmount: 150000, quantity: 1 },
        ],
        28000,
        0,
      ),
    ).toEqual({
      subtotal: 328000,
      discount: 28000,
      shipping: 0,
      total: 300000,
    });
  });

  it('resolves Rial amounts for gateways and rejects non-Iranian currencies', () => {
    expect(resolveGatewayRialAmount(100000, 'irt')).toBe(1000000);
    expect(resolveGatewayRialAmount(1000000, 'irr')).toBe(1000000);
    expect(() => resolveGatewayRialAmount(2500, 'usd')).toThrow(/Unsupported Iranian gateway/);
  });

  it('rejects non-integer or out-of-range amounts', () => {
    expect(() => assertValidIntegerAmount(12.5)).toThrow();
    expect(() => assertValidIntegerAmount(NaN)).toThrow();
    expect(() => assertValidIntegerAmount(0, { min: 1 })).toThrow();
  });
});
