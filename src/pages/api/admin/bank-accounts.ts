import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { purgeCacheTags } from '../../../features/cache/purge';
import { CACHE_TAG } from '../../../features/cache/tags';
import { guardAdminApi } from '../../../features/fulfillment/actor';
import { recordAdminAuditLog } from '../../../features/audit/db';
import {
  createBankAccount,
  deleteBankAccount,
  toggleBankAccountStatus,
  updateBankAccount,
} from '../../../features/payments/bankAccountsDb';

export const POST: APIRoute = async ({ request, redirect, locals, cookies }) => {
  const guard = await guardAdminApi(env.DB, { locals, cookies, request }, 'bank_accounts.manage');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const action = String(form.get('_action') ?? '').trim();

  if (action === 'create') {
    const bankName = String(form.get('bank_name') ?? '');
    const res = await createBankAccount(env.DB, {
      bankName,
      accountHolder: String(form.get('holder_name') ?? ''),
      cardNumber: String(form.get('card_number') ?? ''),
      iban: String(form.get('iban') ?? '') || null,
      accountNumber: String(form.get('account_number') ?? '') || null,
      instructions: String(form.get('instructions') ?? '') || null,
      sortOrder: Number(form.get('sort_order') ?? 0) || 0,
      isActive: form.get('is_active') === '1',
    });

    if (!res.ok) {
      return redirect(`/admin/bank-accounts?error=${encodeURIComponent(res.error)}`, 303);
    }

    await recordAdminAuditLog(env.DB, {
      action: 'bank_account.created',
      module: 'payments',
      targetType: 'bank_account',
      targetId: res.account.public_id,
      actor: guard.actor.id,
      details: { bankName: bankName.trim() },
    });
    await purgeCacheTags([CACHE_TAG.shell]);
    return redirect('/admin/bank-accounts?msg=created', 303);
  }

  if (action === 'update') {
    const publicId = String(form.get('public_id') ?? '').trim();
    const res = await updateBankAccount(env.DB, publicId, {
      bankName: String(form.get('bank_name') ?? ''),
      accountHolder: String(form.get('holder_name') ?? ''),
      cardNumber: String(form.get('card_number') ?? ''),
      iban: String(form.get('iban') ?? '') || null,
      accountNumber: String(form.get('account_number') ?? '') || null,
      instructions: String(form.get('instructions') ?? '') || null,
      sortOrder: Number(form.get('sort_order') ?? 0) || 0,
      isActive: form.get('is_active') === '1',
    });

    if (!res.ok) {
      return redirect(`/admin/bank-accounts?error=${encodeURIComponent(res.error)}`, 303);
    }

    await recordAdminAuditLog(env.DB, {
      action: 'bank_account.updated',
      module: 'payments',
      targetType: 'bank_account',
      targetId: publicId,
      actor: guard.actor.id,
    });
    await purgeCacheTags([CACHE_TAG.shell]);
    return redirect('/admin/bank-accounts?msg=updated', 303);
  }

  if (action === 'toggle') {
    const publicId = String(form.get('public_id') ?? '').trim();
    const isActive = form.get('is_active') === '1';
    await toggleBankAccountStatus(env.DB, publicId, isActive);
    await recordAdminAuditLog(env.DB, {
      action: isActive ? 'bank_account.activated' : 'bank_account.deactivated',
      module: 'payments',
      targetType: 'bank_account',
      targetId: publicId,
      actor: guard.actor.id,
    });
    await purgeCacheTags([CACHE_TAG.shell]);
    return redirect('/admin/bank-accounts?msg=toggled', 303);
  }

  if (action === 'delete') {
    const publicId = String(form.get('public_id') ?? '').trim();
    await deleteBankAccount(env.DB, publicId);
    await recordAdminAuditLog(env.DB, {
      action: 'bank_account.deleted',
      module: 'payments',
      targetType: 'bank_account',
      targetId: publicId,
      actor: guard.actor.id,
    });
    await purgeCacheTags([CACHE_TAG.shell]);
    return redirect('/admin/bank-accounts?msg=deleted', 303);
  }

  return redirect('/admin/bank-accounts', 303);
};
