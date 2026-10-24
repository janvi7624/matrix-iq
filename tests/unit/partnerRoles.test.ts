import { describe, it, expect } from 'vitest';
import {
  PARTNER_ALLOWED_PREFIXES,
  PARTNER_ROLE_KEYS,
  PARTNER_PORTAL_MODULE_KEYS,
  PARTNER_HOME,
  isPartnerRoleKey,
  isPartnerPath
} from '../../lib/partnerRoles';

// These constants are the Partner Portal's outermost gate: proxy.ts decides
// from isPartnerPath alone whether a partner session may proceed, with no
// database available to second-guess it. A mistake here is a hole in the
// whole feature, so the boundary cases are pinned down explicitly.

describe('isPartnerPath', () => {
  it('allows the portal and its subtrees', () => {
    expect(isPartnerPath('/partner')).toBe(true);
    expect(isPartnerPath('/partner/projects')).toBe(true);
    expect(isPartnerPath('/partner/projects/abc-123')).toBe(true);
    expect(isPartnerPath('/api/partner/me')).toBe(true);
  });

  it('allows the shared account-level routes a partner genuinely needs', () => {
    expect(isPartnerPath('/change-password')).toBe(true);
    expect(isPartnerPath('/api/auth/logout')).toBe(true);
    expect(isPartnerPath('/api/auth/heartbeat')).toBe(true);
    expect(isPartnerPath('/api/notifications')).toBe(true);
    expect(isPartnerPath('/api/sidebar')).toBe(true);
    expect(isPartnerPath('/api/config/public')).toBe(true);
    expect(isPartnerPath('/api/uploads/file/uploads/misc/x.pdf')).toBe(true);
  });

  it('refuses the internal profile pages', () => {
    // These were allowed speculatively and nothing in the portal called
    // them; the page loaded while its API refused the session, producing a
    // screen that failed on arrival.
    expect(isPartnerPath('/profile')).toBe(false);
    expect(isPartnerPath('/api/profile')).toBe(false);
  });

  it('refuses every internal route area', () => {
    expect(isPartnerPath('/')).toBe(false);
    expect(isPartnerPath('/projects')).toBe(false);
    expect(isPartnerPath('/api/projects')).toBe(false);
    expect(isPartnerPath('/api/quotations')).toBe(false);
    expect(isPartnerPath('/admin/users')).toBe(false);
    expect(isPartnerPath('/api/admin/users')).toBe(false);
    expect(isPartnerPath('/tms/tasks')).toBe(false);
    expect(isPartnerPath('/api/search')).toBe(false);
  });

  // The prefix match must not be a bare startsWith: '/partners-internal'
  // shares a prefix with '/partner' but is a different route area, and
  // '/api/partnerships' must not be reachable just by sharing characters.
  it('matches whole path segments, not bare string prefixes', () => {
    expect(isPartnerPath('/partnerships')).toBe(false);
    expect(isPartnerPath('/partner-admin')).toBe(false);
    expect(isPartnerPath('/profiled')).toBe(false);
    expect(isPartnerPath('/api/profiles')).toBe(false);
  });

  it('does not open the internal partner-management screens to partners', () => {
    // /admin/partners is where STAFF manage partners — a partner reaching it
    // would see every other partner in the system.
    expect(isPartnerPath('/admin/partners')).toBe(false);
    expect(isPartnerPath('/api/admin/partners')).toBe(false);
  });
});

describe('the allowlist stays minimal', () => {
  // Every entry must be a route the portal actually calls. The guard against
  // drift is enumerating them: adding a prefix without adding it here fails,
  // which forces the question "does anything actually request this?".
  it('contains exactly the eight route areas the portal uses', () => {
    expect([...PARTNER_ALLOWED_PREFIXES].sort()).toEqual([
      '/api/auth',
      '/api/config/public',
      '/api/notifications',
      '/api/partner',
      '/api/sidebar',
      '/api/uploads',
      '/change-password',
      '/partner'
    ]);
  });

  it('grants no blanket access to an internal API namespace', () => {
    // '/api' or '/api/admin' slipping in would open everything behind it.
    for (const prefix of PARTNER_ALLOWED_PREFIXES) {
      expect(prefix).not.toBe('/api');
      expect(prefix.startsWith('/api/admin')).toBe(false);
    }
  });
});

describe('isPartnerRoleKey', () => {
  it('recognises exactly the two partner roles', () => {
    expect(isPartnerRoleKey('partner-admin')).toBe(true);
    expect(isPartnerRoleKey('partner-user')).toBe(true);
  });

  it('rejects every internal role, including ones that merely look related', () => {
    for (const role of ['superadmin', 'admin', 'manager', 'user', 'engineer', 'technical-manager', 'partner', 'partners']) {
      expect(isPartnerRoleKey(role)).toBe(false);
    }
  });
});

describe('portal constants', () => {
  it('keeps PARTNER_HOME inside the partner route area', () => {
    // Otherwise proxy.ts would redirect a partner to a page it then blocks,
    // producing a redirect loop rather than a denial.
    expect(isPartnerPath(PARTNER_HOME)).toBe(true);
  });

  it('names two partner roles and six portal modules', () => {
    expect([...PARTNER_ROLE_KEYS]).toEqual(['partner-admin', 'partner-user']);
    expect(PARTNER_PORTAL_MODULE_KEYS).toHaveLength(6);
    // Every portal module key must be partner-prefixed: the gate in
    // moduleConfigStore is keyed on membership of this list, and a key that
    // collided with an internal module would hand partners that module.
    for (const key of PARTNER_PORTAL_MODULE_KEYS) {
      expect(key.startsWith('partner-')).toBe(true);
    }
  });
});
