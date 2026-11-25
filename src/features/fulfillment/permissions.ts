/**
 * مدل جامع نقش‌ها و مجوزهای سطح‌بندی‌شده (RBAC) در پنل مدیریت GarGift+
 *
 * تمام بررسی‌های دسترسی به‌صورت اجباری در سمت سرور (API و صفحات SSR) انجام می‌شوند
 * و صرفاً به مخفی‌سازی گزینه‌ها در رابط کاربری اکتفا نمی‌شود.
 */

export const ADMIN_FULFILLMENT_PERMISSIONS = [
  'orders.view',
  'orders.view_customer_inputs',
  'orders.fulfill',
  'orders.edit_published_delivery',
  'orders.download_private_files',
  'orders.send_delivery_notifications',
] as const;

export const ADMIN_ALL_PERMISSIONS = [
  'dashboard.view',
  'products.view',
  'products.manage',
  'categories.manage',
  'attributes.manage',
  'media.manage',
  'orders.view',
  'orders.view_customer_inputs',
  'orders.fulfill',
  'orders.edit_published_delivery',
  'orders.download_private_files',
  'orders.send_delivery_notifications',
  'orders.export',
  'orders.refund',
  'customers.view',
  'customers.manage',
  'wallet.view',
  'wallet.adjust',
  'payments.view',
  'payments.manage',
  'receipts.review',
  'bank_accounts.manage',
  'content.manage',
  'emails.manage',
  'tickets.manage',
  'theme.manage',
  'settings.manage',
  'admins.manage',
  'audit.view',
  'reports.view',
  'maintenance.manage',
] as const;

export type AdminFulfillmentPermission = (typeof ADMIN_FULFILLMENT_PERMISSIONS)[number];
export type AdminPermission = (typeof ADMIN_ALL_PERMISSIONS)[number];

export const ADMIN_ROLES = [
  'super_admin',
  'operations_manager',
  'fulfillment_manager',
  'fulfillment_operator',
  'finance_manager',
  'product_manager',
  'content_manager',
  'support_viewer',
  'none',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'مدیر ارشد سیستم (Super Admin)',
  operations_manager: 'مدیر عملیات و فروش',
  fulfillment_manager: 'مدیر واحد تحویل (Fulfillment Manager)',
  fulfillment_operator: 'کارشناس تحویل سفارش (Fulfillment Operator)',
  finance_manager: 'مدیر مالی و درگاه‌ها',
  product_manager: 'مدیر کاتالوگ و محصولات',
  content_manager: 'مدیر محتوا و صفحه اصلی',
  support_viewer: 'پشتیبان و ناظر سفارش‌ها',
  none: 'بدون دسترسی (مسدود)',
};

export const ADMIN_ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin: 'دسترسی کامل به تمام ماژول‌ها، تنظیمات امنیتی، کلیدها و مدیریت مدیران',
  operations_manager: 'مدیریت محصولات، سفارش‌ها، تحویل، مشتریان، تیکت‌ها و گزارش‌ها بدون تغییر مدیران',
  fulfillment_manager: 'مدیریت کامل صف تحویل، ویرایش تحویل‌های منتشرشده، فایل‌های خصوصی و اعلان‌ها',
  fulfillment_operator: 'مشاهده ورودی‌های مشتری و انجام تحویل سفارش‌ها و آپلود پیوست تحویل',
  finance_manager: 'بررسی فیش‌های بانکی، تراکنش‌ها، حساب‌های بانکی، بازگشت وجه، کیف پول و گزارش‌های مالی',
  product_manager: 'مدیریت محصولات، قیمت‌ها، ویژگی‌ها، دسته‌بندی‌ها و رسانه',
  content_manager: 'مدیریت صفحه اصلی، بنرها، صفحات محتوایی، منوها و ظاهر فروشگاه',
  support_viewer: 'مشاهده سفارش‌ها، مشتریان، تیکت‌ها و پاسخ‌گویی به پشتیبانی بدون دسترسی مالی حساس',
  none: 'حساب غیرفعال یا فاقد هرگونه مجوز عملیاتی',
};

