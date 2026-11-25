import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import { parsePublicId } from '../../../../features/ids/publicId';
import { retryOutboxNotification } from '../../../../features/email/adminOutbox';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, cookies, redirect, url }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'emails.manage');
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const orderPublicId = parsePublicId(form.get('order_public_id'), 'order');
  const kind = String(form.get('kind') ?? '').trim();

  if (!orderPublicId || !kind) {
    return redirect('/admin/emails?error=' + encodeURIComponent('مشخصات پیام انتخابی معتبر نیست.'), 303);
  }

  const res = await retryOutboxNotification(env.DB, orderPublicId, kind, url.origin);

  await recordAdminAuditLog(env.DB, {
    action: 'email_outbox_retried',
    module: 'emails',
    targetType: 'order',
    targetId: orderPublicId,
    actor: auth.actor.id,
    result: res.ok ? 'success' : 'failed',
    details: { kind, ok: res.ok, error: res.error ?? null },
  });

  if (!res.ok) {
    return redirect(`/admin/emails?error=${encodeURIComponent(res.error || 'ارسال مجدد ناموفق بود.')}`, 303);
  }

  return redirect(
    `/admin/emails?msg=${encodeURIComponent('درخواست ارسال مجدد ایمیل با موفقیت پردازش شد.')}`,
    303,
  );
};
