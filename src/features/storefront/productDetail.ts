import type { D1Database } from '@cloudflare/workers-types';
import type { StoreSettings } from '../settings/db';
import { getProductBySlug, listProductImages, type Product } from '../products/db';
import { listVariants, listExtras, type ProductVariant } from '../products/variants';
import { listProductCheckoutFields } from '../products/customFieldsDb';
import { parseFaqJson, parseFieldOptions } from '../products/customFields';
import { categoriesForProduct, relatedProducts } from '../categories/db';
import { getRelatedStored, storeRelatedIds } from '../search';
import { enabledMethods } from '../payments';
import { markdownExcerpt, renderMarkdown } from '../pages/markdown.ts';
import { productImageSources, productImageUrl, type ImageDelivery } from '../products/image';
import { stockState } from '../products/stock';
import { catalogPath } from '../settings/home';
import { formatMoney, toMajorUnits, currencyDecimals } from '../../money';
import { requirePublicId } from '../catalog/serialize';
import { fa } from '../../i18n/fa';
import { buildProductCard } from './productCard';
import type {
  ProductDetailModel,
  ProductPurchaseModel,
  ProductSeoModel,
  StorefrontGalleryImage,
  StorefrontImage,
} from './models';

/**
 * The product-detail loader.
 *
 * Parallel graph reads, custom checkout fields, variants/extras availability,
 * gallery derivation, SEO, runtime payment toggles, and purchase form models.
 */

const RELATED_TARGET = 4;
const HERO_SIZES = '(min-width: 768px) 528px, calc(100vw - 48px)';
const THUMBNAIL_SIZES = '64px';
const RELATED_CARD_SIZES = '(min-width: 1024px) 252px, calc(50vw - 36px)';

export type LoadedProductDetail =
  | { status: 'not_found' }
  | {
      status: 'ok';
      model: ProductDetailModel;
      seo: ProductSeoModel;
      purchase: ProductPurchaseModel;
      cacheTagIds: (string | null)[];
      backfillRelated: (() => Promise<void>) | null;
    };

export interface ProductDetailOptions {
  slug: string | undefined;
  searchParams: URLSearchParams;
  settings: StoreSettings | undefined;
  imageBaseUrl: string;
  delivery: ImageDelivery | undefined;
  currency: string;
  origin: string;
  pathname: string;
}

function heroImage(product: Product, options: ProductDetailOptions): StorefrontImage {
  const sources = productImageSources(product.image_key, {
    baseUrl: options.imageBaseUrl,
    delivery: options.delivery,
    usage: 'detail',
    sizes: HERO_SIZES,
  });
  return {
    src: sources.src,
    ...(sources.srcset ? { srcset: sources.srcset } : {}),
    ...(sources.sizes ? { sizes: sources.sizes } : {}),
    alt: product.name,
    priority: true,
  };
}

