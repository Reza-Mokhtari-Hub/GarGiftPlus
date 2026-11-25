import type { Product } from '../products/db.ts';
import { productImageSources, type ImageDelivery } from '../products/image.ts';
import { requirePublicId } from '../catalog/serialize.ts';
import { stockState } from '../products/stock.ts';
import { formatMoney } from '../../money.ts';
import { fa } from '../../i18n/fa.ts';
import type { ProductCardModel, StorefrontImage } from './models.ts';

/**
 * Builders that turn authoritative product data into the presentation models
 * store-owned templates receive. Pure: no D1, no R2, no request context.
 */

export interface StorefrontImageOptions {
  /** config.images.baseUrl. Empty string keeps original `/images/...` delivery. */
  baseUrl?: string;
  /** The store's runtime image-delivery setting, already read from settings. */
  delivery?: ImageDelivery;
  /** Browser sizing hint for the slot this image occupies. */
  sizes?: string;
  /** Marks the page's likely LCP image. */
  priority?: boolean;
}

export function buildStorefrontImage(
  imageKey: string | null,
  alt: string,
  options: StorefrontImageOptions = {},
): StorefrontImage {
  const priority = options.priority ?? false;
  const sources = productImageSources(imageKey, {
    baseUrl: options.baseUrl,
    delivery: options.delivery,
    usage: priority ? 'detail' : 'card',
    sizes: options.sizes,
  });

  return {
    src: sources.src,
    ...(sources.srcset ? { srcset: sources.srcset } : {}),
    ...(sources.sizes ? { sizes: sources.sizes } : {}),
    alt,
    priority,
  };
}

export interface ProductCardOptions extends StorefrontImageOptions {
  currency: string;
}

/**
 * A product row as a card.
 * Digital products (`requires_shipping !== 1`) determine availability strictly
 * from `product.active === 1`, completely decoupled from legacy `stock`.
 */
export function buildProductCard(
  product: Product,
  options: ProductCardOptions,
): ProductCardModel {
  const isDigital = product.requires_shipping !== 1;
  const inStock = isDigital
    ? product.active === 1
    : product.active === 1 && stockState(product.stock) !== 'out';

  const hasCompare =
    product.compare_price_cents != null &&
    product.compare_price_cents > product.price_cents &&
    product.compare_price_cents > 0;

  const effectiveCurrency = product.currency?.trim() || options.currency;
  const formattedComparePrice = hasCompare
    ? formatMoney(product.compare_price_cents!, effectiveCurrency)
    : null;
  const discountPercent = hasCompare
    ? Math.round(
        ((product.compare_price_cents! - product.price_cents) / product.compare_price_cents!) * 100,
      )
    : null;

  return {
    id: requirePublicId(product.public_id, product.id, 'product'),
    name: product.name,
    href: `/products/${product.slug}`,
    image: buildStorefrontImage(product.image_key, product.name, options),
    formattedPrice: formatMoney(product.price_cents, effectiveCurrency),
    inStock,
    badge: product.badge ?? null,
    brand: product.brand ?? null,
    region: product.region ?? null,
    formattedComparePrice,
    discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null,
    isFeatured: product.is_featured === 1,
    availabilityLabel: inStock ? fa.product.available : fa.product.inactive,
  };
}
