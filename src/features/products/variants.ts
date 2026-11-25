import type { D1Database } from '@cloudflare/workers-types';
import { listProductImages } from './db';
import { toMinorUnits } from '../../money';
import { toGrams, type WeightUnit } from '../shipping/weight';
import { withPublicId } from '../ids/publicId.ts';

/** A purchasable variant. A product has 0 or N. */
export interface ProductVariant {
  id: number;
  public_id: string | null;
  product_id: number;
  label: string;
  price_cents: number;
  stock: number;
  sku: string | null;
  position: number;
  active: number;
  image_id: number | null; // → product_images.id; NULL = use the gallery primary
  /** Overrides the product's weight in grams; NULL inherits it. An explicit 0 is a
   *  known weight, so this is `?? product.weight_grams`, never `|| `. */
  weight_grams: number | null;
  region?: string | null;
  amount_label?: string | null;
  duration_label?: string | null;
  compare_price_cents?: number | null;
}

/** A checkbox add-on: a price delta on top of the line, no stock of its own. */
export interface ProductExtra {
  id: number;
  public_id: string | null;
  product_id: number;
  label: string;
  price_delta_cents: number;
  position: number;
  active: number;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Variants for a product, in display order. Active-only unless includeInactive. */
export async function listVariants(
  db: D1Database,
  productId: number,
  includeInactive = false,
): Promise<ProductVariant[]> {
  const where = includeInactive ? '' : ' AND active = 1';
  const { results } = await db
    .prepare(`SELECT * FROM product_variants WHERE product_id = ?${where} ORDER BY position, id`)
    .bind(productId)
    .all<ProductVariant>();
  return results ?? [];
}

/** Extras for a product, in display order. Active-only unless includeInactive. */
export async function listExtras(
  db: D1Database,
  productId: number,
  includeInactive = false,
): Promise<ProductExtra[]> {
  const where = includeInactive ? '' : ' AND active = 1';
  const { results } = await db
    .prepare(`SELECT * FROM product_extras WHERE product_id = ?${where} ORDER BY position, id`)
    .bind(productId)
    .all<ProductExtra>();
  return results ?? [];
}

/** One variant by id (any product), or null. */
export async function getVariant(db: D1Database, id: number): Promise<ProductVariant | null> {
  return db.prepare('SELECT * FROM product_variants WHERE id = ?').bind(id).first<ProductVariant>();
}

/** Active variants for many ids in one cart-resolution read. */
export async function getActiveVariantsByIds(
  db: D1Database,
  ids: number[],
): Promise<ProductVariant[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM product_variants WHERE active = 1 AND id IN (${ph})`)
    .bind(...unique)
    .all<ProductVariant>();
  return results ?? [];
}

/** Active variants for many public IDs in one cart-resolution read. */
export async function getActiveVariantsByPublicIds(
  db: D1Database,
  publicIds: string[],
): Promise<ProductVariant[]> {
  const unique = [...new Set(publicIds)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM product_variants WHERE active = 1 AND public_id IN (${ph})`)
    .bind(...unique)
    .all<ProductVariant>();
  return results ?? [];
}

/** One extra by id (any product), or null. */
export async function getExtra(db: D1Database, id: number): Promise<ProductExtra | null> {
  return db.prepare('SELECT * FROM product_extras WHERE id = ?').bind(id).first<ProductExtra>();
}

/** Active extras for many ids in one cart-resolution read. */
export async function getActiveExtrasByIds(
  db: D1Database,
  ids: number[],
): Promise<ProductExtra[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM product_extras WHERE active = 1 AND id IN (${ph})`)
    .bind(...unique)
    .all<ProductExtra>();
  return results ?? [];
}

/** Active extras for many public IDs in one cart-resolution read (any product). */
export async function getActiveExtrasByPublicIds(
  db: D1Database,
  publicIds: string[],
): Promise<ProductExtra[]> {
  const unique = [...new Set(publicIds)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM product_extras WHERE active = 1 AND public_id IN (${ph})`)
    .bind(...unique)
    .all<ProductExtra>();
  return results ?? [];
}