export const PERMISSION_LABELS: Record<AdminPermission, string> = {
  'dashboard.view': 'مشاهده داشبورد مدیریتی',
  'products.view': 'مشاهده فهرست محصولات',
  'products.manage': 'ایجاد، ویرایش و حذف محصولات',
  'categories.manage': 'مدیریت دسته‌بندی‌ها',
  'attributes.manage': 'مدیریت تنوع‌ها و فیلدهای سفارشی',
  'media.manage': 'مدیریت کتابخانه رسانه',
  'orders.view': 'مشاهده سفارش‌ها',
  'orders.view_customer_inputs': 'مشاهده اطلاعات ثبت‌شده خریدار در سفارش',
  'orders.fulfill': 'انجام تحویل سفارش و ثبت اطلاعات خرید',
  'orders.edit_published_delivery': 'ویرایش تحویل پس از انتشار',
  'orders.download_private_files': 'دانلود فایل‌های خصوصی تحویل و فیش‌ها',
  'orders.send_delivery_notifications': 'ارسال اعلان ایمیلی تحویل',
  'orders.export': 'خروجی CSV سفارش‌ها',
  'orders.refund': 'ثبت و بررسی بازگشت وجه',
  'customers.view': 'مشاهده مشتریان',
  'customers.manage': 'ویرایش و مسدودسازی حساب مشتریان',
  'wallet.view': 'مشاهده موجودی و دفترکل کیف پول‌ها',
  'wallet.adjust': 'تغییر دستی موجودی کیف پول مشتریان',
  'payments.view': 'مشاهده تراکنش‌های پرداخت',
  'payments.manage': 'تغییر پیکربندی درگاه‌ها و روش‌های پرداخت',
  'receipts.review': 'بررسی، تایید و رد فیش‌های بانکی',
  'bank_accounts.manage': 'مدیریت حساب‌ها و کارت‌های بانکی',
  'content.manage': 'مدیریت صفحه اصلی، بنرها، صفحات و منوها',
  'emails.manage': 'مدیریت قالب‌های ایمیل و صندوق ارسال',
  'tickets.manage': 'مشاهده و پاسخ به تیکت‌های پشتیبانی',
  'theme.manage': 'شخصی‌سازی ظاهر و تم فروشگاه',
  'settings.manage': 'تغییر تنظیمات فروشگاه و ارسال',
  'admins.manage': 'مدیریت مدیران، نقش‌ها و مجوزها',
  'audit.view': 'مشاهده گزارش ممیزی عملیات (Audit Logs)',
  'reports.view': 'مشاهده گزارش‌های تحلیلی و مالی',
  'maintenance.manage': 'وضعیت سیستم، همگام‌سازی و نگهداری',
};

const ALL_SET = new Set<AdminPermission>(ADMIN_ALL_PERMISSIONS);

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  super_admin: ALL_SET,
  operations_manager: new Set<AdminPermission>([
    'dashboard.view',
    'products.view',
    'products.manage',
    'categories.manage',
    'attributes.manage',
    'media.manage',
    'orders.view',
    'orders.view_customer_inputs',
    'orders.fulfill',
    'orders.edit_published_delivery',
    'orders.download_private_files',
    'orders.send_delivery_notifications',
    'orders.export',
    'orders.refund',
    'customers.view',
    'customers.manage',
    'wallet.view',
    'payments.view',
    'receipts.review',
    'content.manage',
    'emails.manage',
    'tickets.manage',
    'reports.view',
    'audit.view',
  ]),
  fulfillment_manager: new Set<AdminPermission>([
    'dashboard.view',
    'products.view',
    'orders.view',
    'orders.view_customer_inputs',
    'orders.fulfill',
    'orders.edit_published_delivery',
    'orders.download_private_files',
    'orders.send_delivery_notifications',
    'orders.export',
    'customers.view',
    'tickets.manage',
    'audit.view',
  ]),
  fulfillment_operator: new Set<AdminPermission>([
    'dashboard.view',
    'products.view',
    'orders.view',
    'orders.view_customer_inputs',
    'orders.fulfill',
    'orders.download_private_files',
    'orders.send_delivery_notifications',
    'tickets.manage',
  ]),
  finance_manager: new Set<AdminPermission>([
    'dashboard.view',
    'orders.view',
    'orders.export',
    'orders.refund',
    'orders.download_private_files',
    'customers.view',
    'wallet.view',
    'wallet.adjust',
    'payments.view',
    'payments.manage',
    'receipts.review',
    'bank_accounts.manage',
    'reports.view',
    'audit.view',
  ]),
  product_manager: new Set<AdminPermission>([
    'dashboard.view',
    'products.view',
    'products.manage',
    'categories.manage',
    'attributes.manage',
    'media.manage',
    'content.manage',
  ]),
  content_manager: new Set<AdminPermission>([
    'dashboard.view',
    'products.view',
    'media.manage',
    'content.manage',
    'emails.manage',
    'theme.manage',
  ]),
  support_viewer: new Set<AdminPermission>([
    'dashboard.view',
    'products.view',
    'orders.view',
    'orders.view_customer_inputs',
    'customers.view',
    'wallet.view',
    'payments.view',
    'tickets.manage',
  ]),
  none: new Set<AdminPermission>(),
};

