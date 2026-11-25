// Whitelisted sort columns. The query param `sort` maps to a fixed column name
// here, so user input is never interpolated into SQL.
const COLUMNS: Record<string, string> = {
  newest: 'created_at',
  created: 'created_at',
  name: 'name',
  price: 'price_cents',
  stock: 'stock',
  sold: 'sold', // aggregate alias from listAllProducts / listFilteredStoreProducts
  popularity: 'sold',
  featured: 'is_featured',
  display_order: 'display_order',
  active: 'active',
  id: 'id',
};

/** Build a safe `ORDER BY` clause from query params (whitelisted col + direction). */
export function orderByClause(
  sort: string | null,
  dir: string | null,
  fallback: { col: string; dir: 'ASC' | 'DESC' } = { col: 'created_at', dir: 'DESC' },
): string {
  const col = (sort && COLUMNS[sort]) || fallback.col;
  const d =
    dir?.toLowerCase() === 'asc' ? 'ASC' : dir?.toLowerCase() === 'desc' ? 'DESC' : fallback.dir;
  const collate = col === 'name' ? ' COLLATE NOCASE' : ''; // case-insensitive name sort
  // Tiebreak cleanly for featured/display_order and created_at
  const extraTie =
    col === 'is_featured'
      ? `, display_order ASC, created_at DESC`
      : col === 'display_order'
        ? `, is_featured DESC, created_at DESC`
        : '';
  const tiebreak = col === 'id' ? '' : `${extraTie}, id ${d}`;
  return `${col}${collate} ${d}${tiebreak}`;
}

/**
 * Preset storefront sort options (rendered as links). One entry per field — `dir`
 * is the DEFAULT direction applied when you first pick that field; clicking an
 * already-active field toggles it (the arrow flips), so a field never appears twice.
 */
export const STORE_SORTS: { sort: string; dir: 'asc' | 'desc'; label: string }[] = [
  { sort: 'newest', dir: 'desc', label: 'Newest' },
  { sort: 'price', dir: 'asc', label: 'Price' },
  { sort: 'name', dir: 'asc', label: 'Name' },
  { sort: 'popularity', dir: 'desc', label: 'Popular' },
  { sort: 'featured', dir: 'desc', label: 'Featured' },
];

export type StoreSort = 'newest' | 'price' | 'name' | 'popularity' | 'featured';

export interface StoreSortQuery {
  sort: StoreSort;
  dir: 'asc' | 'desc';
}

/**
 * Canonical storefront sorting. Admin-only columns such as stock stay
 * unavailable on public pages, and equivalent invalid/default query strings
 * collapse to one edge-cache key.
 */
export function parseStoreSortQuery(
  sort: string | null,
  dir: string | null,
): StoreSortQuery {
  const normalizedSort: StoreSort =
    sort === 'price' ||
    sort === 'name' ||
    sort === 'newest' ||
    sort === 'popularity' ||
    sort === 'featured'
      ? sort
      : 'newest';
  const normalizedDir = dir?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { sort: normalizedSort, dir: normalizedDir };
}
