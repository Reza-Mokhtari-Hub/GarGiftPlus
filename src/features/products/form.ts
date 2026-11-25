import type { ProductFields } from './db';
import { toMinorUnits } from '../../money';
import { toGrams, type WeightUnit } from '../shipping/weight';
import { toEnglishDigits } from '../../lib/format.ts';
import { parseFaqForm } from './customFields.ts';

export interface ProductFormOptions {
  /** Admin's display unit. Storage is always grams. */
  unit?: WeightUnit;
  /**
   * True when at least one enabled zone prices by weight with no flat fallback —
   * i.e. when a missing weight would make this product unsellable.
   */
  requireWeight?: boolean;
  /** Store default currency fallback when the form omits `currency`. */
  defaultCurrency?: string;
}

/**
 * Parse + validate the scalar product form fields.
 */
export function parseProductForm(
  form: FormData,
  options: ProductFormOptions = {},
): { data: ProductFields } | { error: string } {
  const { unit = 'g', requireWeight = false, defaultCurrency = 'usd' } = options;

  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'عنوان محصول الزامی است.' };

  const rawPrice = toEnglishDigits(String(form.get('price') ?? '').trim());
  const price = Number(rawPrice);
  if (rawPrice === '' || !Number.isFinite(price) || price < 0) {
    return { error: 'قیمت باید یک عدد غیرمنفی معتبر باشد.' };
  }

  const rawStock = toEnglishDigits(String(form.get('stock') ?? '0').trim() || '0');
  const stock = Number(rawStock);
  if (!Number.isInteger(stock) || stock < 0) {
    return { error: 'موجودی باید عدد صحیح نامنفی باشد.' };
  }

  const currency =
    String(form.get('currency') ?? defaultCurrency).trim().toLowerCase() ||
    defaultCurrency.trim().toLowerCase() ||
    'usd';
  const price_cents = toMinorUnits(price, currency);

  // Optional compare-at (original) price for showing discount badge.
  const rawCompare = toEnglishDigits(String(form.get('compare_price') ?? '').trim());
  let compare_price_cents: number | null = null;
  if (rawCompare !== '') {
    const cmp = Number(rawCompare);
    if (!Number.isFinite(cmp) || cmp < 0) {
      return { error: 'قیمت قبل از تخفیف باید عدد غیرمنفی باشد.' };
    }
    compare_price_cents = cmp > 0 ? toMinorUnits(cmp, currency) : null;
  }

  const description = String(form.get('description') ?? '').trim() || null;
  const short_description = String(form.get('short_description') ?? '').trim() || null;
  const brand = String(form.get('brand') ?? '').trim() || null;
  const region = String(form.get('region') ?? '').trim() || null;
  const badge = String(form.get('badge') ?? '').trim() || null;
  const instructions = String(form.get('instructions') ?? '').trim() || null;
  const estimated_delivery = String(form.get('estimated_delivery') ?? '').trim() || null;
  const seo_title = String(form.get('seo_title') ?? '').trim() || null;
  const seo_description = String(form.get('seo_description') ?? '').trim() || null;

  const is_featured = form.get('is_featured') != null ? 1 : 0;
  const rawOrder = toEnglishDigits(String(form.get('display_order') ?? '0').trim() || '0');
  const display_order = Number(rawOrder);
  if (!Number.isInteger(display_order)) {
    return { error: 'ترتیب نمایش باید عدد صحیح باشد.' };
  }

  const faqParsed = parseFaqForm(form);
  if ('error' in faqParsed) return { error: faqParsed.error };

  // Unchecked checkboxes submit nothing, so absence means inactive.
  const active = form.get('active') != null ? 1 : 0;
  const requires_shipping = form.get('requires_shipping') != null ? 1 : 0;

  const parsedWeight = toGrams(String(form.get('weight') ?? ''), unit);
  let weight_grams: number | null = null;
  if (parsedWeight.status === 'ok') {
    weight_grams = parsedWeight.grams;
  } else if (parsedWeight.status === 'error') {
    return { error: weightFieldError(parsedWeight.reason, unit) };
  } else if (requireWeight && requires_shipping === 1 && active === 1) {
    return {
      error:
        'برای کالاهای نیازمند ارسال پستی، وارد کردن وزن الزامی است.',
    };
  }

  return {
    data: {
      name,
      description,
      price_cents,
      currency,
      stock,
      active,
      weight_grams,
      requires_shipping,
      short_description,
      brand,
      region,
      badge,
      is_featured,
      display_order,
      faq_json: faqParsed.faqJson,
      instructions,
      seo_title,
      seo_description,
      compare_price_cents,
      estimated_delivery,
    },
  };
}

function weightFieldError(
  reason: 'not_number' | 'negative' | 'precision' | 'over_limit',
  unit: WeightUnit,
): string {
  switch (reason) {
    case 'negative':
      return 'وزن نمی‌تواند منفی باشد.';
    case 'precision':
      return `تعداد رقم اعشار وزن برای واحد ${unit} بیش از حد مجاز است.`;
    case 'over_limit':
      return 'وزن واردشده برای ارسال بسته‌ای بیش از حد مجاز است.';
    default:
      return 'وزن باید یک عدد معتبر باشد.';
  }
}
