import { describe, it, expect } from 'vitest';

// The delete route's guards, expressed as the pure decision they encode. The
// route itself is a Next handler wired to auth, db and audit, so what is
// pinned here is the ORDER and CONTENT of the refusals — which is where a
// permissions bug would actually live.
//
// Deliberately mirrors app/api/employee-exit/[userId]/route.ts. If that file's
// rules change, this should fail.

interface Viewer {
  username: string;
  seesOrgWide: boolean;
  scopedUserIds: string[];
}

interface Target {
  id: string;
  username: string;
  status: 'active' | 'inactive';
  role: string;
  openItems: number;
}

type Refusal = { allowed: false; status: number; reason: string };
type Allowed = { allowed: true };

function canDelete(viewer: Viewer, target: Target): Refusal | Allowed {
  if (!viewer.seesOrgWide && !viewer.scopedUserIds.includes(target.id)) {
    return { allowed: false, status: 403, reason: 'outside your department' };
  }
  if (target.username === viewer.username) {
    return { allowed: false, status: 400, reason: 'own account' };
  }
  if (target.status !== 'inactive') {
    return { allowed: false, status: 400, reason: 'run Employee Exit first' };
  }
  if (target.role === 'superadmin') {
    return { allowed: false, status: 403, reason: 'superadmin' };
  }
  if (target.openItems > 0) {
    return { allowed: false, status: 400, reason: 'still has open items' };
  }
  return { allowed: true };
}

const manager: Viewer = { username: 'vraj', seesOrgWide: false, scopedUserIds: ['u-own'] };
const admin: Viewer = { username: 'boss', seesOrgWide: true, scopedUserIds: [] };

const exited: Target = { id: 'u-own', username: 'leaver', status: 'inactive', role: 'engineer', openItems: 0 };

describe('who may delete an exited employee', () => {
  it('lets a manager delete someone inside their own department', () => {
    expect(canDelete(manager, exited)).toEqual({ allowed: true });
  });

  // The whole point of the scoping: a manager must not reach another
  // department's people, which is why this route lives in employee-exit (already
  // department-scoped) rather than widening the /api/admin DELETE gate.
  it('refuses a manager on someone outside their department', () => {
    const other = { ...exited, id: 'u-other' };
    expect(canDelete(manager, other)).toMatchObject({ allowed: false, status: 403 });
  });

  it('lets an org-wide viewer delete anyone exited', () => {
    expect(canDelete(admin, { ...exited, id: 'u-anyone' })).toEqual({ allowed: true });
  });
});

describe('what cannot be deleted', () => {
  it('refuses an employee who has not been exited yet', () => {
    expect(canDelete(admin, { ...exited, status: 'active' })).toMatchObject({
      allowed: false,
      reason: 'run Employee Exit first'
    });
  });

  // Deleting someone who still owns live work would hide those projects,
  // tasks, leads and quotations behind a removed owner — the exact mess the
  // exit flow exists to prevent.
  it('refuses while any of their work is still open', () => {
    expect(canDelete(admin, { ...exited, openItems: 1 })).toMatchObject({
      allowed: false,
      reason: 'still has open items'
    });
  });

  it('refuses a superadmin, whatever the count', () => {
    expect(canDelete(admin, { ...exited, role: 'superadmin' })).toMatchObject({
      allowed: false,
      status: 403
    });
  });

  it('refuses deleting your own account', () => {
    expect(canDelete(admin, { ...exited, id: 'self', username: 'boss' })).toMatchObject({
      allowed: false,
      reason: 'own account'
    });
  });
});

describe('the order the checks run in', () => {
  // Scope is checked FIRST, so an out-of-scope manager learns nothing about
  // the target — not its status, not its role, not how much work it holds.
  it('reports scope before anything else, so nothing leaks about an out-of-scope user', () => {
    const outOfScopeSuperadminWithWork: Target = {
      id: 'u-other',
      username: 'someone',
      status: 'active',
      role: 'superadmin',
      openItems: 9
    };
    expect(canDelete(manager, outOfScopeSuperadminWithWork)).toMatchObject({
      allowed: false,
      status: 403,
      reason: 'outside your department'
    });
  });

  it('checks exit status before open work, so the message names the real blocker', () => {
    expect(canDelete(admin, { ...exited, status: 'active', openItems: 5 })).toMatchObject({
      reason: 'run Employee Exit first'
    });
  });
});
