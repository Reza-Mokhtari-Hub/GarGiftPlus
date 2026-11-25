/**
 * Presentation models for store-owned templates.
 *
 * These are the ONLY shapes an editable storefront file receives. Database rows
 * are deliberately absent: a row would publish internal numeric IDs, storage
 * keys, mutable columns, and query-specific accidents as a de facto contract,
 * and every one of those becomes something a template edit can break.
 *
 * Keep this file dependency-free (zero imports) so `theme:check` never sees
 * runtime or DB types leak through storefront templates.
 */

export interface StorefrontImage {
  /** Root-relative or absolute URL; never an R2 key. */
  src: string;
  /** Responsive candidates, when the delivery mode produces a ladder. */
  srcset?: string;
  /** Browser sizing hint paired with `srcset`. */
  sizes?: string;
  alt: string;
  priority: boolean;
}

/** A product as a catalog/search/recommendation card. */
export interface ProductCardModel {
  /** `prod_` public ID. Never a row ID. */
  id: string;
  name: string;
  /** Root-relative product URL. */
  href: string;
  image: StorefrontImage;
  /** Server-formatted price in the store's currency. Display only. */
  formattedPrice: string;
  /** Availability boolean (`active === 1` for digital products). */
  inStock: boolean;
  /** Optional digital catalog presentation fields. */
  badge?: string | null;
  brand?: string | null;
  region?: string | null;
  formattedComparePrice?: string | null;
  discountPercent?: number | null;
  isFeatured?: boolean;
  availabilityLabel?: string;
  variantCount?: number | null;
  variantSummary?: string | null;
}

/** A resolved navigation link. */
export interface StorefrontLink {
  text: string;
  href: string;
}

export interface StorefrontShellModel {
  storeName: string;
  logo: StorefrontImage | null;
  announcement: { text: string; href: string | null } | null;
  headerLinks: StorefrontLink[];
  footerLinks: StorefrontLink[];
  categoryLinks?: StorefrontLink[];
  search: { action: string; query: string };
  cart: { enabled: boolean; href: string };
  account: { enabled: boolean; href: string };
  footerInfo?: {
    description: string;
    supportHours: string;
    supportEmail: string;
    supportPhone: string;
    telegramUrl: string | null;
    instagramUrl: string | null;
    copyrightText: string;
    trustNote: string;
  } | null;
}

export interface StorefrontSortOption {
  label: string;
  href: string;
  current: boolean;
  direction: 'asc' | 'desc' | null;
}

export interface StorefrontSortModel {
  options: StorefrontSortOption[];
}

export interface StorefrontPaginationItem {
  page: number | null;
  href: string | null;
  current: boolean;
}

export interface StorefrontPaginationModel {
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  items: StorefrontPaginationItem[];
}

export interface StorefrontCatalogFilterOption {
  slug: string;
  name: string;
  selected: boolean;
}

export interface StorefrontCatalogFilters {
  actionHref: string;
  clearHref: string;
  hasActiveFilters: boolean;
  resultsCountLabel: string;
  categories: StorefrontCatalogFilterOption[];
  selectedCategory: string;
  minPrice: string;
  maxPrice: string;
  q: string;
  featuredOnly: boolean;
  discountedOnly: boolean;
  sort: string;
  dir: 'asc' | 'desc';
}

export interface CatalogPageModel {
  eyebrow: string;
  heading: string;
  categories: StorefrontLink[];
  products: ProductCardModel[];
  sort: StorefrontSortModel;
  pagination: StorefrontPaginationModel;
  filters?: StorefrontCatalogFilters;
}

export interface StorefrontGalleryImage {
  anchor: string;
  hero: StorefrontImage;
  thumbnail: StorefrontImage;
}

export interface StorefrontVariant {
  id: string;
  label: string;
  formattedPrice: string;
  priceCents: number;
  soldOut: boolean;
  defaultSelected: boolean;
  imageAnchor: string;
  region?: string | null;
  amountLabel?: string | null;
  durationLabel?: string | null;
  formattedComparePrice?: string | null;
  comparePriceCents?: number | null;
}

export interface StorefrontExtra {
  id: string;
  label: string;
  formattedPriceDelta: string;
  priceDeltaCents: number;
}

export type StorefrontCustomFieldType = 'text' | 'email' | 'number' | 'select' | 'textarea';

export interface StorefrontCustomField {
  id: string;
  key: string;
  label: string;
  type: StorefrontCustomFieldType;
  placeholder: string | null;
  helpText: string | null;
  options: string[];
  required: boolean;
  minLength: number | null;
  maxLength: number | null;
}

export interface StorefrontFaqItem {
  q: string;
  a: string;
}

export interface ProductPurchaseModel {
  productId: string;
  cartAction: string;
  expressAction: string;
  hasOptions: boolean;
  soldOut: boolean;
  showAddToCart: boolean;
  showBuyNow: boolean;
  variantLabel: string | null;
  variants: StorefrontVariant[];
  extras: StorefrontExtra[];
  customFields?: StorefrontCustomField[];
  error?: string | null;
}

export interface ProductSeoModel {
  title: string;
  description: string | null;
  imagePath: string;
  jsonLd: string;
}

export interface ProductDetailModel {
  id: string;
  name: string;
  description: string | null;
  descriptionHtml: string | null;
  formattedPrice: string;
  priceCents: number;
  currency: string;
  priceVaries: boolean;
  soldOut: boolean;
  lowStock: boolean;
  digitalDelivery: boolean;
  categories: StorefrontLink[];
  images: StorefrontGalleryImage[];
  heroImage: StorefrontImage;
  related: ProductCardModel[];
  backHref: string;
  error: string | null;
  brand?: string | null;
  region?: string | null;
  badge?: string | null;
  shortDescription?: string | null;
  formattedComparePrice?: string | null;
  comparePriceCents?: number | null;
  discountPercent?: number | null;
  estimatedDelivery?: string | null;
  instructions?: string | null;
  instructionsHtml?: string | null;
  faq?: StorefrontFaqItem[];
  availabilityLabel?: string;
}

export interface ContentPageModel {
  title: string;
  html: string;
  layout: string;
  layoutStyle: string;
}
