import { describe, it, expect } from 'vitest';
import {
  currencyDecimals,
  formatMoney,
  minorUnitsPerMajor,
  toMinorUnits,
  toMajorUnits,
} from './money';

describe('currency scaling', () => {
  it('knows decimal places per currency (ISO 4217 + IRT/IRR)', () => {
    expect(currencyDecimals('usd')).toBe(2);
    expect(currencyDecimals('eur')).toBe(2);
    expect(currencyDecimals('gbp')).toBe(2);
    expect(currencyDecimals('jpy')).toBe(0); // zero-decimal
    expect(currencyDecimals('krw')).toBe(0); // zero-decimal
    expect(currencyDecimals('irt')).toBe(0); // Toman zero-decimal
    expect(currencyDecimals('irr')).toBe(0); // Rial zero-decimal
    expect(currencyDecimals('bhd')).toBe(3); // three-decimal
    expect(currencyDecimals('kwd')).toBe(3);
  });

  it('is case-insensitive on the currency code', () => {
    expect(currencyDecimals('USD')).toBe(2);
    expect(currencyDecimals('IRT')).toBe(0);
    expect(minorUnitsPerMajor('JPY')).toBe(1);
    expect(minorUnitsPerMajor('IRT')).toBe(1);
  });

  it('derives minor units per major from the decimals', () => {
    expect(minorUnitsPerMajor('usd')).toBe(100);
    expect(minorUnitsPerMajor('jpy')).toBe(1);
    expect(minorUnitsPerMajor('irt')).toBe(1);
    expect(minorUnitsPerMajor('irr')).toBe(1);
    expect(minorUnitsPerMajor('bhd')).toBe(1000);
  });

  it('converts major → minor scaled by currency', () => {
    expect(toMinorUnits(19.99, 'usd')).toBe(1999);
    expect(toMinorUnits(1000, 'jpy')).toBe(1000); // not 100000
    expect(toMinorUnits(50000, 'irt')).toBe(50000);
    expect(toMinorUnits(2.5, 'bhd')).toBe(2500);
  });

  it('rounds half-cent inputs rather than truncating', () => {
    expect(toMinorUnits(0.1 + 0.2, 'usd')).toBe(30); // 0.30000000000000004 → 30
    expect(toMinorUnits(19.005, 'usd')).toBe(1901); // round, not floor
  });

  it('converts minor → major scaled by currency', () => {
    expect(toMajorUnits(1999, 'usd')).toBe(19.99);
    expect(toMajorUnits(1000, 'jpy')).toBe(1000); // yen has no sub-unit
    expect(toMajorUnits(50000, 'irt')).toBe(50000);
    expect(toMajorUnits(2500, 'bhd')).toBe(2.5);
  });

  it('round-trips major → minor → major for each currency class', () => {
    for (const [amount, cur] of [
      [19.99, 'usd'],
      [1000, 'jpy'],
      [75000, 'irt'],
      [750000, 'irr'],
      [2.5, 'bhd'],
    ] as const) {
      expect(toMajorUnits(toMinorUnits(amount, cur), cur)).toBe(amount);
    }
  });

  it('formats IRT in Persian Toman and IRR in Persian Rial', () => {
    expect(formatMoney(125000, 'irt')).toBe('۱۲۵٬۰۰۰ تومان');
    expect(formatMoney(1250000, 'irr')).toBe('۱٬۲۵۰٬۰۰۰ ریال');
    expect(formatMoney(2500, 'usd')).toBe('$25.00');
  });

  it('falls back to 2 decimals for an unknown currency code', () => {
    expect(currencyDecimals('zzz')).toBe(2);
  });
});
