import type { Product } from '../products/db.ts';
import type { ProductVariant, ProductExtra } from '../products/variants.ts';
import type { ProductCheckoutField } from '../products/customFields.ts';
import { parseFieldOptions } from '../products/customFields.ts';
import { productImageUrl } from '../products/image.ts';
import { toMajorUnits } from '../../money.ts';

/** A purchasable variant in catalog form (price in both major + minor units). */
export interface CatalogVariant {
  /** Prefixed public ID (`var_…`) — never a row ID. */
  id: string;
  label: string;
  price: { amount: number; cents: number; currency: string };
  compare_price?: { amount: number; cents: number; currency: string } | null;
  region?: string | null;
  amount_label?: string | null;
  duration_label?: string | null;
  in_stock: boolean;
  sku: string | null;
}

/** A checkbox add-on in catalog form — a price delta layered on the line. */
export interface CatalogExtra {
  /** Prefixed public ID (`xtra_…`) — never a row ID. */
  id: string;
  label: string;
  price_delta: { amount: number; cents: number; currency: string };
}

export interface CatalogCheckoutField {
  id: string;
  key: string;
  label: string;
  type: ProductCheckoutField['field_type'];
  placeholder: string | null;
  help_text: string | null;
  options: string[];
  required: boolean;
  min_length: number | null;
  max_length: number | null;
}

/**
 * The public, machine-readable shape of a product — what the `/api/products`
 * catalog endpoints return for agents/tools. Stable, self-describing, with
 * ABSOLUTE urls so a consumer needs no base-url knowledge. Pure (no bindings) so
 * it's unit-testable and reusable across the list + detail routes.
 */
export interface CatalogProduct {
  /** Prefixed public ID (`prod_…`) — never a row ID. */
  id: string;
  slug: string;
  name: string;
  short_description?: string | null;
  description: string | null;
  brand?: string | null;
  region?: string | null;
  badge?: string | null;
  estimated_delivery?: string | null;
  price: { amount: number; cents: number; currency: string };
  compare_price?: { amount: number; cents: number; currency: string } | null;
  in_stock: boolean;
  variant_label: string | null;
  categories: string[];
  image: string;
  url: string;
  variants?: CatalogVariant[];
  extras?: CatalogExtra[];
  checkout_fields?: CatalogCheckoutField[];
}

const money = (cents: number, currency: string) => ({
  amount: toMajorUnits(cents, currency), // major units (e.g. 24.0)
  cents, // minor units
  currency: currency.toUpperCase(),
});

/**
 * Serialize a product (+ its category names) into the catalog shape.
 * Digital products (`requires_shipping === 0`) derive availability strictly from
 * `active === 1` rather than legacy `stock`.
 */
export function toCatalogProduct(
  p: Product,
  categoryNames: string[],
  origin: string,
  options?: {
    variants?: ProductVariant[];
    extras?: ProductExtra[];
    checkoutFields?: ProductCheckoutField[];
    imageBaseUrl?: string;
  },
): CatalogProduct {
  const variants = options?.variants;
  const extras = options?.extras;
  const checkoutFields = options?.checkoutFields;
  const hasVariants = !!variants && variants.length > 0;
  const isDigital = p.requires_shipping !== 1;

  const isVariantAvailable = (v: ProductVariant) =>
    v.active === 1 && (isDigital || v.stock > 0);
  const isProductAvailable =
    p.active === 1 && (isDigital || p.stock > 0);

  const out: CatalogProduct = {
    id: requirePublicId(p.public_id, p.id, 'product'),
    slug: p.slug,
    name: p.name,
    ...(p.short_description !== undefined ? { short_description: p.short_description } : {}),
    description: p.description,
    ...(p.brand !== undefined ? { brand: p.brand } : {}),
    ...(p.region !== undefined ? { region: p.region } : {}),
    ...(p.badge !== undefined ? { badge: p.badge } : {}),
    ...(p.estimated_delivery !== undefined ? { estimated_delivery: p.estimated_delivery } : {}),
    price: money(p.price_cents, p.currency),
    ...(p.compare_price_cents != null && p.compare_price_cents > p.price_cents
      ? { compare_price: money(p.compare_price_cents, p.currency) }
      : {}),
    in_stock: hasVariants ? variants!.some(isVariantAvailable) : isProductAvailable,
    variant_label: p.variant_label,
    categories: categoryNames,
    image: new URL(productImageUrl(p.image_key, options?.imageBaseUrl ?? ''), origin).href,
    url: new URL(`/products/${p.slug}`, origin).href,
  };

  if (variants) {
    out.variants = variants.map((v) => ({
      id: requirePublicId(v.public_id, v.id, 'variant'),
      label: v.label,
      price: money(v.price_cents, p.currency),
      ...(v.compare_price_cents != null && v.compare_price_cents > v.price_cents
        ? { compare_price: money(v.compare_price_cents, p.currency) }
        : {}),
      ...(v.region !== undefined ? { region: v.region } : {}),
      ...(v.amount_label !== undefined ? { amount_label: v.amount_label } : {}),
      ...(v.duration_label !== undefined ? { duration_label: v.duration_label } : {}),
      in_stock: isVariantAvailable(v),
      sku: v.sku,
    }));
  }
  if (extras) {
    out.extras = extras.map((e) => ({
      id: requirePublicId(e.public_id, e.id, 'extra'),
      label: e.label,
      price_delta: money(e.price_delta_cents, p.currency),
    }));
  }
  if (checkoutFields) {
    out.checkout_fields = checkoutFields
      .filter((f) => f.is_active === 1)
      .map((f) => ({
        id: requirePublicId(f.public_id, f.id, 'checkout field'),
        key: f.field_key,
        label: f.label,
        type: f.field_type,
        placeholder: f.placeholder,
        help_text: f.help_text,
        options: parseFieldOptions(f.options_json),
        required: f.is_required === 1,
        min_length: f.min_length,
        max_length: f.max_length,
      }));
  }
  return out;
}

/**
 * A row reaching a public serializer without its public ID is a deploy-order
 * bug (backfill must run before cutover) — fail loudly rather than leak the
 * numeric row ID.
 */
export function requirePublicId(publicId: string | null, rowId: number, kind: string): string {
  if (!publicId) throw new Error(`${kind} row ${rowId} has no public_id — run the backfill`);
  return publicId;
}
