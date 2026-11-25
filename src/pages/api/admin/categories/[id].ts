import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  updateCategory,
  deleteCategory,
  descendantIds,
  getCategoryByPublicId,
} from '../../../../features/categories/db';
import { parseCategoryForm } from '../../../../features/categories/form';
import { uniqueCategorySlug } from '../../../../features/categories/slug';
import { parsePublicId } from '../../../../features/ids/publicId';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

// POST /api/admin/categories/:id — ویرایش یا حذف دسته‌بندی (با امکان انتقال محصولات به دسته جایگزین)
export const POST: APIRoute = async ({ request, params, locals, cookies, redirect }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'categories.manage');
  if (!guard.ok) return guard.response;

  const publicId = parsePublicId(params.id, 'category');
  const category = publicId ? await getCategoryByPublicId(env.DB, publicId) : null;
  if (!category) return new Response('Not found', { status: 404 });
  const id = category.id;

  const form = await request.formData();

  if (String(form.get('_action')) === 'delete') {
    let reassignToId: number | null = null;
    const reassignPub = String(form.get('reassign_to') ?? '').trim();
    if (reassignPub) {
      const targetPub = parsePublicId(reassignPub, 'category');
      if (targetPub) {
        const target = await getCategoryByPublicId(env.DB, targetPub);
        if (target && target.id !== id) reassignToId = target.id;
      }
    }
    await deleteCategory(env.DB, id, reassignToId);
    await recordAdminAuditLog(env.DB, {
      action: 'category.deleted',
      module: 'catalog',
      targetType: 'category',
      targetId: publicId!,
      actor: guard.actor.id,
      details: { name: category.name, slug: category.slug, reassigned: reassignToId != null },
    });
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect('/admin/categories?deleted=1', 303);
  }

  const fail = (msg: string) =>
    redirect(`/admin/categories/${publicId}/edit?error=${encodeURIComponent(msg)}`, 303);

  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return fail(parsed.error);

  let parentId: number | null = null;
  if (parsed.data.parentPublicId) {
    const parent = await getCategoryByPublicId(env.DB, parsed.data.parentPublicId);
    if (!parent) return fail('دسته‌بندی والد انتخاب‌شده دیگر وجود ندارد.');
    parentId = parent.id;
  }

  // جلوگیری از حلقه در ساختار درختی دسته‌بندی
  if (parentId != null) {
    const blocked = new Set(await descendantIds(env.DB, id));
    if (blocked.has(parentId)) {
      return fail('دسته‌بندی نمی‌تواند زیرمجموعه خودش یا یکی از زیردسته‌هایش باشد.');
    }
  }

  const slug = await uniqueCategorySlug(env.DB, parsed.data.slugInput || parsed.data.name, id);
  await updateCategory(env.DB, id, {
    name: parsed.data.name,
    slug,
    parent_id: parentId,
    description: parsed.data.description,
    image_key: parsed.data.image_key,
    icon_key: parsed.data.icon_key,
    accent_color: parsed.data.accent_color,
    display_order: parsed.data.display_order,
    is_featured: parsed.data.is_featured,
    is_active: parsed.data.is_active,
    seo_title: parsed.data.seo_title,
    seo_description: parsed.data.seo_description,
  });

  await recordAdminAuditLog(env.DB, {
    action: 'category.updated',
    module: 'catalog',
    targetType: 'category',
    targetId: publicId!,
    actor: guard.actor.id,
    details: { name: parsed.data.name, slug },
  });

  await purgeCacheTags([CACHE_TAG.catalog]);
  return redirect('/admin/categories?saved=1', 303);
};
