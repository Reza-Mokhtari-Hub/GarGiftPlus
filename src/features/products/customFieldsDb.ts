import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, withPublicId } from '../ids/publicId.ts';
import type { ProductCheckoutField, ProductCheckoutFieldInput } from './customFields.ts';

/** Read checkout fields for a product in display order. */
export async function listProductCheckoutFields(
  db: D1Database,
  productId: number,
  includeInactive = false,
): Promise<ProductCheckoutField[]> {
  const where = includeInactive ? '' : ' AND is_active = 1';
  const { results } = await db
    .prepare(
      `SELECT * FROM product_checkout_fields
        WHERE product_id = ?${where}
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(productId)
    .all<ProductCheckoutField>();
  return results ?? [];
}

/**
 * Replace a product's custom checkout fields cleanly inside one transaction-like
 * sequence, preserving matching `public_id`s where supplied and generating new
 * `pfld_` IDs for added rows.
 */
export async function replaceProductCheckoutFields(
  db: D1Database,
  productId: number,
  fields: ProductCheckoutFieldInput[],
): Promise<void> {
  const existing = await listProductCheckoutFields(db, productId, true);
  const existingPublicIds = new Set(existing.map((f) => f.public_id).filter(Boolean));

  await db.prepare('DELETE FROM product_checkout_fields WHERE product_id = ?').bind(productId).run();

  for (const field of fields) {
    const optionsJson = field.options.length > 0 ? JSON.stringify(field.options) : null;
    const preferredPid =
      field.public_id && existingPublicIds.has(field.public_id) ? field.public_id : null;

    if (preferredPid) {
      await db
        .prepare(
          `INSERT INTO product_checkout_fields
             (public_id, product_id, field_key, label, field_type, placeholder, help_text,
              options_json, is_required, min_length, max_length, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          preferredPid,
          productId,
          field.field_key,
          field.label,
          field.field_type,
          field.placeholder,
          field.help_text,
          optionsJson,
          field.is_required,
          field.min_length,
          field.max_length,
          field.sort_order,
          field.is_active,
        )
        .run();
    } else {
      await withPublicId('checkoutField', (publicId) =>
        db
          .prepare(
            `INSERT INTO product_checkout_fields
               (public_id, product_id, field_key, label, field_type, placeholder, help_text,
                options_json, is_required, min_length, max_length, sort_order, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            publicId,
            productId,
            field.field_key,
            field.label,
            field.field_type,
            field.placeholder,
            field.help_text,
            optionsJson,
            field.is_required,
            field.min_length,
            field.max_length,
            field.sort_order,
            field.is_active,
          )
          .run(),
      );
    }
  }
}

/** Duplicate all custom checkout fields from one product to another. */
export async function copyProductCheckoutFields(
  db: D1Database,
  sourceProductId: number,
  targetProductId: number,
): Promise<void> {
  const fields = await listProductCheckoutFields(db, sourceProductId, true);
  if (fields.length === 0) return;

  const stmts = fields.map((f) =>
    db
      .prepare(
        `INSERT INTO product_checkout_fields
           (public_id, product_id, field_key, label, field_type, placeholder, help_text,
            options_json, is_required, min_length, max_length, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        generatePublicId('checkoutField'),
        targetProductId,
        f.field_key,
        f.label,
        f.field_type,
        f.placeholder,
        f.help_text,
        f.options_json,
        f.is_required,
        f.min_length,
        f.max_length,
        f.sort_order,
        f.is_active,
      ),
  );
  await db.batch(stmts);
}
