import { toEnglishDigits, toPersianDigits } from '../../lib/format';

export const MAX_RECEIPT_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB

export const ALLOWED_RECEIPT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type ReceiptMime = (typeof ALLOWED_RECEIPT_MIMES)[number];
export type ReceiptExt = 'jpg' | 'png' | 'webp' | 'gif';

export interface SniffedImage {
  mime: ReceiptMime;
  ext: ReceiptExt;
}

/**
 * تشخیص واقعی نوع فایل از بایت‌های هدر (Magic Bytes) برای جلوگیری از آپلود SVG/HTML/اسکریپت با پسوند جعلی.
 */
export function sniffImageSignature(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }

  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  return null;
}

export function validateReceiptBytes(
  bytes: Uint8Array,
  declaredMime?: string | null,
):
  | { ok: true; sniffed: SniffedImage; sizeBytes: number }
  | { ok: false; error: string } {
  if (bytes.byteLength === 0) {
    return { ok: false, error: 'فایل تصویر رسید خالی است.' };
  }
  if (bytes.byteLength > MAX_RECEIPT_SIZE_BYTES) {
    return { ok: false, error: 'حجم تصویر رسید نباید بیشتر از ۵ مگابایت باشد.' };
  }
  const sniffed = sniffImageSignature(bytes);
  if (!sniffed) {
    return {
      ok: false,
      error: 'فرمت تصویر رسید معتبر نیست. فقط فایل‌های JPG، PNG، WebP یا GIF مجاز هستند.',
    };
  }
  if (declaredMime && declaredMime.trim()) {
    const cleanDeclared = declaredMime.trim().toLowerCase();
    const compatible =
      cleanDeclared === sniffed.mime ||
      (cleanDeclared === 'image/jpg' && sniffed.mime === 'image/jpeg') ||
      cleanDeclared === 'application/octet-stream';
    if (!compatible) {
      return {
        ok: false,
        error: 'نوع فایل اعلام‌شده با محتوای واقعی تصویر مطابقت ندارد.',
      };
    }
  }
  return { ok: true, sniffed, sizeBytes: bytes.byteLength };
}

export function buildReceiptObjectKey(receiptPublicId: string, ext: ReceiptExt): string {
  return `receipts/${receiptPublicId}.${ext}`;
}

export function normalizeCardNumber(raw: string): string | null {
  const digits = toEnglishDigits(raw).replace(/\D/g, '');
  if (digits.length !== 16) return null;
  return digits;
}

export function formatCardNumber(card16: string, persian = true): string {
  const digits = normalizeCardNumber(card16);
  if (!digits) return card16;
  const grouped = digits.replace(/(\d{4})(?=\d)/g, '$1-');
  return persian ? toPersianDigits(grouped) : grouped;
}

export function normalizeIban(raw: string): string | null {
  const clean = toEnglishDigits(raw).replace(/[\s-]+/g, '').toUpperCase();
  if (!/^IR\d{24}$/.test(clean)) return null;
  return clean;
}