/** Extras belonging to a product, selected by prefixed public IDs. */
export async function getExtrasByPublicIds(
  db: D1Database,
  productId: number,
  publicIds: string[],
): Promise<ProductExtra[]> {
  if (publicIds.length === 0) return [];
  const ph = publicIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM product_extras WHERE product_id = ? AND active = 1 AND public_id IN (${ph}) ORDER BY position, id`,
    )
    .bind(productId, ...publicIds)
    .all<ProductExtra>();
  return results ?? [];
}

/** Active extras for the given ids that belong to `productId` (drops foreign/inactive). */
export async function getExtrasByIds(
  db: D1Database,
  productId: number,
  ids: number[],
): Promise<ProductExtra[]> {
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT * FROM product_extras WHERE product_id = ? AND active = 1 AND id IN (${ph}) ORDER BY position, id`,
    )
    .bind(productId, ...ids)
    .all<ProductExtra>();
  return results ?? [];
}

// ── Admin writes ─────────────────────────────────────────────────────────────

/** The variant group's display name on a product (e.g. "Size"); null = none. */
export async function setVariantLabel(
  db: D1Database,
  productId: number,
  label: string | null,
): Promise<void> {
  await db.prepare('UPDATE products SET variant_label = ? WHERE id = ?').bind(label, productId).run();
}

