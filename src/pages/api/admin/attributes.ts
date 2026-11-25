import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import { parsePublicId } from '../../../features/ids/publicId';

export const prerender = false;

/**
 * POST /api/admin/attributes
 * تغییر وضعیت سریع (فعال/غیرفعال یا الزامی/اختیاری) روی فیلدهای سفارشی محصولات.
 */
export const POST: APIRoute = async ({ request, locals, cookies, redirect }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'attributes.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const action = String(form.get('_action') ?? '').trim();
  const fieldPublicId = parsePublicId(String(form.get('field_public_id') ?? '').trim(), 'checkoutField');

  const fail = (msg: string) =>
    redirect(`/admin/attributes?error=${encodeURIComponent(msg)}`, 303);

  if (!fieldPublicId) return fail('شناسه فیلد معتبر نیست.');

  const row = await env.DB
    .prepare(
      `SELECT f.id, f.public_id, f.field_key, f.field_type, f.label, f.is_active, f.is_required, p.public_id AS product_public_id
         FROM product_checkout_fields f
         JOIN products p ON p.id = f.product_id
        WHERE f.public_id = ?`,
    )
    .bind(fieldPublicId)
    .first<{
      id: number;
      public_id: string;
      field_key: string;
      field_type: string;
      label: string;
      is_active: number;
      is_required: number;
      product_public_id: string | null;
    }>();

  if (!row) return fail('فیلد مورد نظر یافت نشد.');
  if (row.field_type.toLowerCase() === 'password') {
    return fail('فیلد نوع password مجاز نیست و قابل فعال‌سازی نمی‌باشد.');
  }

  if (action === 'toggle_active') {
    const next = row.is_active === 1 ? 0 : 1;
    await env.DB
      .prepare(`UPDATE product_checkout_fields SET is_active = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(next, row.id)
      .run();
    await recordAdminAuditLog(env.DB, {
      action: 'attributes.field_toggled_active',
      module: 'catalog',
      targetType: 'product_checkout_field',
      targetId: row.public_id,
      actor: guard.actor.id,
      details: { fieldKey: row.field_key, isActive: next, productPublicId: row.product_public_id },
    });
    return redirect('/admin/attributes?saved=1', 303);
  }

  if (action === 'toggle_required') {
    const next = row.is_required === 1 ? 0 : 1;
    await env.DB
      .prepare(`UPDATE product_checkout_fields SET is_required = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(next, row.id)
      .run();
    await recordAdminAuditLog(env.DB, {
      action: 'attributes.field_toggled_required',
      module: 'catalog',
      targetType: 'product_checkout_field',
      targetId: row.public_id,
      actor: guard.actor.id,
      details: { fieldKey: row.field_key, isRequired: next, productPublicId: row.product_public_id },
    });
    return redirect('/admin/attributes?saved=1', 303);
  }

  return fail('عملیات نامعتبر است.');
};
