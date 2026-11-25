import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createCategory, getCategoryByPublicId } from '../../../features/categories/db';
import { parseCategoryForm } from '../../../features/categories/form';
import { uniqueCategorySlug } from '../../../features/categories/slug';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';

export const prerender = false;

const fail = (msg: string) => `/admin/categories/new?error=${encodeURIComponent(msg)}`;

// POST /api/admin/categories — ایجاد دسته‌بندی با بررسی RBAC و ثبت لاگ ممیزی
export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'categories.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return redirect(fail(parsed.error), 303);

  let parentId: number | null = null;
  if (parsed.data.parentPublicId) {
    const parent = await getCategoryByPublicId(env.DB, parsed.data.parentPublicId);
    if (!parent) return redirect(fail('دسته‌بندی والد انتخاب‌شده دیگر وجود ندارد.'), 303);
    parentId = parent.id;
  }

  const slug = await uniqueCategorySlug(env.DB, parsed.data.slugInput || parsed.data.name);
  await createCategory(env.DB, {
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
    action: 'category.created',
    module: 'catalog',
    targetType: 'category',
    targetId: slug,
    actor: guard.actor.id,
    details: { name: parsed.data.name, slug },
  });

  await purgeCacheTags([CACHE_TAG.catalog]);
  return redirect('/admin/categories?saved=1', 303);
};
