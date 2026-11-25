import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getMediaByPublicId, deleteMediaRecord } from '../../../../features/media/db';
import { mediaUsage, describeUsage } from '../../../../features/media/usage';
import { getStorage } from '../../../../features/storage';
import { parsePublicId } from '../../../../features/ids/publicId';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';

export const prerender = false;

// POST /api/admin/media/:id — حذف فایل رسانه در صورت عدم استفاده
export const POST: APIRoute = async ({ request, params, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'media.manage');
  if (!guard.ok) return guard.response;

  const publicId = parsePublicId(params.id, 'media');
  if (!publicId) return new Response('Invalid id', { status: 400 });

  const form = await request.formData();
  if (String(form.get('_action')) !== 'delete') {
    return new Response('Unknown action', { status: 400 });
  }

  const wantsJson = request.headers.get('accept')?.includes('application/json');
  const media = await getMediaByPublicId(env.DB, publicId);
  if (!media) return new Response('Not found', { status: 404 });
  const id = media.id;

  const deletedKey = await deleteMediaRecord(env.DB, id);
  if (!deletedKey) {
    const usage = await mediaUsage(env.DB, id);
    const message = `این فایل هنوز در «${describeUsage(usage)}» در حال استفاده است و قابل حذف نیست.`;
    return wantsJson
      ? new Response(JSON.stringify({ error: message }), {
          status: 409,
          headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
        })
      : redirect(`/admin/media?error=${encodeURIComponent(message)}`, 303);
  }

  try {
    await getStorage().delete(deletedKey);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'media_object_delete_failed',
        mediaId: id,
        key: deletedKey,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  await recordAdminAuditLog(env.DB, {
    action: 'media.deleted',
    module: 'media',
    targetType: 'media',
    targetId: publicId,
    actor: guard.actor.id,
    details: { imageKey: deletedKey, originalName: media.original_name },
  });

  return wantsJson
    ? new Response(JSON.stringify({ deleted: publicId }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
      })
    : redirect('/admin/media?deleted=1', 303);
};
