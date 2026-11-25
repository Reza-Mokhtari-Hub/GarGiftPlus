import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../../features/audit/db';
import {
  DEFAULT_EMAIL_TEMPLATES,
  isEmailTemplateEventKey,
  upsertEmailTemplate,
} from '../../../../features/email/templatesDb';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const auth = await guardAdminApi(env.DB, { locals, cookies, request }, 'emails.manage');
  if (!auth.ok) return auth.response;

  const form = await request.formData();
  const eventKeyRaw = String(form.get('event_key') ?? '').trim();
  const action = String(form.get('_action') ?? 'save').trim();

  const back = (params: Record<string, string>) => {
    const qs = new URLSearchParams(params);
    if (eventKeyRaw) qs.set('template', eventKeyRaw);
    return redirect(`/admin/emails?${qs.toString()}`, 303);
  };

  if (!isEmailTemplateEventKey(eventKeyRaw)) {
    return back({ error: 'کلید قالب ایمیل معتبر نیست.' });
  }

  if (action === 'reset') {
    const def = DEFAULT_EMAIL_TEMPLATES[eventKeyRaw];
    await upsertEmailTemplate(env.DB, {
      eventKey: eventKeyRaw,
      subject: def.subject,
      heading: def.heading,
      intro: def.intro,
      ctaLabel: def.cta_label,
      footerNote: def.footer_note,
      isActive: true,
      updatedBy: auth.actor.id,
    });
    await recordAdminAuditLog(env.DB, {
      action: 'email_template_reset',
      module: 'emails',
      targetType: 'email_template',
      targetId: eventKeyRaw,
      actor: auth.actor.id,
      details: { event_key: eventKeyRaw },
    });
    return back({ msg: 'قالب ایمیل به متن پیش‌فرض بازنشانی شد.' });
  }

  const subject = String(form.get('subject') ?? '').trim();
  const heading = String(form.get('heading') ?? '').trim();
  const intro = String(form.get('intro') ?? '').trim();
  const ctaLabel = String(form.get('cta_label') ?? '').trim();
  const footerNote = String(form.get('footer_note') ?? '').trim();
  const isActive = form.get('is_active') === '1';

  if (subject.length < 3 || heading.length < 3 || intro.length < 5) {
    return back({ error: 'موضوع، تیتر و متن اصلی قالب ایمیل الزامی هستند.' });
  }

  await upsertEmailTemplate(env.DB, {
    eventKey: eventKeyRaw,
    subject,
    heading,
    intro,
    ctaLabel: ctaLabel || DEFAULT_EMAIL_TEMPLATES[eventKeyRaw].cta_label,
    footerNote,
    isActive,
    updatedBy: auth.actor.id,
  });

  await recordAdminAuditLog(env.DB, {
    action: 'email_template_updated',
    module: 'emails',
    targetType: 'email_template',
    targetId: eventKeyRaw,
    actor: auth.actor.id,
    details: { event_key: eventKeyRaw, isActive },
  });

  return back({ msg: 'تغییرات قالب ایمیل ذخیره شد.' });
};
