import type { D1Database } from '@cloudflare/workers-types';
import {
  listFilteredStoreProducts,
  countFilteredStoreProducts,
  type StoreCatalogFilter,
} from '../products/db';
import { listCategories, childrenOf } from '../categories/db';
import { orderByClause, parseStoreSortQuery, STORE_SORTS } from '../products/sort';
import { MAX_PUBLIC_PAGE, paginate, queryHref } from '../../pagination';
import { addCacheTags, productCacheTags } from '../cache/tags';
import type { ImageDelivery } from '../products/image';
import { toMinorUnits } from '../../money';
import { toEnglishDigits, toPersianDigits } from '../../lib/format';
import { fa } from '../../i18n/fa';
import { buildProductCard } from './productCard';
import type {
  CatalogPageModel,
  StorefrontCatalogFilters,
  StorefrontPaginationItem,
  StorefrontPaginationModel,
  StorefrontSortModel,
} from './models';

/**
 * The catalog loader.
 *
 * Parses and bounds filter/sort/page queries, reads D1, attaches cache tags,
 * and constructs clean canonical URLs for templates.
 */

const PAGE_SIZE = 24;
const CARD_SIZES = '(min-width: 1024px) 352px, calc(50vw - 36px)';

function parseFilterPriceInput(raw: string | null, currency: string): { text: string; cents: number | null } {
  const cleaned = toEnglishDigits((raw ?? '').trim()).replace(/[,٬\s]/g, '');
  if (!cleaned) return { text: '', cents: null };
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return { text: '', cents: null };
  return { text: String(Math.round(n)), cents: toMinorUnits(n, currency) };
}

export function buildSortModel(
  base: string,
  sort: string,
  dir: 'asc' | 'desc',
  extraParams: Record<string, string | number | undefined> = {},
): StorefrontSortModel {
  return {
    options: STORE_SORTS.map((option) => {
      const current = sort === option.sort;
      const nextDir = current ? (dir === 'asc' ? 'desc' : 'asc') : option.dir;
      return {
        label: option.label,
        href: queryHref(base, { ...extraParams, sort: option.sort, dir: nextDir }),
        current,
        direction: current ? dir : null,
      };
    }),
  };
}

function windowed(current: number, total: number): (number | null)[] {
  const keep = new Set<number>([1, total, current, current - 1, current + 1]);
  const pages = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = 0;
  for (const page of pages) {
    if (page - previous > 1) out.push(null);
    out.push(page);
    previous = page;
  }
  return out;
}

export function buildPaginationModel(
  base: string,
  page: number,
  totalPages: number,
  sort: string,
  dir: 'asc' | 'desc',
  extraParams: Record<string, string | number | undefined> = {},
): StorefrontPaginationModel {
  const hrefFor = (target: number) =>
    queryHref(base, {
      ...extraParams,
      sort: sort === 'newest' ? undefined : sort,
      dir: dir === 'desc' ? undefined : dir,
      page: target > 1 ? target : undefined,
    });

  const items: StorefrontPaginationItem[] =
    totalPages > 1
      ? windowed(page, totalPages).map((target) => ({
          page: target,
          href: target === null ? null : hrefFor(target),
          current: target === page,
        }))
      : [];

  return {
    page,
    totalPages,
    prevHref: page > 1 ? hrefFor(page - 1) : null,
    nextHref: page < totalPages ? hrefFor(page + 1) : null,
    items,
  };
}

export interface CatalogPageOptions {
  base: string;
  searchParams: URLSearchParams;
  responseHeaders: Headers;
  imageBaseUrl: string;
  delivery: ImageDelivery | undefined;
  currency: string;
  eyebrow: string;
  heading: string;
}