export async function loadProductDetail(
  db: D1Database,
  options: ProductDetailOptions,
): Promise<LoadedProductDetail> {
  const product = options.slug ? await getProductBySlug(db, options.slug) : null;
  if (!product) return { status: 'not_found' };

  const [categories, storedRelated, variants, extras, gallery, checkoutFields] = await Promise.all([
    categoriesForProduct(db, product.id),
    getRelatedStored(product, RELATED_TARGET),
    listVariants(db, product.id, true),
    listExtras(db, product.id),
    listProductImages(db, product.id),
    listProductCheckoutFields(db, product.id),
  ]);

  const semantic = storedRelated ?? [];
  let related = semantic;
  if (related.length < RELATED_TARGET) {
    const seen = new Set(related.map((p) => p.id));
    const byCategory = await relatedProducts(db, product.id, RELATED_TARGET + semantic.length);
    related = [...related, ...byCategory.filter((p) => !seen.has(p.id))].slice(0, RELATED_TARGET);
  }

  const hasVariants = variants.length > 0;
  const isDigital = product.requires_shipping !== 1;
  const state = stockState(product.stock);

  const isVariantUnavailable = (v: ProductVariant) =>
    v.active !== 1 || (!isDigital && v.stock <= 0);

  // Availability is governed by active flags for digital services; legacy stock applies only to physical items.
  const soldOut =
    product.active !== 1 ||
    (hasVariants ? variants.every(isVariantUnavailable) : !isDigital && state === 'out');

  const firstAvailableIndex = variants.findIndex((v) => !isVariantUnavailable(v));
  const defaultVariant = firstAvailableIndex >= 0 ? variants[firstAvailableIndex] : variants[0] ?? null;

  const variantPrices = variants.map((v) => v.price_cents);
  const displayPriceCents = hasVariants ? Math.min(...variantPrices) : product.price_cents;
  const priceVaries = hasVariants && Math.min(...variantPrices) !== Math.max(...variantPrices);

  const effectiveCompareCents = defaultVariant
    ? defaultVariant.compare_price_cents ?? null
    : product.compare_price_cents ?? null;
  const effectiveBasePrice = defaultVariant ? defaultVariant.price_cents : product.price_cents;
  const hasCompare =
    effectiveCompareCents != null &&
    effectiveCompareCents > effectiveBasePrice &&
    effectiveCompareCents > 0;
  const effectiveCurrency = product.currency?.trim() || options.currency;
  const formattedComparePrice = hasCompare
    ? formatMoney(effectiveCompareCents!, effectiveCurrency)
    : null;
  const discountPercent = hasCompare
    ? Math.round(((effectiveCompareCents! - effectiveBasePrice) / effectiveCompareCents!) * 100)
    : null;

  const galleryAnchor = (imageId: number | null): string => {
    const image = imageId == null ? undefined : gallery.find((g) => g.id === imageId);
    return image ? requirePublicId(image.public_id, image.id, 'product image') : '';
  };

  const images: StorefrontGalleryImage[] = gallery.map((image, index) => {
    const hero = productImageSources(image.image_key, {
      baseUrl: options.imageBaseUrl,
      delivery: options.delivery,
      usage: 'detail',
      sizes: HERO_SIZES,
    });
    const thumbnail = productImageSources(image.image_key, {
      baseUrl: options.imageBaseUrl,
      delivery: options.delivery,
      usage: 'thumbnail',
      sizes: THUMBNAIL_SIZES,
    });
    return {
      anchor: requirePublicId(image.public_id, image.id, 'product image'),
      hero: { ...hero, alt: image.alt || product.name, priority: index === 0 },
      thumbnail: { ...thumbnail, alt: '', priority: false },
    };
  });

  const offered = options.settings ? enabledMethods(options.settings) : [];
  const canCheckout = offered.length > 0;
  const cartEnabled = options.settings?.cartEnabled ?? true;
  const buyNowEnabled = options.settings?.buyNowEnabled ?? true;

  const activeCustomFields = (checkoutFields ?? [])
    .filter((f) => f.is_active === 1)
    .map((f) => ({
      id: requirePublicId(f.public_id, f.id, 'checkout field'),
      key: f.field_key,
      label: f.label,
      type: f.field_type,
      placeholder: f.placeholder,
      helpText: f.help_text,
      options: parseFieldOptions(f.options_json),
      required: f.is_required === 1,
      minLength: f.min_length,
      maxLength: f.max_length,
    }));

  const faq = parseFaqJson(product.faq_json);
  const seoTitle = product.seo_title?.trim() || product.name;
  const seoDescription =
    product.seo_description?.trim() ||
    product.short_description?.trim() ||
    (product.description ? markdownExcerpt(product.description, 160) : null);

  const imagePath = productImageUrl(product.image_key, options.imageBaseUrl);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(seoDescription ? { description: seoDescription } : {}),
    image: new URL(imagePath, options.origin).href,
    offers: {
      '@type': 'Offer',
      price: toMajorUnits(displayPriceCents, effectiveCurrency).toFixed(
        currencyDecimals(effectiveCurrency),
      ),
      priceCurrency: effectiveCurrency.toUpperCase(),
      availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      url: new URL(options.pathname, options.origin).href,
    },
  };

  const errorMessage = options.searchParams.get('error');

  return {
    status: 'ok',
    cacheTagIds: [product.public_id, ...related.map((candidate) => candidate.public_id)],
    backfillRelated:
      storedRelated === null ? () => storeRelatedIds(product.id, RELATED_TARGET) : null,
    seo: {
      title: seoTitle,
      description: seoDescription,
      imagePath,
      jsonLd: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
    },
    model: {
      id: requirePublicId(product.public_id, product.id, 'product'),
      name: product.name,
      description: product.description,
      descriptionHtml: product.description
        ? renderMarkdown(product.description, { baseUrl: options.imageBaseUrl })
        : null,
      formattedPrice: formatMoney(displayPriceCents, effectiveCurrency),
      priceCents: product.price_cents,
      currency: effectiveCurrency,
      priceVaries,
      soldOut,
      // Digital services never surface low-stock scarcity nudges.
      lowStock: !isDigital && !hasVariants && state === 'low',
      digitalDelivery: isDigital || Boolean(product.file_key),
      categories: categories.map((category) => ({
        text: category.name,
        href: `/categories/${category.slug}`,
      })),
      images,
      heroImage: heroImage(product, options),
      related: related.map((candidate) =>
        buildProductCard(candidate, {
          baseUrl: options.imageBaseUrl,
          delivery: options.delivery,
          currency: options.currency,
          sizes: RELATED_CARD_SIZES,
        }),
      ),
      backHref: catalogPath(options.settings?.homePage),
      error: errorMessage,
      brand: product.brand ?? null,
      region: product.region ?? null,
      badge: product.badge ?? null,
      shortDescription: product.short_description ?? null,
      formattedComparePrice,
      comparePriceCents: hasCompare ? effectiveCompareCents : null,
      discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null,
      estimatedDelivery: product.estimated_delivery ?? null,
      instructions: product.instructions ?? null,
      instructionsHtml: product.instructions
        ? renderMarkdown(product.instructions, { baseUrl: options.imageBaseUrl })
        : null,
      faq,
      availabilityLabel: soldOut ? fa.product.inactive : fa.product.available,
    },
    purchase: {
      productId: requirePublicId(product.public_id, product.id, 'product'),
      cartAction: '/api/cart',
      expressAction: '/express',
      hasOptions: hasVariants || extras.length > 0 || activeCustomFields.length > 0,
      soldOut,
      showAddToCart: cartEnabled,
      showBuyNow: buyNowEnabled && canCheckout,
      variantLabel: product.variant_label,
      variants: variants.map((variant, index) => {
        const vCompare = variant.compare_price_cents ?? null;
        const vHasCmp = vCompare != null && vCompare > variant.price_cents && vCompare > 0;
        return {
          id: requirePublicId(variant.public_id, variant.id, 'variant'),
          label: variant.label,
          formattedPrice: formatMoney(variant.price_cents, effectiveCurrency),
          priceCents: variant.price_cents,
          soldOut: isVariantUnavailable(variant),
          defaultSelected: index === firstAvailableIndex,
          imageAnchor: galleryAnchor(variant.image_id),
          region: variant.region ?? null,
          amountLabel: variant.amount_label ?? null,
          durationLabel: variant.duration_label ?? null,
          formattedComparePrice: vHasCmp ? formatMoney(vCompare!, effectiveCurrency) : null,
          comparePriceCents: vHasCmp ? vCompare : null,
        };
      }),
      extras: extras.map((extra) => ({
        id: requirePublicId(extra.public_id, extra.id, 'extra'),
        label: extra.label,
        formattedPriceDelta: formatMoney(extra.price_delta_cents, effectiveCurrency),
        priceDeltaCents: extra.price_delta_cents,
      })),
      customFields: activeCustomFields,
      error: errorMessage,
    },
  };
}
