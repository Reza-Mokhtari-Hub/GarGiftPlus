import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getVerifiedCustomer } from '../../../features/auth/customer';
import {
  normalizeIranPhone,
  updateCustomerProfile,
} from '../../../features/customers/accountsDb';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const customer = await getVerifiedCustomer(cookies);
  if (!customer) {
    return redirect('/account/login', 303);
  }

  const form = await request.formData();
  const fullName = String(form.get('full_name') ?? '').trim();
  const rawPhone = String(form.get('phone') ?? '').trim();

  if (fullName.length > 120) {
    return redirect(
      `/account/profile?error=${encodeURIComponent('نام و نام خانوادگی نباید بیش از ۱۲۰ کاراکتر باشد.')}`,
      303,
    );
  }

  let normalizedPhone: string | null = null;
  if (rawPhone) {
    normalizedPhone = normalizeIranPhone(rawPhone);
    if (!normalizedPhone) {
      return redirect(
        `/account/profile?error=${encodeURIComponent('شماره موبایل واردشده معتبر نیست (مثال: 09123456789).')}`,
        303,
      );
    }
  }

  await updateCustomerProfile(env.DB, customer.id, {
    fullName: fullName || null,
    phone: normalizedPhone,
  });

  return redirect('/account/profile?saved=1', 303);
};
