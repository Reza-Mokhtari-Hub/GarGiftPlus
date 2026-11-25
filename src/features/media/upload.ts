import type { D1Database } from '@cloudflare/workers-types';
import type { StorageProvider } from '../storage';
// Explicit .ts: test/integration/media.mjs loads this module through Node's type
// stripping, which does not resolve extensionless relative imports.
import { createMediaRecord, type Media } from './db.ts';
import { readImageDimensions } from './dimensions.ts';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * SVG is deliberately absent: uploaded objects are served from the store's own
 * origin, and an SVG is a script-execution vector there.
 */
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

function sniffRasterSignature(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
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
    return 'image/png';
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
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
    return 'image/webp';
  }
  return null;
}

/** Returns a user-facing error string if the upload is invalid, else null. */
export function validateUpload(file: File): string | null {
  if (!ALLOWED.has(file.type)) {
    return 'Image must be JPEG, PNG, WebP, or GIF.';
  }
  if (file.size > MAX_BYTES) {
    return 'Image must be 5 MB or smaller.';
  }
  return null;
}

/**
 * Deep upload validation for HTTP upload endpoints: checks MIME/size first and
 * verifies magic bytes match a supported raster image (blocks HTML/SVG/script
 * payloads uploaded with a spoofed image Content-Type).
 */
export async function validateUploadContent(file: File): Promise<string | null> {
  const basic = validateUpload(file);
  if (basic) return basic;
  if (file.size < 12) {
    return 'Image content is invalid or corrupted.';
  }
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffedMime = sniffRasterSignature(head);
  if (!sniffedMime) {
    return 'Image file signature is invalid (JPEG, PNG, WebP, or GIF required).';
  }
  const declared = file.type.toLowerCase();
  const compatible =
    declared === sniffedMime ||
    (declared === 'image/jpg' && sniffedMime === 'image/jpeg');
  if (!compatible) {
    return 'Image MIME type does not match its file contents.';
  }
  return null;
}

/**
 * Immutable per-upload key. Never reuse one: /images/* is served immutable.
 *
 * Twenty hex characters, not a UUID, because Cloudflare's observability pipeline
 * redacts any run of ID characters in a request URL that reads like a
 * credential: 32 or more hex digits, or 21+ characters mixing upper, lower and
 * digits. A UUID is 32 hex digits (the dashes count as separators, not breaks),
 * so every image request logged as `GET /images/media/REDACTED.webp` and there
 * was no way to tell which file a 404 or a slow response belonged to. Twenty
 * characters sits below both thresholds and cannot match either rule.
 *
 * 10 random bytes rather than a truncated UUID: a v4 UUID spends 6 of its bits
 * on the version and variant fields, so its first 20 hex characters carry 74
 * bits. Asking for the bytes directly gives the full 80 and skips unpicking the
 * dashes. Image keys are public and non-secret, but they should still be
 * unguessable enough that an unpublished product's image cannot be enumerated.
 *
 * Keep this at 20 or fewer characters. Anything longer risks tripping the
 * redaction rule again, and objects already written keep their old keys, so the
 * fix is never retroactive.
 */
export function mediaKeyFor(file: File): string {
  const ext = ALLOWED.get(file.type) ?? 'bin';
  const id = crypto.getRandomValues(new Uint8Array(10));
  return `media/${[...id].map((b) => b.toString(16).padStart(2, '0')).join('')}.${ext}`;
}

/**
 * Store a (pre-validated) file and record it in the library.
 *
 * The object is written before the row so a failure never leaves a row pointing
 * at a missing object — the reverse order would show a broken image everywhere
 * the media was used. If the insert then fails we delete the object we just
 * wrote, so the failure costs an orphan at worst. `originalName` is passed in
 * because the optimizer replaces the File and its name.
 */
export async function uploadMedia(
  db: D1Database,
  storage: StorageProvider,
  file: File,
  originalName: string,
): Promise<Media> {
  const key = mediaKeyFor(file);
  // One read of the bytes, used for both the upload and the header parse. `file`
  // is already the OPTIMIZED file — every caller passes optimizeUpload(file) —
  // so these dimensions describe the object actually stored, not the original.
  const buffer = await file.arrayBuffer();
  await storage.put(key, buffer, file.type);
  const dimensions = readImageDimensions(new Uint8Array(buffer));
  try {
    return await createMediaRecord(db, {
      image_key: key,
      original_name: originalName,
      mime_type: file.type,
      size_bytes: file.size,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    });
  } catch (err) {
    try {
      await storage.delete(key);
    } catch (cleanupErr) {
      // The row never existed, so nothing references this object; log the key
      // so it can be swept manually rather than failing the request twice.
      console.error(
        JSON.stringify({
          event: 'media_orphan_after_failed_insert',
          key,
          message: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        }),
      );
    }
    throw err;
  }
}
