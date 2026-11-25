import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId';
import { normalizeCardNumber, normalizeIban } from './bankTransfer';
import { recordAdminAuditLog } from '../audit/db';
import { setSetting } from '../settings/db';

export interface BankAccount {
  id: number;
  public_id: string;
  bank_name: string;
  account_holder: string;
  card_number: string;
  iban: string | null;
  account_number: string | null;
  instructions: string | null;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function listBankAccounts(
  db: D1Database,
  onlyActive = false,
): Promise<BankAccount[]> {
  const sql = onlyActive
    ? 'SELECT * FROM bank_accounts WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'
    : 'SELECT * FROM bank_accounts ORDER BY is_active DESC, sort_order ASC, id ASC';
  const { results } = await db.prepare(sql).all<BankAccount>();
  return results ?? [];
}

export async function countActiveBankAccounts(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM bank_accounts WHERE is_active = 1')
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function syncBankAccountsReadySetting(db: D1Database): Promise<void> {
  const activeCount = await countActiveBankAccounts(db);
  await setSetting(db, 'bank_accounts_ready', activeCount > 0 ? '1' : null);
}

export async function getBankAccountByPublicId(
  db: D1Database,
  publicId: string,
): Promise<BankAccount | null> {
  return db
    .prepare('SELECT * FROM bank_accounts WHERE public_id = ?')
    .bind(publicId)
    .first<BankAccount>();
}

export interface BankAccountInput {
  bankName: string;
  accountHolder: string;
  cardNumber: string;
  iban?: string | null;
  accountNumber?: string | null;
  instructions?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export function validateBankAccountInput(
  raw: BankAccountInput,
):
  | {
      ok: true;
      data: {
        bankName: string;
        accountHolder: string;
        cardNumber: string;
        iban: string | null;
        accountNumber: string | null;
        instructions: string | null;
        isActive: number;
        sortOrder: number;
      };
    }
  | { ok: false; error: string } {
  const bankName = raw.bankName.trim();
  const accountHolder = raw.accountHolder.trim();
  if (bankName.length < 2 || bankName.length > 80) {
    return { ok: false, error: 'نام بانک باید بین ۲ تا ۸۰ کاراکتر باشد.' };
  }
  if (accountHolder.length < 2 || accountHolder.length > 120) {
    return { ok: false, error: 'نام صاحب حساب باید بین ۲ تا ۱۲۰ کاراکتر باشد.' };
  }
  const cardNumber = normalizeCardNumber(raw.cardNumber);
  if (!cardNumber) {
    return { ok: false, error: 'شماره کارت باید دقیقاً ۱۶ رقم معتبر باشد.' };
  }
  let iban: string | null = null;
  if (raw.iban && raw.iban.trim()) {
    iban = normalizeIban(raw.iban);
    if (!iban) {
      return { ok: false, error: 'شماره شبا باید با IR شروع شده و ۲۴ رقم داشته باشد.' };
    }
  }
  const accountNumber = raw.accountNumber?.trim().slice(0, 50) || null;
  const instructions = raw.instructions?.trim().slice(0, 600) || null;
  const isActive = raw.isActive === false ? 0 : 1;
  const sortOrder = Number.isFinite(raw.sortOrder) ? Math.trunc(Number(raw.sortOrder)) : 0;

  return {
    ok: true,
    data: {
      bankName,
      accountHolder,
      cardNumber,
      iban,
      accountNumber,
      instructions,
      isActive,
      sortOrder,
    },
  };
}

export async function createBankAccount(
  db: D1Database,
  input: BankAccountInput,
  actor = 'admin',
): Promise<{ ok: true; account: BankAccount } | { ok: false; error: string }> {
  const parsed = validateBankAccountInput(input);
  if (!parsed.ok) return parsed;
  const d = parsed.data;

  const publicId = await withPublicId('bankAccount', async (id) => {
    await db
      .prepare(
        `INSERT INTO bank_accounts
           (public_id, bank_name, account_holder, card_number, iban, account_number, instructions, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        d.bankName,
        d.accountHolder,
        d.cardNumber,
        d.iban,
        d.accountNumber,
        d.instructions,
        d.isActive,
        d.sortOrder,
      )
      .run();
    return id;
  });

  await syncBankAccountsReadySetting(db);

  const account = await getBankAccountByPublicId(db, publicId);
  if (!account) return { ok: false, error: 'ایجاد حساب بانکی با خطا مواجه شد.' };

  await recordAdminAuditLog(db, {
    action: 'bank_account.create',
    targetType: 'bank_account',
    targetId: account.public_id,
    actor,
    details: { bankName: account.bank_name, accountHolder: account.account_holder },
  });

  return { ok: true, account };
}

export async function updateBankAccount(
  db: D1Database,
  publicId: string,
  input: BankAccountInput,
  actor = 'admin',
): Promise<{ ok: true; account: BankAccount } | { ok: false; error: string }> {
  const existing = await getBankAccountByPublicId(db, publicId);
  if (!existing) return { ok: false, error: 'حساب بانکی مورد نظر یافت نشد.' };

  const parsed = validateBankAccountInput(input);
  if (!parsed.ok) return parsed;
  const d = parsed.data;

  await db
    .prepare(
      `UPDATE bank_accounts
          SET bank_name = ?,
              account_holder = ?,
              card_number = ?,
              iban = ?,
              account_number = ?,
              instructions = ?,
              is_active = ?,
              sort_order = ?,
              updated_at = datetime('now')
        WHERE public_id = ?`,
    )
    .bind(
      d.bankName,
      d.accountHolder,
      d.cardNumber,
      d.iban,
      d.accountNumber,
      d.instructions,
      d.isActive,
      d.sortOrder,
      publicId,
    )
    .run();

  await syncBankAccountsReadySetting(db);

  const updated = await getBankAccountByPublicId(db, publicId);
  if (!updated) return { ok: false, error: 'بروزرسانی حساب بانکی انجام نشد.' };

  await recordAdminAuditLog(db, {
    action: 'bank_account.update',
    targetType: 'bank_account',
    targetId: publicId,
    actor,
    details: { bankName: updated.bank_name, isActive: updated.is_active },
  });

  return { ok: true, account: updated };
}

export async function toggleBankAccountStatus(
  db: D1Database,
  publicId: string,
  isActive: boolean,
  actor = 'admin',
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE bank_accounts
          SET is_active = ?, updated_at = datetime('now')
        WHERE public_id = ?`,
    )
    .bind(isActive ? 1 : 0, publicId)
    .run();
  if ((res.meta?.changes ?? 0) > 0) {
    await syncBankAccountsReadySetting(db);
    await recordAdminAuditLog(db, {
      action: isActive ? 'bank_account.enable' : 'bank_account.disable',
      targetType: 'bank_account',
      targetId: publicId,
      actor,
    });
    return true;
  }
  return false;
}

export async function deleteBankAccount(
  db: D1Database,
  publicId: string,
  actor = 'admin',
): Promise<boolean> {
  const res = await db
    .prepare('DELETE FROM bank_accounts WHERE public_id = ?')
    .bind(publicId)
    .run();
  if ((res.meta?.changes ?? 0) > 0) {
    await syncBankAccountsReadySetting(db);
    await recordAdminAuditLog(db, {
      action: 'bank_account.delete',
      targetType: 'bank_account',
      targetId: publicId,
      actor,
    });
    return true;
  }
  return false;
}
