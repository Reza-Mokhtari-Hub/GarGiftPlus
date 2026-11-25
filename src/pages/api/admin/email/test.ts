import type { APIRoute } from 'astro';
import { getEmailProvider } from '../../../../features/email';
import { getStoreSettings } from '../../../../features/settings/db';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import { env } from 'cloudflare:workers';

export const prerender = false;

// POST /api/admin/email/test — send a one-off test email with the CURRENTLY SAVED
// email config (provider + key + from), so the owner can confirm delivery actually
// works (the only way past "binding present ≠ deliverable"). Returns JSON for the
// dashboard's inline button; falls back to a ?msg redirect without JS.
export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'emails.manage');
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const to = String(form.get('test_to') ?? '').trim();
  const redirectTargetRaw = String(form.get('_redirect') ?? '').trim();
  const redirectBase =
    redirectTargetRaw === '/admin/emails' ? '/admin/emails' : '/admin/settings#email';
  const wantsJson = request.headers.get('x-requested-with') === 'fetch';
  const done = (ok: boolean, message: string) => {
    if (wantsJson) {
      return new Response(JSON.stringify({ ok, message }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    if (redirectBase === '/admin/emails') {
      const key = ok ? 'msg' : 'error';
      return redirect(`/admin/emails?${key}=${encodeURIComponent(message)}`, 303);
    }
    return redirect(`/admin/settings?msg=${encodeURIComponent(message)}#email`, 303);
  };

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return done(false, 'لطفاً یک آدرس ایمیل گیرنده معتبر وارد کنید.');
  }
  const provider = await getEmailProvider();
  if (!provider) {
    return done(false, 'سرویس ایمیل هنوز پیکربندی نشده است — ابتدا در تنظیمات ایمیل آن را فعال کنید.');
  }
  const storeName = (await getStoreSettings(env.DB)).storeName ?? 'GarGift+';
  try {
    await provider.send({
      to,
      subject: `ایمیل آزمایشی از ${storeName}`,
      html: `<p dir="rtl">این یک ایمیل آزمایشی از پنل مدیریت <strong>${storeName}</strong> است. سرویس ارسال ایمیل به‌درستی فعال است ✅</p>`,
      text: `این یک ایمیل آزمایشی از پنل مدیریت ${storeName} است. سرویس ارسال ایمیل به‌درستی فعال است.`,
    });
    await recordAdminAuditLog(env.DB, {
      action: 'email_test_sent',
      module: 'emails',
      targetType: 'email_provider',
      targetId: 'test',
      actor: auth.actor.id,
      details: { recipientDomain: to.split('@')[1] ?? 'unknown' },
    });
    return done(true, `ایمیل آزمایشی با موفقیت به ${to} ارسال شد.`);
  } catch (err) {
    return done(false, `ارسال ایمیل آزمایشی ناموفق بود: ${(err as Error).message || 'خطای نامشخص'}`);
  }
};