export async function loadCatalogPage(
  db: D1Database,
  options: CatalogPageOptions,
): Promise<CatalogPageModel> {
  const { sort, dir } = parseStoreSortQuery(
    options.searchParams.get('sort'),
    options.searchParams.get('dir'),
  );
  const order = orderByClause(sort, dir);

  const selectedCategory = (options.searchParams.get('category') ?? '').trim();
  const minParsed = parseFilterPriceInput(options.searchParams.get('min_price'), options.currency);
  const maxParsed = parseFilterPriceInput(options.searchParams.get('max_price'), options.currency);
  const q = (options.searchParams.get('q') ?? '').trim().slice(0, 100);
  const featuredParam = options.searchParams.get('featured');
  const discountedParam = options.searchParams.get('discounted');
  const featuredOnly = featuredParam === '1' || featuredParam === 'true';
  const discountedOnly = discountedParam === '1' || discountedParam === 'true';

  const dbFilter: StoreCatalogFilter = {
    categorySlug: selectedCategory || null,
    minPriceCents: minParsed.cents,
    maxPriceCents: maxParsed.cents,
    searchQuery: q || null,
    featuredOnly,
    discountedOnly,
  };

  const extraParams: Record<string, string | undefined> = {
    category: selectedCategory || undefined,
    min_price: minParsed.text || undefined,
    max_price: maxParsed.text || undefined,
    q: q || undefined,
    featured: featuredOnly ? '1' : undefined,
    discounted: discountedOnly ? '1' : undefined,
  };

  const [total, categories] = await Promise.all([
    countFilteredStoreProducts(db, dbFilter),
    listCategories(db),
  ]);
  const { page, offset, totalPages } = paginate(
    options.searchParams,
    total,
    PAGE_SIZE,
    MAX_PUBLIC_PAGE,
  );
  const products = await listFilteredStoreProducts(db, dbFilter, PAGE_SIZE, offset, order);

  addCacheTags(
    options.responseHeaders,
    productCacheTags(products.map((product) => product.public_id)),
  );

  // Enrich product cards with variant summary when product_variants rows exist
  const variantSummaryByProduct = new Map<number, { count: number; labels: string[] }>();
  if (products.length > 0) {
    try {
      const ph = products.map(() => '?').join(',');
      const { results: vRows } = await db
        .prepare(
          `SELECT product_id, label FROM product_variants
            WHERE product_id IN (${ph})
            ORDER BY product_id ASC, position ASC, id ASC`,
        )
        .bind(...products.map((p) => p.id))
        .all<{ product_id: number; label: string }>();
      for (const r of vRows ?? []) {
        const entry = variantSummaryByProduct.get(r.product_id) ?? { count: 0, labels: [] };
        entry.count += 1;
        if (entry.labels.length < 2) entry.labels.push(r.label);
        variantSummaryByProduct.set(r.product_id, entry);
      }
    } catch {
      // Ignore if product_variants is absent in minimal test fixtures
    }
  }

  const topCategories = childrenOf(categories, null);
  const hasActiveFilters = Boolean(
    selectedCategory || minParsed.text || maxParsed.text || q || featuredOnly || discountedOnly,
  );

  const filters: StorefrontCatalogFilters = {
    actionHref: options.base,
    clearHref: options.base,
    hasActiveFilters,
    resultsCountLabel: toPersianDigits(fa.catalog.resultsCount(total)),
    categories: topCategories.map((c) => ({
      slug: c.slug,
      name: c.name,
      selected: selectedCategory === c.slug,
    })),
    selectedCategory,
    minPrice: minParsed.text,
    maxPrice: maxParsed.text,
    q,
    featuredOnly,
    discountedOnly,
    sort,
    dir,
  };

  return {
    eyebrow: options.eyebrow,
    heading: options.heading,
    categories: topCategories.map((category) => ({
      text: category.name,
      href: `/categories/${category.slug}`,
    })),
    products: products.map((product, index) => {
      const card = buildProductCard(product, {
        baseUrl: options.imageBaseUrl,
        delivery: options.delivery,
        currency: options.currency,
        sizes: CARD_SIZES,
        priority: index === 0,
      });
      const v = variantSummaryByProduct.get(product.id);
      if (v && v.count > 0) {
        return {
          ...card,
          variantCount: v.count,
          variantSummary: v.labels.length > 0 ? v.labels.join(' · ') : `${v.count} گزینه`,
        };
      }
      return card;
    }),
    sort: buildSortModel(options.base, sort, dir, extraParams),
    pagination: buildPaginationModel(options.base, page, totalPages, sort, dir, extraParams),
    filters,
  };
}
