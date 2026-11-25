import { describe, expect, it } from 'vitest';
import {
  buildReceiptObjectKey,
  formatCardNumber,
  normalizeCardNumber,
  normalizeIban,
  sniffImageSignature,
  validateReceiptBytes,
} from './bankTransfer';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const webpBytes = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50,
]);
const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('bank transfer receipt and card helpers', () => {
  it('sniffs genuine image magic bytes and rejects SVG/HTML spoofing', () => {
    expect(sniffImageSignature(pngBytes)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffImageSignature(jpgBytes)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(sniffImageSignature(webpBytes)).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(sniffImageSignature(svgBytes)).toBeNull();
  });

  it('validates receipt bytes, declared MIME consistency, and builds private key path', () => {
    expect(validateReceiptBytes(pngBytes, 'image/png')).toMatchObject({
      ok: true,
      sniffed: { mime: 'image/png', ext: 'png' },
    });
    expect(validateReceiptBytes(svgBytes, 'image/png')).toMatchObject({ ok: false });
    expect(validateReceiptBytes(pngBytes, 'image/jpeg')).toMatchObject({ ok: false });
    expect(buildReceiptObjectKey('rcp_abc123', 'png')).toBe('receipts/rcp_abc123.png');
  });

  it('normalizes and formats Iranian bank card numbers and IBANs', () => {
    expect(normalizeCardNumber('۶۰۳۷-۹۹۷۹-۵۰۱۱-۲۲۳۳')).toBe('6037997950112233');
    expect(formatCardNumber('6037997950112233', true)).toBe('۶۰۳۷-۹۹۷۹-۵۰۱۱-۲۲۳۳');
    expect(normalizeCardNumber('1234')).toBeNull();
    expect(normalizeIban('ir06 2960 0000 0010 0324 2000 01')).toBe('IR062960000000100324200001');
    expect(normalizeIban('IR123')).toBeNull();
  });
});
