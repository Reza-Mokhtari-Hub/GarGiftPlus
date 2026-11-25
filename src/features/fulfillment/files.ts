/**
 * اعتبارسنجی فایل‌های پیوست خصوصی تحویل سفارش (R2 Private Bucket `env.FILES`)،
 * بررسی بایت‌های امضای فایل (Magic Bytes)، تولید کلید ذخیره‌سازی امن
 * و ساخت هدرهای دانلود محافظت‌شده.
 */

export const MAX_DELIVERY_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

export type AllowedAttachmentMime =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'text/plain';

export type AllowedAttachmentExt = 'pdf' | 'png' | 'jpg' | 'webp' | 'gif' | 'txt';

export interface SniffedAttachmentFile {
  mime: AllowedAttachmentMime;
  ext: AllowedAttachmentExt;
}

export type AttachmentValidationResult =
  | {
      ok: true;
      sniffed: SniffedAttachmentFile;
      safeFileName: string;
      sha256Hex: string;
    }
  | {
      ok: false;
      error: string;
    };

const ALLOWED_EXTENSIONS: Record<string, AllowedAttachmentExt> = {
  pdf: 'pdf',
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  txt: 'txt',
};

/**
 * تشخیص نوع واقعی فایل از روی بایت‌های ابتدایی (Magic Bytes)
 */
export function sniffAttachmentMagicBytes(
  bytes: Uint8Array,
  declaredMime?: string | null,
  fileName?: string | null,
): SniffedAttachmentFile | null {
  if (bytes.byteLength < 4) return null;

  // PDF: %PDF- (25 50 44 46 2D)
  if (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { mime: 'application/pdf', ext: 'pdf' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.byteLength >= 8 &&
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

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // GIF: GIF87a or GIF89a
  if (
    bytes.byteLength >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }

  // WebP: RIFF....WEBP
  if (
    bytes.byteLength >= 12 &&
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

  // Plain UTF-8 text (.txt) when explicitly declared as text/plain and .txt
  const rawExt = extractFileExtension(fileName ?? '');
  const mimeLower = (declaredMime ?? '').toLowerCase();
  if (rawExt === 'txt' && (mimeLower === 'text/plain' || mimeLower === '')) {
    if (isSafePlainTextBytes(bytes)) {
      return { mime: 'text/plain', ext: 'txt' };
    }
  }

  return null;
}

function isSafePlainTextBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024) return false;
  // Reject any null bytes or control bytes outside \t, \n, \r
  for (let i = 0; i < bytes.byteLength; i++) {
    const b = bytes[i];
    if (b === 0x00 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) {
      return false;
    }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Reject HTML/SVG/Script payloads disguised as .txt
    if (/<\s*(html|script|svg|iframe|object|embed)\b/i.test(text)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractFileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  const idx = trimmed.lastIndexOf('.');
  if (idx <= 0 || idx === trimmed.length - 1) return '';
  return trimmed.slice(idx + 1).toLowerCase();
}

export function sanitizeAttachmentFileName(
  rawName: string | null | undefined,
  canonicalExt: AllowedAttachmentExt,
): string {
  const base = (rawName ?? '')
    .trim()
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f"<>|:*?]/g, '_')
    .replace(/\s+/g, ' ');
  const withoutExt = base.replace(/\.[a-zA-Z0-9]{1,8}$/, '').trim();
  const cleanStem = (withoutExt || 'delivery-attachment').slice(0, 100);
  return `${cleanStem}.${canonicalExt}`;
}

/**
 * اعتبارسنجی کامل فایل پیوست تحویل (حجم، پسوند، MIME، امضای باینری و هش SHA-256)
 */
export async function validateDeliveryAttachmentBytes(
  bytes: Uint8Array,
  fileName: string | null | undefined,
  declaredMime?: string | null,
): Promise<AttachmentValidationResult> {
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, error: 'فایل پیوست انتخاب‌شده خالی است.' };
  }
  if (bytes.byteLength > MAX_DELIVERY_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: 'حجم فایل پیوست بیش از حد مجاز (حداکثر ۱۵ مگابایت) است.',
    };
  }

  const rawExt = extractFileExtension(fileName ?? '');
  if (rawExt && !ALLOWED_EXTENSIONS[rawExt]) {
    return {
      ok: false,
      error: 'پسوند فایل مجاز نیست. فقط فرمت‌های PDF، PNG، JPG، WebP، GIF و TXT مجاز هستند.',
    };
  }

  const sniffed = sniffAttachmentMagicBytes(bytes, declaredMime, fileName);
  if (!sniffed) {
    return {
      ok: false,
      error:
        'امضای واقعی فایل (File Signature) معتبر نیست یا با فرمت‌های مجاز (PDF، PNG، JPEG، WebP، GIF، TXT) مطابقت ندارد.',
    };
  }

  if (rawExt && ALLOWED_EXTENSIONS[rawExt] !== sniffed.ext) {
    return {
      ok: false,
      error: 'پسوند فایل با محتوای باینری واقعی آن همخوانی ندارد.',
    };
  }

  const mimeClean = (declaredMime ?? '').trim().toLowerCase();
  if (
    mimeClean &&
    mimeClean !== 'application/octet-stream' &&
    mimeClean !== sniffed.mime &&
    !(mimeClean === 'image/jpg' && sniffed.mime === 'image/jpeg')
  ) {
    return {
      ok: false,
      error: 'نوع MIME اعلام‌شده با امضای واقعی فایل مطابقت ندارد.',
    };
  }

  const safeFileName = sanitizeAttachmentFileName(fileName, sniffed.ext);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer as ArrayBuffer);
  const sha256Hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    ok: true,
    sniffed,
    safeFileName,
    sha256Hex,
  };
}

/**
 * تولید کلید شیء خصوصی در R2 (`env.FILES`) که هیچ‌گاه از مسیر عمومی `/images/*` سرو نمی‌شود.
 */
export function buildDeliveryAttachmentKey(
  orderPublicId: string,
  itemPublicId: string,
  attachmentPublicId: string,
  ext: AllowedAttachmentExt,
): string {
  const safeOrder = orderPublicId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeItem = itemPublicId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeAtt = attachmentPublicId.replace(/[^a-zA-Z0-9_-]/g, '');
  return `deliveries/${safeOrder}/${safeItem}/${safeAtt}.${ext}`;
}

/**
 * ساخت هدرهای امنیتی استاندارد برای دانلود فایل‌های خصوصی تحویل
 */
export function buildPrivateDownloadHeaders(
  fileName: string,
  mimeType: string,
  sizeBytes?: number | null,
): Record<string, string> {
  const asciiName =
    fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'delivery-file';
  const headers: Record<string, string> = {
    'content-type': mimeType || 'application/octet-stream',
    'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, no-store',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; sandbox",
  };
  if (typeof sizeBytes === 'number' && sizeBytes > 0) {
    headers['content-length'] = String(sizeBytes);
  }
  return headers;
}
