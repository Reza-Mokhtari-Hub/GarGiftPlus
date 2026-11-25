import { describe, it, expect } from 'vitest';
import {
  ADMIN_ALL_PERMISSIONS,
  normalizeAdminRole,
  createAdminActor,
  hasAdminPermission,
  requireAdminPermission,
  canAssignAdminRole,
  canModifyTargetAdmin,
  parseCustomPermissionsJson,
} from './permissions';

describe('admin RBAC permissions and hierarchy', () => {
  it('normalizes known roles and treats empty/unknown safely', () => {
    expect(normalizeAdminRole('fulfillment_operator')).toBe('fulfillment_operator');
    expect(normalizeAdminRole(' FINANCE_MANAGER ')).toBe('finance_manager');
    expect(normalizeAdminRole('none')).toBe('none');
    expect(normalizeAdminRole('unknown_role')).toBe('super_admin');
  });

  it('grants super_admin every permission and blocks role=none completely', () => {
    const superActor = createAdminActor('owner', 'super_admin');
    for (const perm of ADMIN_ALL_PERMISSIONS) {
      expect(hasAdminPermission(superActor, perm)).toBe(true);
    }

    const blockedActor = createAdminActor('blocked', 'none', {
      customPermissions: ['orders.view', 'admins.manage'],
    });
    expect(hasAdminPermission(blockedActor, 'orders.view')).toBe(false);
    expect(requireAdminPermission(blockedActor, 'dashboard.view')).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('enforces scoped operator permissions and 403 error responses', () => {
    const finance = createAdminActor('fin1', 'finance_manager');
    expect(hasAdminPermission(finance, 'receipts.review')).toBe(true);
    expect(hasAdminPermission(finance, 'wallet.adjust')).toBe(true);
    expect(hasAdminPermission(finance, 'orders.fulfill')).toBe(false);

    const check = requireAdminPermission(finance, 'admins.manage');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.status).toBe(403);
    }
  });

  it('prevents self-modification and privilege escalation', () => {
    const superActor = createAdminActor('adm_super', 'super_admin', { publicId: 'adm_super' });
    const opsActor = createAdminActor('adm_ops', 'operations_manager', { publicId: 'adm_ops' });
    const supportActor = createAdminActor('adm_sup', 'support_viewer', { publicId: 'adm_sup' });

    expect(canAssignAdminRole(superActor, 'super_admin')).toBe(true);
    expect(canAssignAdminRole(opsActor, 'super_admin')).toBe(false);
    expect(canAssignAdminRole(supportActor, 'support_viewer')).toBe(false);

    const selfCheck = canModifyTargetAdmin(superActor, {
      publicId: 'adm_super',
      role: 'super_admin',
    });
    expect(selfCheck.ok).toBe(false);

    const otherBySuper = canModifyTargetAdmin(superActor, {
      publicId: 'adm_other',
      role: 'finance_manager',
    });
    expect(otherBySuper.ok).toBe(true);
  });

  it('filters invalid keys out of custom permissions JSON', () => {
    expect(
      parseCustomPermissionsJson('["orders.view","not.a.perm","tickets.manage",123]'),
    ).toEqual(['orders.view', 'tickets.manage']);
    expect(parseCustomPermissionsJson('{bad')).toEqual([]);
  });
});
