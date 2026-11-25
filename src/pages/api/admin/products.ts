import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  createProduct,
  deleteProduct,
  getProduct,
  syncPrimaryImage,
  setProductFile,
} from '../../../features/products/db';
import { setProductCategories, getCategoriesByPublicIds } from '../../../features/categories/db';
import { parsePublicId } from '../../../features/ids/publicId';
import { indexProduct } from '../../../features/search';
import { parseProductForm } from '../../../features/products/form';
import { parseCheckoutFieldsForm } from '../../../features/products/customFields';
import { replaceProductCheckoutFields } from '../../../features/products/customFieldsDb';
import { zonesRequireWeight } from '../../../features/shipping/calculator';
import { shippingFor } from '../../../features/shipping/effective';
import { uniqueSlug } from '../../../features/products/slug';
import { validateImage } from '../../../features/products/image';
import { optimizeUpload } from '../../../features/products/imageOptimize';
import { uploadMedia } from '../../../features/media/upload';
import { attachMediaToProduct } from '../../../features/media/db';
import { getStorage, getFileStorage } from '../../../features/storage';
import { uploadDigitalFile, validateDigitalFile } from '../../../features/products/digitalFile.ts';
import { attachmentActive } from '../../../features/digitalDelivery/rollout.ts';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { getConfig } from '../../../config';
import { fa } from '../../../i18n/fa';

export const prerender = false;

const fail = (msg: string) => `/admin/products/new?error=${encodeURIComponent(msg)}`;

// POST /api/admin/products — create a product (with optional image & custom checkout fields), then redirect.
export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'products.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const weightUnit = locals.settings?.weightUnit ?? 'g';
  const parsed = parseProductForm(form, {
    unit: weightUnit,
    requireWeight: zonesRequireWeight(shippingFor(locals.settings).config),
    defaultCurrency: getConfig().currency,
  });
  if ('error' in parsed) return redirect(fail(parsed.error), 303);

  // Validate custom checkout fields BEFORE creating the product row.
  const parsedFields = parseCheckoutFieldsForm(form);
  if ('error' in parsedFields) return redirect(fail(parsedFields.error), 303);

  let mediaId: number | null = null;
  const file = form.get('image');
  if (file instanceof File && file.size > 0) {
    const imgErr = validateImage(file);
    if (imgErr) return redirect(fail(imgErr), 303);
    const media = await uploadMedia(env.DB, getStorage(), await optimizeUpload(file), file.name);
    mediaId = media.id;
  }

  const deliverable = form.get('deliverable');
  if (attachmentActive() && deliverable instanceof File && deliverable.size > 0) {
    const fileError = validateDigitalFile(deliverable);
    if (fileError) return redirect(fail(fileError), 303);
  }

  const slugBase = String(form.get('slug') ?? '').trim() || parsed.data.name;
  const slug = await uniqueSlug(env.DB, slugBase);

  const productId = await createProduct(env.DB, { ...parsed.data, image_key: null, slug });
  if (attachmentActive() && deliverable instanceof File && deliverable.size > 0) {
    await setProductFile(env.DB, productId, await uploadDigitalFile(getFileStorage(), deliverable));
  }
  if (mediaId !== null) {
    const attached = await attachMediaToProduct(env.DB, productId, mediaId);
    if (!attached.ok) {
      await deleteProduct(env.DB, productId);
      return redirect(fail(attached.error), 303);
    }
    await syncPrimaryImage(env.DB, productId);
  }

  const categoryPublicIds = form
    .getAll('category')
    .map((v) => parsePublicId(v, 'category'))
    .filter((v): v is string => v !== null);
  const categoryIds = (await getCategoriesByPublicIds(env.DB, categoryPublicIds)).map((c) => c.id);
  if (categoryIds.length > 0) await setProductCategories(env.DB, productId, categoryIds);

  if (parsedFields.fields.length > 0) {
    await replaceProductCheckoutFields(env.DB, productId, parsedFields.fields);
  }

  const created = await getProduct(env.DB, productId);
  try {
    if (created) await indexProduct(created);
  } catch (err) {
    console.error('Search index (create) failed:', err);
  }

  await purgeCacheTags([
    CACHE_TAG.catalog,
    ...(created?.public_id ? [CACHE_TAG.product(created.public_id)] : []),
  ]);
  await recordAdminAuditLog(env.DB, {
    action: 'product.created',
    module: 'products',
    targetType: 'product',
    targetId: created?.public_id ?? String(productId),
    actor: guard.actor.id,
    details: { name: parsed.data.name, priceCents: parsed.data.price_cents },
  });
  return redirect(`/admin/products?notice=${encodeURIComponent(fa.notifications.savedSuccess)}`, 303);
};
