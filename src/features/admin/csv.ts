/**
 * تولید ایمن خروجی CSV با پشتیبانی کامل از اکسل فارسی (UTF-8 BOM)
 * و خنثی‌سازی تزریق فرمول در صفحات گسترده (CSV Formula Injection).
 */

const FORMULA_TRIGGER_RE = /^[\s]*[=+\-@\t\r]/;

export function sanitizeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // خنثی‌سازی سلول‌هایی که با = یا + یا - یا @ یا Tab یا CR شروع می‌شوند
  if (FORMULA_TRIGGER_RE.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function buildCsvDocument(
  headers: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>,
): string {
  const headerLine = headers.map((h) => sanitizeCsvCell(h)).join(',');
  const dataLines = rows.map((row) => row.map((cell) => sanitizeCsvCell(cell)).join(','));
  // BOM برای تشخیص درست UTF-8 فارسی در Excel و LibreOffice
  return `\uFEFF${[headerLine, ...dataLines].join('\r\n')}\r\n`;
}
