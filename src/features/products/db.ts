import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, withPublicId } from '../ids/publicId.ts';
import { uniqueSlug } from './slug.ts';
import { copyProductCheckoutFields } from './customFieldsDb.ts';

export interface Product {
  id: number;
  public_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  price_cents: number;
  currency: string;
  image_key: string | null;
  stock: number;
  active: number;
  variant_label: string | null; // variant group display name (e.g. "Size"); null = no variants
  /** Packed item weight in grams; NULL = unknown (never "zero" — see 0030). */
  weight_grams: number | null;
  /** 0 = digital/no fulfillment: excluded from shipment weight and from the
   *  missing-weight check, so a mixed cart can still check out. */
  requires_shipping: number;
  file_key: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size_bytes: number | null;
  /** Precomputed semantic neighbours as a JSON id array; null = not computed yet
   *  (see migration 0024 / features/search relatedIds). */
  related_ids: string | null;
  created_at: string;
  // GarGift+ Phase 1 digital catalog fields (optional for backwards compatibility with existing fixtures)
  short_description?: string | null;
  brand?: string | null;
  region?: string | null;
  badge?: string | null;
  is_featured?: number;
  display_order?: number;
  faq_json?: string | null;
  instructions?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  compare_price_cents?: number | null;
  estimated_delivery?: string | null;
}

/** Scalar fields parsed from the product form (image handled separately). */
export interface ProductFields {
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  stock: number;
  active: number;
  weight_grams: number | null;
  requires_shipping: number;
  short_description?: string | null;
  brand?: string | null;
  region?: string | null;
  badge?: string | null;
  is_featured?: number;
  display_order?: number;
  faq_json?: string | null;
  instructions?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  compare_price_cents?: number | null;
  estimated_delivery?: string | null;
}

/** Full input for create/update — form fields plus resolved image key + slug. */
export interface ProductInput extends ProductFields {
  image_key: string | null;
  slug: string;
}

/** A page of active products for the storefront, newest first. */
export async function listProducts(
  db: D1Database,
  limit: number,
  offset = 0,
  orderBy = 'created_at DESC',
): Promise<Product[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM products WHERE active = 1 ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<Product>();
  return results ?? [];
}

