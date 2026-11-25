import { describe, it, expect } from 'vitest';
import { sanitizeCsvCell, buildCsvDocument } from './csv';

describe('csv export hardening', () => {
  it('neutralizes spreadsheet formula prefixes', () => {
    expect(sanitizeCsvCell('=CMD()')).toBe('"\'=CMD()"');
    expect(sanitizeCsvCell('+1234')).toBe('"\'+1234"');
    expect(sanitizeCsvCell('-1234')).toBe('"\'-1234"');
    expect(sanitizeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(sanitizeCsvCell('  =1+1')).toBe('"\'  =1+1"');
    expect(sanitizeCsvCell('\t=2+2')).toBe('"\'\t=2+2"');
  });

  it('escapes double quotes and preserves clean Persian cells', () => {
    expect(sanitizeCsvCell('اشتراک "طلایی" گرگیفت+')).toBe('"اشتراک ""طلایی"" گرگیفت+"');
    expect(sanitizeCsvCell(null)).toBe('');
    expect(sanitizeCsvCell(undefined)).toBe('');
    expect(sanitizeCsvCell(450000)).toBe('"450000"');
  });

  it('builds a UTF-8 BOM document with CRLF line endings', () => {
    const doc = buildCsvDocument(
      ['شناسه', 'مبلغ'],
      [['GG-1001', 250000], ['=evil', '۰']],
    );
    expect(doc.startsWith('\uFEFF')).toBe(true);
    expect(doc).toContain('"شناسه","مبلغ"\r\n');
    expect(doc).toContain('"\'=evil","۰"\r\n');
  });
});