/** رتبه‌بندی سلسله‌مراتبی برای جلوگیری از ارتقای سطح دسترسی غیرمجاز */
const ROLE_RANK: Record<AdminRole, number> = {
  none: 0,
  support_viewer: 10,
  content_manager: 20,
  product_manager: 20,
  fulfillment_operator: 30,
  finance_manager: 40,
  fulfillment_manager: 40,
  operations_manager: 60,
  super_admin: 100,
};

export interface AdminActor {
  id: string;
  publicId?: string | null;
  displayName?: string;
  email?: string | null;
  role: AdminRole;
  isPrimaryOwner?: boolean;
  permissions: ReadonlySet<AdminPermission>;
}

export function parseStrictAdminRole(rawRole: string | null | undefined): AdminRole | null {
  const cleaned = (rawRole ?? '').trim().toLowerCase();
  if ((ADMIN_ROLES as readonly string[]).includes(cleaned)) {
    return cleaned as AdminRole;
  }
  return null;
}

export function normalizeAdminRole(rawRole: string | null | undefined): AdminRole {
  return parseStrictAdminRole(rawRole) ?? 'none';
}

export const resolveAdminRole = normalizeAdminRole;

export function getPermissionsForRole(role: AdminRole): ReadonlySet<AdminPermission> {
  return ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.none;
}

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_ALL_PERMISSIONS as readonly string[]).includes(value);
}

export function parseCustomPermissionsJson(raw: string | null | undefined): AdminPermission[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AdminPermission => typeof item === 'string' && isAdminPermission(item));
  } catch {
    return [];
  }
}

export function createAdminActor(
  actorId: string | null | undefined,
  role: AdminRole = 'super_admin',
  options?: {
    publicId?: string | null;
    displayName?: string;
    email?: string | null;
    isPrimaryOwner?: boolean;
    customPermissions?: readonly AdminPermission[] | null;
  },
): AdminActor {
  const base = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.none;
  const merged = new Set<AdminPermission>(base);
  if (role !== 'none' && options?.customPermissions) {
    for (const perm of options.customPermissions) {
      merged.add(perm);
    }
  }
  const cleanId = (actorId ?? '').trim() || 'admin';
  return {
    id: cleanId,
    publicId: options?.publicId ?? null,
    displayName: options?.displayName || (cleanId === 'admin' ? 'مدیر سیستم' : cleanId),
    email: options?.email ?? null,
    role,
    isPrimaryOwner: options?.isPrimaryOwner ?? false,
    permissions: merged,
  };
}

export function hasAdminPermission(
  actor: AdminActor | null | undefined,
  permission: AdminPermission,
): boolean {
  if (!actor || actor.role === 'none') return false;
  return actor.permissions.has(permission);
}

export function hasAnyAdminPermission(
  actor: AdminActor | null | undefined,
  permissions: readonly AdminPermission[],
): boolean {
  if (!actor || actor.role === 'none') return false;
  return permissions.some((p) => actor.permissions.has(p));
}

export function requireAdminPermission(
  actor: AdminActor | null | undefined,
  permission: AdminPermission,
): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  if (!actor || actor.role === 'none') {
    return {
      ok: false,
      status: 401,
      error: 'احراز هویت مدیر برای انجام این عملیات الزامی است.',
    };
  }
  if (!actor.permissions.has(permission)) {
    return {
      ok: false,
      status: 403,
      error: `شما مجوز لازم (${PERMISSION_LABELS[permission] ?? permission}) برای انجام این عملیات را ندارید.`,
    };
  }
  return { ok: true };
}

/**
 * کنترل امنیتی جلوگیری از خودارتقایی یا دستکاری مدیر بالاتر توسط نقش‌های پایین‌تر.
 */
export function canAssignAdminRole(actor: AdminActor, targetRole: AdminRole): boolean {
  if (!hasAdminPermission(actor, 'admins.manage')) return false;
  if (actor.role === 'super_admin') return true;
  return ROLE_RANK[targetRole] < ROLE_RANK[actor.role];
}

export function canModifyTargetAdmin(
  actor: AdminActor,
  target: { publicId: string; role: AdminRole },
): { ok: true } | { ok: false; reason: string } {
  if (!hasAdminPermission(actor, 'admins.manage')) {
    return { ok: false, reason: 'مجوز مدیریت مدیران را ندارید.' };
  }
  if (actor.publicId && actor.publicId === target.publicId) {
    return { ok: false, reason: 'برای جلوگیری از خودارتقایی یا قفل شدن حساب، امکان تغییر نقش یا غیرفعال‌سازی حساب فعلی خودتان وجود ندارد.' };
  }
  if (actor.role !== 'super_admin' && ROLE_RANK[target.role] >= ROLE_RANK[actor.role]) {
    return { ok: false, reason: 'امکان ویرایش مدیری با سطح دسترسی هم‌تراز یا بالاتر از خودتان را ندارید.' };
  }
  return { ok: true };
}