export async function createVariant(
  db: D1Database,
  productId: number,
  v: {
    label: string;
    price_cents: number;
    stock: number;
    sku: string | null;
    image_id?: number | null;
    position?: number;
    weight_grams?: number | null;
    active?: number;
    region?: string | null;
    amount_label?: string | null;
    duration_label?: string | null;
    compare_price_cents?: number | null;
  },
): Promise<void> {
  // Default position appends to the end of the list (so new rows don't jump up top).
  const position = v.position ?? (await nextPosition(db, 'product_variants', productId));
  await withPublicId('variant', (publicId) =>
    db
      .prepare(
        `INSERT INTO product_variants (
           product_id, label, price_cents, stock, sku, image_id, position, weight_grams,
           active, region, amount_label, duration_label, compare_price_cents, public_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        productId,
        v.label,
        v.price_cents,
        v.stock,
        v.sku,
        v.image_id ?? null,
        position,
        v.weight_grams ?? null,
        v.active ?? 1,
        v.region ?? null,
        v.amount_label ?? null,
        v.duration_label ?? null,
        v.compare_price_cents ?? null,
        publicId,
      )
      .run(),
  );
}

export async function updateVariant(
  db: D1Database,
  id: number,
  v: {
    label: string;
    price_cents: number;
    stock: number;
    sku: string | null;
    image_id?: number | null;
    weight_grams?: number | null;
    position?: number;
    active?: number;
    region?: string | null;
    amount_label?: string | null;
    duration_label?: string | null;
    compare_price_cents?: number | null;
  },
): Promise<void> {
  if (typeof v.position === 'number') {
    await db
      .prepare(
        `UPDATE product_variants
            SET label = ?, price_cents = ?, stock = ?, sku = ?, image_id = ?, weight_grams = ?,
                position = ?, active = ?, region = ?, amount_label = ?, duration_label = ?, compare_price_cents = ?
          WHERE id = ?`,
      )
      .bind(
        v.label,
        v.price_cents,
        v.stock,
        v.sku,
        v.image_id ?? null,
        v.weight_grams ?? null,
        v.position,
        v.active ?? 1,
        v.region ?? null,
        v.amount_label ?? null,
        v.duration_label ?? null,
        v.compare_price_cents ?? null,
        id,
      )
      .run();
  } else {
    await db
      .prepare(
        `UPDATE product_variants
            SET label = ?, price_cents = ?, stock = ?, sku = ?, image_id = ?, weight_grams = ?,
                active = ?, region = ?, amount_label = ?, duration_label = ?, compare_price_cents = ?
          WHERE id = ?`,
      )
      .bind(
        v.label,
        v.price_cents,
        v.stock,
        v.sku,
        v.image_id ?? null,
        v.weight_grams ?? null,
        v.active ?? 1,
        v.region ?? null,
        v.amount_label ?? null,
        v.duration_label ?? null,
        v.compare_price_cents ?? null,
        id,
      )
      .run();
  }
}

/** Null out any variant that referenced a now-deleted gallery image. */
export async function clearVariantImage(db: D1Database, imageId: number): Promise<void> {
  await db
    .prepare('UPDATE product_variants SET image_id = NULL WHERE image_id = ?')
    .bind(imageId)
    .run();
}

export async function deleteVariant(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM product_variants WHERE id = ?').bind(id).run();
}

export async function createExtra(
  db: D1Database,
  productId: number,
  e: { label: string; price_delta_cents: number; position?: number },
): Promise<void> {
  const position = e.position ?? (await nextPosition(db, 'product_extras', productId));
  await withPublicId('extra', (publicId) =>
    db
      .prepare(
        `INSERT INTO product_extras (product_id, label, price_delta_cents, position, public_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(productId, e.label, e.price_delta_cents, position, publicId)
      .run(),
  );
}

/** Next position (MAX+1) for a product's variant/extra list — keeps new rows at the end. */
async function nextPosition(
  db: D1Database,
  table: 'product_variants' | 'product_extras',
  productId: number,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM ${table} WHERE product_id = ?`)
    .bind(productId)
    .first<{ m: number }>();
  return (row?.m ?? -1) + 1;
}

export async function updateExtra(
  db: D1Database,
  id: number,
  e: { label: string; price_delta_cents: number; position?: number },
): Promise<void> {
  if (typeof e.position === 'number') {
    await db
      .prepare('UPDATE product_extras SET label = ?, price_delta_cents = ?, position = ? WHERE id = ?')
      .bind(e.label, e.price_delta_cents, e.position, id)
      .run();
  } else {
    await db
      .prepare('UPDATE product_extras SET label = ?, price_delta_cents = ? WHERE id = ?')
      .bind(e.label, e.price_delta_cents, id)
      .run();
  }
}

export async function deleteExtra(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM product_extras WHERE id = ?').bind(id).run();
}

/**
 * Reject a mistyped variant weight with nothing written. This is separate from
 * applyVariantForm so the route can run it BEFORE the product/image/category
 * writes — validating mid-way produced a half-saved edit behind an error page,
 * and under weight pricing a silently dropped weight is a mis-quoted order.
 */
export function validateVariantWeights(
  form: FormData,
  weightUnit: WeightUnit,
): string | null {
  const raws = form.getAll('v_weight').map((v) => String(v));
  for (let i = 0; i < raws.length; i++) {
    const parsed = toGrams(raws[i]!, weightUnit);
    if (parsed.status !== 'error') continue;
    const what =
      parsed.reason === 'negative'
        ? 'weight cannot be negative.'
        : parsed.reason === 'precision'
          ? `weight has too many decimal places for ${weightUnit}.`
          : parsed.reason === 'over_limit'
            ? 'weight is too heavy for parcel shipping.'
            : 'weight must be a number.';
    return `Variant ${i + 1}: ${what}`;
  }
  return null;
}

export async function applyVariantForm(
  db: D1Database,
  productId: number,
  form: FormData,
  currency: string,
  weightUnit: WeightUnit = 'g',
): Promise<{ error?: string }> {
  const str = (name: string) => form.getAll(name).map((v) => String(v));
  const ids = (name: string) =>
    new Set(form.getAll(name).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0));
  const price = (s: string) => {
    const n = Number(String(s).trim());
    return Number.isFinite(n) && n > 0 ? toMinorUnits(n, currency) : 0;
  };
  const optionalPrice = (s: string): number | null => {
    const t = String(s ?? '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? toMinorUnits(n, currency) : null;
  };
  const count = (s: string) => {
    const n = Number(String(s).trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const weight = (s: string): number | null => {
    const parsed = toGrams(String(s ?? ''), weightUnit);
    return parsed.status === 'ok' ? parsed.grams : null;
  };
  const trimOrNull = (s: string | undefined) => (s ?? '').trim() || null;

  const invalid = validateVariantWeights(form, weightUnit);
  if (invalid) return { error: invalid };

  // The variant group label (null clears it).
  await setVariantLabel(db, productId, String(form.get('variant_group_label') ?? '').trim() || null);

  // Only allow image links to THIS product's gallery images.
  const galleryIds = new Set((await listProductImages(db, productId)).map((i) => i.id));
  const pickImage = (s: string): number | null => {
    const n = Number(String(s).trim());
    return Number.isInteger(n) && galleryIds.has(n) ? n : null;
  };

  // ── Variants ────────────────────────────────────────────────────────────────
  const vRemove = ids('v_remove');
  for (const vid of vRemove) {
    const v = await getVariant(db, vid);
    if (v && v.product_id === productId) await deleteVariant(db, vid);
  }
  const vIds = str('v_id');
  const vLabels = str('v_label');
  const vPrices = str('v_price');
  const vComparePrices = str('v_compare_price');
  const vStocks = str('v_stock');
  const vSkus = str('v_sku');
  const vImages = str('v_image');
  const vWeights = str('v_weight');
  const vRegions = str('v_region');
  const vAmounts = str('v_amount');
  const vDurations = str('v_duration');
  const vActives = str('v_active');

  let positionCounter = 0;
  for (let i = 0; i < vLabels.length; i++) {
    const id = Number(vIds[i]);
    const label = (vLabels[i] ?? '').trim();
    if (Number.isInteger(id) && vRemove.has(id)) continue; // already deleted
    const parsedWeight = weight(vWeights[i] ?? '');
    const unitPrice = price(vPrices[i] ?? '');
    const compareRaw = optionalPrice(vComparePrices[i] ?? '');
    const comparePriceCents = compareRaw != null && compareRaw > unitPrice ? compareRaw : null;
    const rawActive = vActives[i];
    const active = rawActive === undefined || rawActive === '' ? 1 : rawActive === '0' ? 0 : 1;

    const fields = {
      label,
      price_cents: unitPrice,
      stock: count(vStocks[i] ?? ''),
      sku: trimOrNull(vSkus[i]),
      image_id: pickImage(vImages[i] ?? ''),
      weight_grams: parsedWeight ?? null,
      position: positionCounter,
      active,
      region: trimOrNull(vRegions[i]),
      amount_label: trimOrNull(vAmounts[i]),
      duration_label: trimOrNull(vDurations[i]),
      compare_price_cents: comparePriceCents,
    };
    if (Number.isInteger(id) && id > 0) {
      if (!label) continue;
      const v = await getVariant(db, id);
      if (v && v.product_id === productId) {
        await updateVariant(db, id, fields);
        positionCounter++;
      }
    } else if (label) {
      await createVariant(db, productId, fields);
      positionCounter++;
    }
  }

  // ── Extras ──────────────────────────────────────────────────────────────────
  const eRemove = ids('e_remove');
  for (const eid of eRemove) {
    const e = await getExtra(db, eid);
    if (e && e.product_id === productId) await deleteExtra(db, eid);
  }
  const eIds = str('e_id');
  const eLabels = str('e_label');
  const ePrices = str('e_price');
  let extraPos = 0;
  for (let i = 0; i < eLabels.length; i++) {
    const id = Number(eIds[i]);
    const label = (eLabels[i] ?? '').trim();
    if (Number.isInteger(id) && eRemove.has(id)) continue;
    const fields = { label, price_delta_cents: price(ePrices[i] ?? ''), position: extraPos };
    if (Number.isInteger(id) && id > 0) {
      if (!label) continue;
      const e = await getExtra(db, id);
      if (e && e.product_id === productId) {
        await updateExtra(db, id, fields);
        extraPos++;
      }
    } else if (label) {
      await createExtra(db, productId, fields);
      extraPos++;
    }
  }
  return {};
}

/** Decrement a variant's stock (clamped at 0) — the variant is the inventory unit. */
export async function decrementVariantStock(
  db: D1Database,
  variantId: number,
  qty: number,
): Promise<void> {
  await db
    .prepare('UPDATE product_variants SET stock = MAX(0, stock - ?) WHERE id = ?')
    .bind(qty, variantId)
    .run();
}
