import { describe, it, expect } from 'vitest';
import { isPartnerPath, isPartnerPortalArea } from '../../lib/partnerRoles';

// The partner-portal route area: what internal staff may not enter, and what
// partners may not leave.
//
// This exists because of a real bug. proxy.ts inlined the inbound check as
// `pathname.startsWith('/api/partner')`, which is not segment-bounded — so
// it also matched `/api/partners`, the INTERNAL Partner module's own API, and
// answered 403 Forbidden to employees opening Sales › Partner. The page
// loaded and its data call failed, which reads as the feature being broken
// rather than as a routing rule.
//
// Every case below that mentions a sibling name is guarding that exact
// mistake.

describe('isPartnerPortalArea', () => {
  it('matches the portal itself and its subtrees', () => {
    expect(isPartnerPortalArea('/partner')).toBe(true);
    expect(isPartnerPortalArea('/partner/projects')).toBe(true);
    expect(isPartnerPortalArea('/partner/onboarding')).toBe(true);
    expect(isPartnerPortalArea('/api/partner')).toBe(true);
    expect(isPartnerPortalArea('/api/partner/onboarding')).toBe(true);
  });

  // The bug. These are internal routes that merely begin with the same
  // letters, and they must NOT be treated as the partner portal.
  it('does not match the internal Partner module', () => {
    expect(isPartnerPortalArea('/partners')).toBe(false);
    expect(isPartnerPortalArea('/partners/new')).toBe(false);
    expect(isPartnerPortalArea('/partners/abc-123')).toBe(false);
    expect(isPartnerPortalArea('/api/partners')).toBe(false);
    expect(isPartnerPortalArea('/api/partners/abc-123')).toBe(false);
  });

  it('does not match the administrative partner screens', () => {
    expect(isPartnerPortalArea('/admin/partners')).toBe(false);
    expect(isPartnerPortalArea('/api/admin/partners')).toBe(false);
  });

  it('does not match an unrelated path', () => {
    expect(isPartnerPortalArea('/')).toBe(false);
    expect(isPartnerPortalArea('/projects')).toBe(false);
    expect(isPartnerPortalArea('/api/projects')).toBe(false);
  });

  // Any other lookalike sibling added later.
  it('does not match a lookalike sibling', () => {
    expect(isPartnerPortalArea('/partnership')).toBe(false);
    expect(isPartnerPortalArea('/api/partner-analytics')).toBe(false);
  });
});

describe('isPartnerPath — what a partner session may reach', () => {
  it('allows the portal and the shared routes it needs', () => {
    expect(isPartnerPath('/partner')).toBe(true);
    expect(isPartnerPath('/partner/onboarding')).toBe(true);
    expect(isPartnerPath('/api/partner/onboarding')).toBe(true);
    expect(isPartnerPath('/api/uploads')).toBe(true);
    expect(isPartnerPath('/api/notifications')).toBe(true);
    expect(isPartnerPath('/change-password')).toBe(true);
  });

  // A partner must not reach the internal Partner module just because its
  // name starts the same way — the mirror image of the bug above.
  it('refuses the internal Partner module and the admin screens', () => {
    expect(isPartnerPath('/partners')).toBe(false);
    expect(isPartnerPath('/api/partners')).toBe(false);
    expect(isPartnerPath('/admin/partners')).toBe(false);
  });

  it('refuses ordinary internal routes', () => {
    expect(isPartnerPath('/projects')).toBe(false);
    expect(isPartnerPath('/api/projects')).toBe(false);
  });
});
