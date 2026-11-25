import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { guardAdminApi } from '../../../../features/fulfillment/actor';
import {
  ensureCustomerByEmail,
  getCustomerByEmail,
  normalizeIranPhone,
  updateCustomerAdmin,
} from '../../../../features/customers/accountsDb';
import { recordAdminAuditLog } from '../../../../features/audit/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'customers.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!email) return redirect('/admin/customers', 303);

  const returnBase = `/admin/customers/${encodeURIComponent(email)}`;
  const fail = (msg: string) => redirect(`${returnBase}?error=${encodeURIComponent(msg)}`, 303);

  const existing = (await getCustomerByEmail(env.DB, email)) ?? (await ensureCustomerByEmail(env.DB, email, false));

  const statusRaw = String(form.get('status') ?? existing.status ?? 'active').trim();
  const status: 'active' | 'suspended' = statusRaw === 'suspended' ? 'suspended' : 'active';
  const fullName = form.has('full_name') ? String(form.get('full_name') ?? '').trim() : existing.full_name;
  const phoneInput = form.has('phone') ? String(form.get('phone') ?? '').trim() : existing.phone;
  if (form.has('phone') && phoneInput && !normalizeIranPhone(phoneInput)) {
    return fail('شماره موبایل واردشده باید با ۰۹ شروع شود (۱۱ رقم معتبر ایران).');
  }
  const adminNotes = form.has('admin_notes')
    ? String(form.get('admin_notes') ?? '').trim()
    : existing.admin_notes;

  await updateCustomerAdmin(env.DB, existing.id, {
    status,
    fullName,
    phone: phoneInput || null,
    adminNotes: adminNotes || null,
  });

  await recordAdminAuditLog(env.DB, {
    action: status === 'suspended' ? 'customer.suspended' : 'customer.updated',
    module: 'customers',
    targetType: 'customer',
    targetId: existing.public_id || email,
    actor: guard.actor.id,
    details: { email, status, hasNotes: Boolean(adminNotes) },
  });

  return redirect(`${returnBase}?msg=profile_saved`, 303);
};
