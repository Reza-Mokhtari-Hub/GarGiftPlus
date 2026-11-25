import type { AstroCookies } from 'astro';
import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId, withPublicId } from '../ids/publicId.ts';
import {
  customerInputsFingerprint,
  parseStoredCustomerInputs,
  type NormalizedCustomerInput,
} from '../products/customFields.ts';

export const CART_SESSION_COOKIE = 'cart_sid';
const CART_SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getCartSession(cookies: AstroCookies): string | null {
  const raw = cookies.get(CART_SESSION_COOKIE)?.value?.trim();
  return raw && UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

export function getOrCreateCartSession(cookies: AstroCookies, secure: boolean): string {
  const existing = getCartSession(cookies);
  if (existing) return existing;
  const fresh = crypto.randomUUID().toLowerCase();
  cookies.set(CART_SESSION_COOKIE, fresh, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: CART_SESSION_MAX_AGE,
  });
  return fresh;
}

/**
 * Persist validated customer inputs for one cart line, returning a `cinp_…` public ID.
 * If the same cart session + product already has identical normalized inputs, reuses
 * that `cinp_…` token so identical cart lines merge cleanly while differing inputs
 * (e.g. different PUBG Player IDs) produce separate cart lines.
 */
export async function saveCartLineInputs(
  db: D1Database,
  cartSession: string,
  productPublicId: string,
  values: NormalizedCustomerInput[],
): Promise<string | null> {
  if (values.length === 0) return null;

  const fingerprint = customerInputsFingerprint(values);
  const inputsJson = JSON.stringify(values);

  // Opportunistic cleanup of expired snapshots.
  await db
    .prepare("DELETE FROM cart_line_inputs WHERE expires_at <= datetime('now')")
    .run();

  const existing = await db
    .prepare(
      `SELECT public_id FROM cart_line_inputs
        WHERE cart_session = ? AND product_public_id = ? AND fingerprint = ?
        LIMIT 1`,
    )
    .bind(cartSession, productPublicId, fingerprint)
    .first<{ public_id: string }>();

  if (existing?.public_id) {
    await db
      .prepare(
        `UPDATE cart_line_inputs
            SET inputs_json = ?, updated_at = datetime('now'), expires_at = datetime('now', '+30 days')
          WHERE public_id = ?`,
      )
      .bind(inputsJson, existing.public_id)
      .run();
    return existing.public_id;
  }

  return withPublicId('cartInput', async (publicId) => {
    await db
      .prepare(
        `INSERT INTO cart_line_inputs
           (public_id, cart_session, product_public_id, inputs_json, fingerprint, expires_at)
         VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
      )
      .bind(publicId, cartSession, productPublicId, inputsJson, fingerprint)
      .run();
    return publicId;
  });
}

/** Fetch resolved customer inputs keyed by `cinp_` public_id for the caller's session only. */
export async function getCartLineInputsByPublicIds(
  db: D1Database,
  cartSession: string | null,
  publicIds: string[],
): Promise<Map<string, NormalizedCustomerInput[]>> {
  const result = new Map<string, NormalizedCustomerInput[]>();
  if (!cartSession || publicIds.length === 0) return result;

  const valid = [...new Set(publicIds.map((id) => parsePublicId(id, 'cartInput')).filter((x): x is string => x !== null))];
  if (valid.length === 0) return result;

  const ph = valid.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT public_id, inputs_json
         FROM cart_line_inputs
        WHERE cart_session = ? AND public_id IN (${ph}) AND expires_at > datetime('now')`,
    )
    .bind(cartSession, ...valid)
    .all<{ public_id: string; inputs_json: string }>();

  for (const row of results ?? []) {
    result.set(row.public_id, parseStoredCustomerInputs(row.inputs_json));
  }
  return result;
}

/** Fetch one stored customer input set scoped to session and product (used by Express Buy Now). */
export async function getCartLineInputForProduct(
  db: D1Database,
  cartSession: string | null,
  inputPublicId: string | null,
  productPublicId: string,
): Promise<NormalizedCustomerInput[] | null> {
  if (!cartSession || !inputPublicId) return null;
  const parsed = parsePublicId(inputPublicId, 'cartInput');
  if (!parsed) return null;

  const row = await db
    .prepare(
      `SELECT inputs_json FROM cart_line_inputs
        WHERE public_id = ? AND cart_session = ? AND product_public_id = ? AND expires_at > datetime('now')
        LIMIT 1`,
    )
    .bind(parsed, cartSession, productPublicId)
    .first<{ inputs_json: string }>();

  return row ? parseStoredCustomerInputs(row.inputs_json) : null;
}
