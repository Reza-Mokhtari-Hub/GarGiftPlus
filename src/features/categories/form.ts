import { parsePublicId } from '../ids/publicId';
import { toEnglishDigits } from '../../lib/format';

export const CATEGORY_ICON_KEYS = [
  'gift',
  'sparkles',
  'gamepad',
  'music',
  'monitor',
  'shield',
  'globe',
  'layers',
] as const;

export const CATEGORY_ACCENTS = [
  'violet',
  'turquoise',
  'coral',
  'amber',
  'navy',
] as const;

export interface ParsedCategoryForm {
  name: string;
  slugInput: string;
  parentPublicId: string | null;
  description: string | null;
  image_key: string | null;
  icon_key: string | null;
  accent_color: string | null;
  display_order: number;
  is_featured: number;
  is_active: number;
  seo_title: string | null;
  seo_description: string | null;
}

export function parseCategoryForm(
  form: FormData,
): { data: ParsedCategoryForm } | { error: string } {
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'عنوان دسته‌بندی الزامی است.' };
  if (name.length > 120) return { error: 'عنوان دسته‌بندی نباید بیش از ۱۲۰ کاراکتر باشد.' };

  const slugInput = String(form.get('slug') ?? '').trim();

  const parentRaw = String(form.get('parent_id') ?? '').trim();
  let parentPublicId: string | null = null;
  if (parentRaw) {
    parentPublicId = parsePublicId(parentRaw, 'category');
    if (!parentPublicId) return { error: 'دسته‌بندی والد انتخاب‌شده معتبر نیست.' };
  }

  const descriptionRaw = String(form.get('description') ?? '').trim();
  const description = descriptionRaw ? descriptionRaw.slice(0, 600) : null;

  const imageKeyRaw = String(form.get('image_key') ?? '').trim();
  const image_key = imageKeyRaw ? imageKeyRaw.slice(0, 240) : null;

  const iconKeyRaw = String(form.get('icon_key') ?? '').trim();
  const icon_key = iconKeyRaw && (CATEGORY_ICON_KEYS as readonly string[]).includes(iconKeyRaw)
    ? iconKeyRaw
    : null;

  const accentRaw = String(form.get('accent_color') ?? '').trim();
  const accent_color =
    accentRaw &&
    ((CATEGORY_ACCENTS as readonly string[]).includes(accentRaw) ||
      /^#[0-9a-fA-F]{6}$/.test(accentRaw))
      ? accentRaw
      : null;

  const orderRaw = toEnglishDigits(String(form.get('display_order') ?? '0').trim());
  const parsedOrder = Number(orderRaw);
  const display_order =
    Number.isFinite(parsedOrder) && Number.isInteger(parsedOrder)
      ? Math.max(-999, Math.min(9999, parsedOrder))
      : 0;

  const is_featured = form.has('has_visibility_flags')
    ? form.get('is_featured') === '1' || form.get('is_featured') === 'on'
      ? 1
      : 0
    : form.get('is_featured') === '0'
      ? 0
      : 1;

  const is_active = form.has('has_visibility_flags')
    ? form.get('is_active') === '1' || form.get('is_active') === 'on'
      ? 1
      : 0
    : form.get('is_active') === '0'
      ? 0
      : 1;

  const seoTitleRaw = String(form.get('seo_title') ?? '').trim();
  const seo_title = seoTitleRaw ? seoTitleRaw.slice(0, 140) : null;

  const seoDescRaw = String(form.get('seo_description') ?? '').trim();
  const seo_description = seoDescRaw ? seoDescRaw.slice(0, 320) : null;

  return {
    data: {
      name,
      slugInput,
      parentPublicId,
      description,
      image_key,
      icon_key,
      accent_color,
      display_order,
      is_featured,
      is_active,
      seo_title,
      seo_description,
    },
  };
}
