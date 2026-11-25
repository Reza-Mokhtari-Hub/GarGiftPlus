import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { createDraft, getPage } from '../../../features/pages/db';
import { uniquePageSlug } from '../../../features/pages/slug';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'content.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const title = String(form.get('title') ?? '').trim();
  if (!title) {
    return redirect(`/admin/pages/new?error=${encodeURIComponent('عنوان صفحه الزامی است.')}`, 303);
  }

  const slugBase = String(form.get('slug') ?? '').trim() || title;
  const slug = await uniquePageSlug(env.DB, slugBase);
  const id = await createDraft(env.DB, title, slug);
  const created = await getPage(env.DB, id);

  await recordAdminAuditLog(env.DB, {
    action: 'page.created',
    module: 'content',
    targetType: 'page',
    targetId: created?.public_id ?? String(id),
    actor: guard.actor.id,
    details: { title, slug },
  });

  return redirect(`/admin/pages/${created?.public_id}/edit`, 303);
};
