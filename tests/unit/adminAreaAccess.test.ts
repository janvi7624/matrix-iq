import { describe, it, expect } from 'vitest';
import { isAdminOnlyPath, isPartnerAdminArea, mayReachAdminArea } from '../../lib/adminAreaAccess';

// The /admin gate, with the one exemption partner onboarding needed.
//
// Partner accounts are brought in by ordinary sales staff on the generic
// 'user' role, but Partner Management lives under /admin/partners, which the
// proxy gates on isPrivileged. Making those people admins would also hand
// them User Management, Role Management and every other /admin screen — so
// the exemption has to be exactly two subtrees, and these tests exist to
// keep it that way.

const PLAIN = { isPrivileged: false };
const CREATOR = { isPrivileged: false, partnerCreator: true };
const ADMIN = { isPrivileged: true };

describe('isAdminOnlyPath', () => {
  it('covers the admin areas', () => {
    expect(isAdminOnlyPath('/admin')).toBe(true);
    expect(isAdminOnlyPath('/admin/users')).toBe(true);
    expect(isAdminOnlyPath('/api/admin/partners')).toBe(true);
    expect(isAdminOnlyPath('/quotation-history')).toBe(true);
  });

  it('leaves ordinary pages alone', () => {
    expect(isAdminOnlyPath('/')).toBe(false);
    expect(isAdminOnlyPath('/projects')).toBe(false);
    expect(isAdminOnlyPath('/api/projects')).toBe(false);
  });

  // A path that merely STARTS with the same letters is not the admin area.
  it('does not match a lookalike prefix', () => {
    expect(isAdminOnlyPath('/administration-notes')).toBe(false);
    expect(isAdminOnlyPath('/api/administrative')).toBe(false);
  });
});

describe('isPartnerAdminArea', () => {
  it('is the partner page and its API, including subtrees', () => {
    expect(isPartnerAdminArea('/admin/partners')).toBe(true);
    expect(isPartnerAdminArea('/admin/partners/abc-123')).toBe(true);
    expect(isPartnerAdminArea('/api/admin/partners')).toBe(true);
    expect(isPartnerAdminArea('/api/admin/partners/abc-123/documents')).toBe(true);
  });

  it('is nothing else under /admin', () => {
    expect(isPartnerAdminArea('/admin')).toBe(false);
    expect(isPartnerAdminArea('/admin/users')).toBe(false);
    expect(isPartnerAdminArea('/admin/roles')).toBe(false);
    expect(isPartnerAdminArea('/api/admin/users')).toBe(false);
  });

  // The exemption must not be satisfied by a path that merely begins the
  // same way — '/admin/partners-export' is not Partner Management.
  it('does not match a lookalike sibling', () => {
    expect(isPartnerAdminArea('/admin/partnersecret')).toBe(false);
    expect(isPartnerAdminArea('/admin/partners-export')).toBe(false);
    expect(isPartnerAdminArea('/api/admin/partnersomething')).toBe(false);
  });
});

describe('mayReachAdminArea', () => {
  it('lets anyone reach a non-admin path', () => {
    expect(mayReachAdminArea('/projects', PLAIN)).toBe(true);
    expect(mayReachAdminArea('/partner/onboarding', PLAIN)).toBe(true);
  });

  it('lets a privileged account reach everything', () => {
    expect(mayReachAdminArea('/admin/users', ADMIN)).toBe(true);
    expect(mayReachAdminArea('/admin/partners', ADMIN)).toBe(true);
  });

  it('refuses a plain account every admin path', () => {
    expect(mayReachAdminArea('/admin/users', PLAIN)).toBe(false);
    expect(mayReachAdminArea('/admin/partners', PLAIN)).toBe(false);
  });

  // The point of the claim.
  it('lets a partner creator reach Partner Management', () => {
    expect(mayReachAdminArea('/admin/partners', CREATOR)).toBe(true);
    expect(mayReachAdminArea('/admin/partners/abc-123', CREATOR)).toBe(true);
    expect(mayReachAdminArea('/api/admin/partners/abc-123/documents', CREATOR)).toBe(true);
  });

  // And the limit of it — this is the test that would catch the exemption
  // being widened by accident.
  it('still refuses a partner creator every other admin screen', () => {
    expect(mayReachAdminArea('/admin', CREATOR)).toBe(false);
    expect(mayReachAdminArea('/admin/users', CREATOR)).toBe(false);
    expect(mayReachAdminArea('/admin/roles', CREATOR)).toBe(false);
    expect(mayReachAdminArea('/admin/daily-report-config', CREATOR)).toBe(false);
    expect(mayReachAdminArea('/api/admin/users', CREATOR)).toBe(false);
    expect(mayReachAdminArea('/quotation-history', CREATOR)).toBe(false);
  });

  it('treats a missing claim as absent, not permissive', () => {
    expect(mayReachAdminArea('/admin/partners', {})).toBe(false);
    expect(mayReachAdminArea('/admin/partners', { partnerCreator: false })).toBe(false);
  });
});
