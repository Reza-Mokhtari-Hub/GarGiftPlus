import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { adminAdjustCustomerWallet } from '../../../../features/wallet/db';
import { guardAdminApi } from '../../../../features/fulfillment/actor';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'wallet.adjust');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const directionRaw = String(form.get('direction') ?? 'credit').trim();
  const rawType = directionRaw === 'debit' ? 'ADMIN_DEBIT' : 'ADMIN_CREDIT';
  const rawAmount = form.get('amount');
  const rawReason = form.get('reason');

  if (!email) {
    return redirect('/admin/customers', 303);
  }

  const returnBase = `/admin/customers/${encodeURIComponent(email)}`;
  const res = await adminAdjustCustomerWallet(env.DB, {
    customerEmail: email,
    rawType,
    rawAmount,
    rawReason,
    adminActor: guard.actor.id,
  });

  if (!res.ok) {
    return redirect(`${returnBase}?error=${encodeURIComponent(res.error)}`, 303);
  }

  return redirect(`${returnBase}?msg=wallet_adjusted`, 303);
};
