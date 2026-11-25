import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../config';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import { getPageByPublicId, deletePage } from '../../../../features/pages/db';
import { parsePageForm } from '../../../../features/pages/form';
import { uniquePageSlug } from '../../../../features/pages/slug';
import { savePageBody, saveWarning } from '../../../../features/pages/save';
import { parsePublicId } from '../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

export const POST: APIRoute = async ({ request, params, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'content.manage');
  if (!guard.ok) return guard.response;

  const publicId = parsePublicId(params.id, 'page');
  const existing = publicId ? await getPageByPublicId(env.DB, publicId) : null;
  if (!existing) return new Response('صفحه یافت نشد', { status: 404 });
  const id = existing.id;

  const form = await request.formData();

  if (String(form.get('_action')) === 'delete') {
    await deletePage(env.DB, id);
    await recordAdminAuditLog(env.DB, {
      action: 'page.deleted',
      module: 'content',
      targetType: 'page',
      targetId: publicId ?? String(id),
      actor: guard.actor.id,
      details: { title: existing.title },
    });
    await purgeCacheTags([CACHE_TAG.shell]);
    return redirect('/admin/pages', 303);
  }

  const back = (query: string) => redirect(`/admin/pages/${publicId}/edit${query}`, 303);

  const parsed = parsePageForm(form);
  if ('error' in parsed) return back(`?error=${encodeURIComponent(parsed.error)}`);

  const slugBase = parsed.data.slug || existing.slug || parsed.data.title;
  const slug = await uniquePageSlug(env.DB, slugBase, id);

  const result = await savePageBody(
    env.DB,
    existing,
    { ...parsed.data, slug },
    { baseUrl: getConfig().images.baseUrl },
  );

  await recordAdminAuditLog(env.DB, {
    action: 'page.updated',
    module: 'content',
    targetType: 'page',
    targetId: publicId ?? String(id),
    actor: guard.actor.id,
    details: { title: parsed.data.title, slug, published: parsed.data.published },
  });

  await purgeCacheTags([CACHE_TAG.shell]);
  const warning = saveWarning(result);
  return back(warning ? `?warning=${encodeURIComponent(warning)}` : '?saved=1');
};