/** Total active products (for pagination). */
export async function countProducts(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface StoreCatalogFilter {
  categorySlug?: string | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  searchQuery?: string | null;
  featuredOnly?: boolean;
  discountedOnly?: boolean;
}

function buildStoreCatalogWhere(filter: StoreCatalogFilter): {
  where: string;
  params: (string | number)[];
} {
  const clauses: string[] = ['p.active = 1'];
  const params: (string | number)[] = [];

  if (filter.categorySlug) {
    clauses.push(
      `EXISTS (
        WITH RECURSIVE sub(id) AS (
          SELECT id FROM categories WHERE slug = ?
          UNION ALL
          SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
        )
        SELECT 1 FROM product_categories pc
        WHERE pc.product_id = p.id AND pc.category_id IN (SELECT id FROM sub)
      )`,
    );
    params.push(filter.categorySlug);
  }
  if (filter.minPriceCents != null && Number.isInteger(filter.minPriceCents) && filter.minPriceCents >= 0) {
    clauses.push('p.price_cents >= ?');
    params.push(filter.minPriceCents);
  }
  if (filter.maxPriceCents != null && Number.isInteger(filter.maxPriceCents) && filter.maxPriceCents >= 0) {
    clauses.push('p.price_cents <= ?');
    params.push(filter.maxPriceCents);
  }
  if (filter.featuredOnly) {
    clauses.push('p.is_featured = 1');
  }
  if (filter.discountedOnly) {
    clauses.push('p.compare_price_cents IS NOT NULL AND p.compare_price_cents > p.price_cents');
  }
  if (filter.searchQuery) {
    const escaped = filter.searchQuery.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pat = `%${escaped}%`;
    clauses.push(
      "(p.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(p.brand, '') LIKE ? ESCAPE '\\' COLLATE NOCASE OR COALESCE(p.short_description, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)",
    );
    params.push(pat, pat, pat);
  }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

export async function listFilteredStoreProducts(
  db: D1Database,
  filter: StoreCatalogFilter,
  limit: number,
  offset = 0,
  orderBy = 'is_featured DESC, display_order ASC, created_at DESC, id DESC',
): Promise<Product[]> {
  const { where, params } = buildStoreCatalogWhere(filter);
  const { results } = await db
    .prepare(
      `SELECT p.*,
              COALESCE((
                SELECT SUM(oi.quantity)
                  FROM order_items oi
                  JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = p.id AND o.status = 'paid'
              ), 0) AS sold
         FROM products p
        ${where}
        ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .bind(...params, limit, offset)
    .all<Product>();
  return results ?? [];
}

export async function countFilteredStoreProducts(
  db: D1Database,
  filter: StoreCatalogFilter,
): Promise<number> {
  const { where, params } = buildStoreCatalogWhere(filter);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM products p ${where}`)
    .bind(...params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** A product row plus its lifetime units sold (paid orders only). */
export interface AdminProduct extends Product {
  sold: number;
}

/**
 * A prebuilt WHERE clause and its bound values, from features/products/filter.ts.
 * Pass the SAME value to listAllProducts and countAllProducts.
 */
export interface ProductFilter {
  where: string;
  params: (string | number)[];
}
const EMPTY_PRODUCT_FILTER: ProductFilter = { where: '', params: [] };

export async function listAllProducts(
  db: D1Database,
  limit: number,
  offset = 0,
  orderBy = 'created_at DESC',
  filter: ProductFilter = EMPTY_PRODUCT_FILTER,
): Promise<AdminProduct[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*,
              COALESCE((
                SELECT SUM(oi.quantity)
                  FROM order_items oi
                  JOIN orders o ON o.id = oi.order_id
                 WHERE oi.product_id = p.id AND o.status = 'paid'
              ), 0) AS sold
         FROM products p
        ${filter.where}
        ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .bind(...filter.params, limit, offset)
    .all<AdminProduct>();
  return results ?? [];
}

/** Total products including inactive (for admin pagination). */
export async function countAllProducts(
  db: D1Database,
  filter: ProductFilter = EMPTY_PRODUCT_FILTER,
): Promise<number> {
  // Aliased `p` even without a join: the filter fragments are written against
  // the same alias listAllProducts uses, so one clause serves both queries.
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM products p ${filter.where}`)
    .bind(...filter.params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Stable keyset page for catalog-wide background/admin jobs. Unlike the admin
 * table query this does not calculate sales totals, and unlike OFFSET pagination
 * it keeps making progress if rows are removed while a job is running.
 */
export async function listProductsAfterId(
  db: D1Database,
  afterId: number,
  limit: number,
): Promise<Product[]> {
  const { results } = await db
    .prepare('SELECT * FROM products WHERE id > ? ORDER BY id ASC LIMIT ?')
    .bind(afterId, limit)
    .all<Product>();
  return results ?? [];
}

/** Single product by id, or null if missing. */
/**
 * Active products for a list of ids, returned IN THE ORDER of `ids` (so a ranked
 * search — e.g. vector similarity — keeps its ordering). Missing/inactive dropped.
 */
/**
 * Parse the stored `related_ids` JSON. Returns null when it was never computed
 * (so the caller can backfill), or [] when computed and genuinely empty. Never
 * throws — a malformed value is treated as "not computed".
 */
export function parseRelatedIds(raw: string | null): number[] | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
  } catch {
    return null;
  }
}

/** Persist a product's precomputed semantic neighbours (see migration 0024). */
export async function setRelatedIds(
  db: D1Database,
  productId: number,
  ids: number[],
): Promise<void> {
  await db
    .prepare('UPDATE products SET related_ids = ? WHERE id = ?')
    .bind(JSON.stringify(ids), productId)
    .run();
}

export async function getProductsByIds(db: D1Database, ids: number[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM products WHERE id IN (${placeholders}) AND active = 1`)
    .bind(...ids)
    .all<Product>();
  const byId = new Map((results ?? []).map((p) => [p.id, p]));
  return ids.map((id) => byId.get(id)).filter((p): p is Product => p !== undefined);
}

/** Active products for many public IDs in one cart-resolution read. */
export async function getProductsByPublicIds(
  db: D1Database,
  publicIds: string[],
): Promise<Product[]> {
  if (publicIds.length === 0) return [];
  const placeholders = publicIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM products WHERE public_id IN (${placeholders}) AND active = 1`)
    .bind(...publicIds)
    .all<Product>();
  return results ?? [];
}

export async function getProduct(db: D1Database, id: number): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE id = ?').bind(id).first<Product>();
}

/** Active products at or below a stock threshold, lowest first (for the dashboard). */
export async function lowStockProducts(
  db: D1Database,
  threshold: number,
  limit = 8,
): Promise<Product[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM products WHERE active = 1 AND stock <= ? ORDER BY stock ASC, name LIMIT ?',
    )
    .bind(threshold, limit)
    .all<Product>();
  return results ?? [];
}

/** A row in the product image gallery. */
export interface ProductImageRow {
  id: number;
  product_id: number;
  image_key: string;
  position: number;
  alt: string | null;
  public_id: string | null;
}

/** All gallery images for a product, primary-ish first (by position). */
export async function listProductImages(
  db: D1Database,
  productId: number,
): Promise<ProductImageRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY position, id')
    .bind(productId)
    .all<ProductImageRow>();
  return results ?? [];
}

/** Append an image to a product's gallery (next position). */
export async function addProductImage(
  db: D1Database,
  productId: number,
  imageKey: string,
): Promise<void> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?')
    .bind(productId)
    .first<{ m: number }>();
  await withPublicId('productImage', (publicId) =>
    db
      .prepare('INSERT INTO product_images (product_id, image_key, position, public_id) VALUES (?, ?, ?, ?)')
      .bind(productId, imageKey, (row?.m ?? -1) + 1, publicId)
      .run(),
  );
}

export async function getProductImage(
  db: D1Database,
  imageId: number,
): Promise<ProductImageRow | null> {
  return db.prepare('SELECT * FROM product_images WHERE id = ?').bind(imageId).first<ProductImageRow>();
}

export async function deleteProductImageRow(db: D1Database, imageId: number): Promise<void> {
  await db.prepare('DELETE FROM product_images WHERE id = ?').bind(imageId).run();
}

/** Keep gallery references valid when the legacy single-image update path replaces a key. */
export async function replaceProductImageKey(
  db: D1Database,
  productId: number,
  oldKey: string,
  newKey: string,
): Promise<void> {
  await db
    .prepare(
      'UPDATE product_images SET image_key = ? WHERE product_id = ? AND image_key = ?',
    )
    .bind(newKey, productId, oldKey)
    .run();
}

/** Set an image's alt text (empty string → null). */
export async function setProductImageAlt(
  db: D1Database,
  imageId: number,
  alt: string,
): Promise<void> {
  await db
    .prepare('UPDATE product_images SET alt = ? WHERE id = ?')
    .bind(alt.trim() || null, imageId)
    .run();
}

/** Swap an image's position with its neighbor (no-op at the list boundary). */
export async function moveProductImage(
  db: D1Database,
  imageId: number,
  direction: 'up' | 'down',
): Promise<void> {
  const img = await getProductImage(db, imageId);
  if (!img) return;
  const neighbor =
    direction === 'up'
      ? await db
          .prepare(
            'SELECT * FROM product_images WHERE product_id = ? AND position < ? ORDER BY position DESC LIMIT 1',
          )
          .bind(img.product_id, img.position)
          .first<ProductImageRow>()
      : await db
          .prepare(
            'SELECT * FROM product_images WHERE product_id = ? AND position > ? ORDER BY position ASC LIMIT 1',
          )
          .bind(img.product_id, img.position)
          .first<ProductImageRow>();
  if (!neighbor) return; // already at the top/bottom
  await db.batch([
    db.prepare('UPDATE product_images SET position = ? WHERE id = ?').bind(neighbor.position, img.id),
    db.prepare('UPDATE product_images SET position = ? WHERE id = ?').bind(img.position, neighbor.id),
  ]);
}

/** Set positions to match the given id order (ids not on this product are ignored). */
export async function reorderProductImages(
  db: D1Database,
  productId: number,
  orderedIds: number[],
): Promise<void> {
  const existing = await listProductImages(db, productId);
  const valid = new Set(existing.map((i) => i.id));
  const ids = orderedIds.filter((id) => valid.has(id));
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, idx) =>
      db
        .prepare('UPDATE product_images SET position = ? WHERE id = ? AND product_id = ?')
        .bind(idx, id, productId),
    ),
  );
}

/** Set a product's primary image key (the denormalized thumbnail). */
export async function setPrimaryImage(
  db: D1Database,
  productId: number,
  imageKey: string | null,
): Promise<void> {
  await db.prepare('UPDATE products SET image_key = ? WHERE id = ?').bind(imageKey, productId).run();
}

/**
 * Keep `products.image_key` in sync with the gallery: the PRIMARY is always the
 * first image (lowest position). Call after any gallery mutation.
 */
export async function syncPrimaryImage(db: D1Database, productId: number): Promise<void> {
  const imgs = await listProductImages(db, productId);
  await setPrimaryImage(db, productId, imgs[0]?.image_key ?? null);
}

/** Move an image to the front of the gallery (→ becomes the primary). */
export async function makeImagePrimary(
  db: D1Database,
  productId: number,
  imageId: number,
): Promise<void> {
  const imgs = await listProductImages(db, productId);
  const newOrder = [imageId, ...imgs.map((i) => i.id).filter((iid) => iid !== imageId)];
  await reorderProductImages(db, productId, newOrder);
  await syncPrimaryImage(db, productId);
}

/** Product by its prefixed public ID (boundary resolution; null if missing). */
export async function getProductByPublicId(db: D1Database, publicId: string): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE public_id = ?').bind(publicId).first<Product>();
}

/** Single product by public slug, or null if missing. */
export async function getProductBySlug(db: D1Database, slug: string): Promise<Product | null> {
  return db.prepare('SELECT * FROM products WHERE slug = ?').bind(slug).first<Product>();
}

/** Insert a product and return its new id (needed for category links). */
export async function createProduct(db: D1Database, p: ProductInput): Promise<number> {
  return withPublicId('product', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO products (
           name, slug, description, price_cents, currency, image_key, stock, active,
           weight_grams, requires_shipping, public_id,
           short_description, brand, region, badge, is_featured, display_order,
           faq_json, instructions, seo_title, seo_description, compare_price_cents, estimated_delivery
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(
        p.name,
        p.slug,
        p.description,
        p.price_cents,
        p.currency,
        p.image_key,
        p.stock,
        p.active,
        p.weight_grams,
        p.requires_shipping,
        publicId,
        p.short_description ?? null,
        p.brand ?? null,
        p.region ?? null,
        p.badge ?? null,
        p.is_featured ?? 0,
        p.display_order ?? 0,
        p.faq_json ?? null,
        p.instructions ?? null,
        p.seo_title ?? null,
        p.seo_description ?? null,
        p.compare_price_cents ?? null,
        p.estimated_delivery ?? null,
      )
      .first<{ id: number }>();
    return row!.id;
  });
}

export async function updateProduct(db: D1Database, id: number, p: ProductInput): Promise<void> {
  await db
    .prepare(
      `UPDATE products
          SET name = ?, slug = ?, description = ?, price_cents = ?, currency = ?, image_key = ?, stock = ?, active = ?,
              weight_grams = ?, requires_shipping = ?,
              short_description = ?, brand = ?, region = ?, badge = ?, is_featured = ?, display_order = ?,
              faq_json = ?, instructions = ?, seo_title = ?, seo_description = ?,
              compare_price_cents = ?, estimated_delivery = ?
        WHERE id = ?`,
    )
    .bind(
      p.name,
      p.slug,
      p.description,
      p.price_cents,
      p.currency,
      p.image_key,
      p.stock,
      p.active,
      p.weight_grams,
      p.requires_shipping,
      p.short_description ?? null,
      p.brand ?? null,
      p.region ?? null,
      p.badge ?? null,
      p.is_featured ?? 0,
      p.display_order ?? 0,
      p.faq_json ?? null,
      p.instructions ?? null,
      p.seo_title ?? null,
      p.seo_description ?? null,
      p.compare_price_cents ?? null,
      p.estimated_delivery ?? null,
      id,
    )
    .run();
}

export async function toggleProductActive(
  db: D1Database,
  id: number,
  active: 0 | 1,
): Promise<void> {
  await db.prepare('UPDATE products SET active = ? WHERE id = ?').bind(active, id).run();
}

/**
 * Duplicate a product cleanly as an inactive draft (`active = 0`), copying its
 * digital metadata, categories, gallery image associations, variants (with remapped
 * image references), extras, and custom checkout fields.
 */
export async function duplicateProduct(
  db: D1Database,
  sourceId: number,
): Promise<number | null> {
  const source = await getProduct(db, sourceId);
  if (!source) return null;

  const newSlug = await uniqueSlug(db, `${source.slug}-copy`);
  const newName = `${source.name} (کپی)`;
  const newProductId = await createProduct(db, {
    name: newName,
    slug: newSlug,
    description: source.description,
    price_cents: source.price_cents,
    currency: source.currency,
    image_key: source.image_key,
    stock: source.stock,
    active: 0,
    weight_grams: source.weight_grams,
    requires_shipping: source.requires_shipping,
    short_description: source.short_description ?? null,
    brand: source.brand ?? null,
    region: source.region ?? null,
    badge: source.badge ?? null,
    is_featured: 0,
    display_order: (source.display_order ?? 0) + 1,
    faq_json: source.faq_json ?? null,
    instructions: source.instructions ?? null,
    seo_title: source.seo_title ?? null,
    seo_description: source.seo_description ?? null,
    compare_price_cents: source.compare_price_cents ?? null,
    estimated_delivery: source.estimated_delivery ?? null,
  });

  if (source.variant_label) {
    await db
      .prepare('UPDATE products SET variant_label = ? WHERE id = ?')
      .bind(source.variant_label, newProductId)
      .run();
  }

  // Copy categories
  const { results: catRows } = await db
    .prepare('SELECT category_id FROM product_categories WHERE product_id = ?')
    .bind(sourceId)
    .all<{ category_id: number }>();
  if (catRows && catRows.length > 0) {
    await db.batch(
      catRows.map((c) =>
        db
          .prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)')
          .bind(newProductId, c.category_id),
      ),
    );
  }

  // Copy gallery images and map old image_id -> new image_id
  const sourceImages = await listProductImages(db, sourceId);
  const imageIdMap = new Map<number, number>();
  for (const img of sourceImages) {
    const inserted = await db
      .prepare(
        `INSERT INTO product_images (product_id, image_key, position, alt, public_id)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(newProductId, img.image_key, img.position, img.alt, generatePublicId('productImage'))
      .first<{ id: number }>();
    if (inserted) imageIdMap.set(img.id, inserted.id);
  }

  // Copy variants
  const { results: variantRows } = await db
    .prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY position, id')
    .bind(sourceId)
    .all<{
      label: string;
      price_cents: number;
      stock: number;
      sku: string | null;
      position: number;
      active: number;
      image_id: number | null;
      weight_grams: number | null;
      region?: string | null;
      amount_label?: string | null;
      duration_label?: string | null;
      compare_price_cents?: number | null;
    }>();
  if (variantRows && variantRows.length > 0) {
    await db.batch(
      variantRows.map((v) =>
        db
          .prepare(
            `INSERT INTO product_variants (
               product_id, label, price_cents, stock, sku, position, active, image_id, weight_grams,
               region, amount_label, duration_label, compare_price_cents, public_id
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            newProductId,
            v.label,
            v.price_cents,
            v.stock,
            v.sku,
            v.position,
            v.active,
            v.image_id != null ? (imageIdMap.get(v.image_id) ?? null) : null,
            v.weight_grams,
            v.region ?? null,
            v.amount_label ?? null,
            v.duration_label ?? null,
            v.compare_price_cents ?? null,
            generatePublicId('variant'),
          ),
      ),
    );
  }

  // Copy extras
  const { results: extraRows } = await db
    .prepare('SELECT * FROM product_extras WHERE product_id = ? ORDER BY position, id')
    .bind(sourceId)
    .all<{ label: string; price_delta_cents: number; position: number; active: number }>();
  if (extraRows && extraRows.length > 0) {
    await db.batch(
      extraRows.map((e) =>
        db
          .prepare(
            `INSERT INTO product_extras (product_id, label, price_delta_cents, position, active, public_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(newProductId, e.label, e.price_delta_cents, e.position, e.active, generatePublicId('extra')),
      ),
    );
  }

  // Copy custom checkout fields
  await copyProductCheckoutFields(db, sourceId, newProductId);

  return newProductId;
}

/** Attach/replace a private deliverable. Old object keys are intentionally retained. */
export async function setProductFile(
  db: D1Database,
  id: number,
  file: { key: string; name: string; mime: string; size: number } | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE products SET file_key = ?, file_name = ?, file_mime = ?, file_size_bytes = ?
        WHERE id = ?`,
    )
    .bind(file?.key ?? null, file?.name ?? null, file?.mime ?? null, file?.size ?? null, id)
    .run();
}

export async function deleteProduct(db: D1Database, id: number): Promise<void> {
  // Detach order history rows (preserving immutable snapshots) and clear dependent links before deleting.
  await db.batch([
    db.prepare('UPDATE order_items SET product_id = NULL WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_checkout_fields WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_extras WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_categories WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM products WHERE id = ?').bind(id),
  ]);
}
