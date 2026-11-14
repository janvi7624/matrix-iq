import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { createPartnerUser, listPartnerUsers, PartnerUserError, updatePartnerUser } from '@/lib/partnerUserStore';
import { PARTNER_ROLE_KEYS, PartnerRoleKey } from '@/lib/partnerRoles';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// A partner company managing its own logins.
//
// Until now the ONLY way to add a partner login was the internal route
// (/api/admin/partners/[id]/users), which refuses partner accounts outright —
// so a Partner Admin had to email us to get a colleague an account. This is
// the portal-side counterpart, deliberately narrow:
//
//   * partnerId is taken from the SESSION, never from the request. There is
//     no path here that names another company, so no check can be forgotten.
//   * Only 'partner-admin' may use it. Every verb re-checks, rather than
//     relying on the nav hiding the tile from 'partner-user'.
//   * Role is constrained to the partner roles. createPartnerUser guards this
//     too — an account bound to a partner but holding an INTERNAL role is the
//     one mistake that would breach the isolation model — but a request that
//     tries it should be refused here with a clear message, not reach the
//     store and throw.
//
// Deliberately NOT offered: deleting a colleague's account. Deactivating is
// enough to remove access, is reversible, and keeps that person's past
// submissions attributable to a real account.

function requireAdmin(viewer: { role: string } | null): boolean {
  return viewer?.role === 'partner-admin';
}

const FORBIDDEN = NextResponse.json(
  { error: 'Only a Partner Admin can manage your team logins.' },
  { status: 403 }
);

export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireAdmin(viewer)) return FORBIDDEN;

  try {
    // Scoped to the caller's own company by the session's partnerId.
    return NextResponse.json({ users: await listPartnerUsers(viewer.partnerId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireAdmin(viewer)) return FORBIDDEN;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const username = str(body.username);
  const name = str(body.name);
  const email = str(body.email);
  const role = str(body.role);

  if (!username || !name || !email) {
    return NextResponse.json({ error: 'Username, name and email are required' }, { status: 400 });
  }
  if (!(PARTNER_ROLE_KEYS as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Role must be Partner Admin or Partner User' }, { status: 400 });
  }

  try {
    const result = await createPartnerUser(
      {
        // From the session, not the body.
        partnerId: viewer.partnerId,
        username,
        name,
        email,
        phone: str(body.phone),
        role: role as PartnerRoleKey
      },
      viewer.userId
    );

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: viewer.partnerId,
      action: `Partner Admin created a portal login for ${name} (${username}) at ${viewer.partner.company_name}`,
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });

    // The temporary password is returned ONCE and never stored in readable
    // form — the created account carries mustChangePassword, so the colleague
    // sets their own on first login. The Partner Admin has to pass this on,
    // which is why the UI keeps it on screen until dismissed.
    return NextResponse.json({ user: result.user, tempPassword: result.tempPassword }, { status: 201 });
  } catch (error) {
    if (error instanceof PartnerUserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireAdmin(viewer)) return FORBIDDEN;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  // Locking yourself out would leave the company with no admin and no way
  // back in except asking us — refuse it rather than let them discover it.
  if (userId === viewer.userId) {
    return NextResponse.json({ error: 'You cannot change your own access here.' }, { status: 400 });
  }

  // What the store actually supports: switch access on/off, and issue a new
  // temporary password. Name/role edits are not offered here — the store has
  // no path for them, and a role change is the one action worth keeping with
  // the account manager.
  const patch: { status?: 'active' | 'inactive'; resetPassword?: boolean } = {};
  if (body.status === 'active' || body.status === 'inactive') patch.status = body.status;
  if (body.resetPassword === true) patch.resetPassword = true;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  try {
    // partnerId FIRST — the store matches on { id, partnerId } together, so a
    // userId belonging to another company resolves to nothing rather than
    // being updated. That is what makes guessing ids useless here.
    const updated = await updatePartnerUser(viewer.partnerId, userId, patch);
    if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: viewer.partnerId,
      action: patch.resetPassword
        ? `Partner Admin reset the portal password for ${updated.record.username} at ${viewer.partner.company_name}`
        : `Partner Admin set the portal login ${updated.record.username} to ${patch.status} at ${viewer.partner.company_name}`,
      previousStatus: '',
      newStatus: patch.status ?? '',
      ip: getClientIp(request)
    });

    return NextResponse.json({ user: updated.record, tempPassword: updated.tempPassword });
  } catch (error) {
    if (error instanceof PartnerUserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiErrorResponse(error);
  }
}
