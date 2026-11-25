import type { Product } from '../products/db.ts';
import type { NormalizedCustomerInput } from '../products/customFields.ts';
import type { ReservationItem } from './reservations.ts';
import { entitlementWriterActive } from '../digitalDelivery/rollout.ts';

/**
 * A priced checkout line, before it becomes a reservation snapshot.
 * Owned here rather than in the checkout route so the snapshot builder can be
 * tested directly — it is the single place digital inputs and entitlements
 * cross from live state into the immutable order snapshot.
 */
export interface ReservationLine {
  product: Product;
  qty: number;
  name: string; // composed: product + variant + extras
  unitPriceCents: number; // variant/base + extras
  variantId: number | null;
  customerInputs?: NormalizedCustomerInput[];
}

export interface LineDraft extends ReservationLine {
  availableStock: number; // variant stock if a variant, else product stock
}

export const reservationItems = (lines: ReservationLine[]): ReservationItem[] =>
  lines.map((line) => ({
    productId: line.product.id,
    variantId: line.variantId,
    name: line.name,
    priceCents: line.unitPriceCents,
    quantity: line.qty,
    trackInventory: line.product.requires_shipping === 1,
    ...(line.customerInputs && line.customerInputs.length > 0
      ? { customerInputs: line.customerInputs }
      : {}),
    ...(entitlementWriterActive() && line.product.file_key
      ? {
          fileKey: line.product.file_key,
          fileName: line.product.file_name,
          fileMime: line.product.file_mime,
          fileSizeBytes: line.product.file_size_bytes,
        }
      : {}),
  }));
