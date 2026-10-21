import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManagePartners } from '@/lib/partnerAccess';
import { findPartnerById } from '@/lib/partnerStore';
import { createPartnerUser, listPartnerUsers, PartnerUserError, updatePartnerUser } from '@/lib/partnerUserStore';
import { PARTNER_ROLE_KEYS, PartnerRoleKey } from '@/lib/partnerRoles';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await params;
    return NextResponse.json(await listPartnerUsers(id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = typeof body.role === 'string' ? body.role : '';

  if (!username || !name || !email) {
    return NextResponse.json({ error: 'Username, name and email are required' }, { status: 400 });
  }
  if (!(PARTNER_ROLE_KEYS as readonly string[]).includes(role)) {
    return NextResponse.json({ error: 'Role must be Partner Admin or Partner User' }, { status: 400 });
  }

  try {
    const { id } = await params;
    const partner = await findPartnerById(id);
    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

    const result = await createPartnerUser(
      { partnerId: id, username, name, email, phone: typeof body.phone === 'string' ? body.phone.trim() : '', role: role as PartnerRoleKey },
      viewer.userId
    );

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner_user',
      entityId: result.user.id,
      action: `Partner login created: ${result.user.username} for ${partner.company_name}`,
      previousStatus: '',
      newStatus: 'active',
      ip: getClientIp(request)
    });

    // tempPassword is returned so the screen can show it once — SES may be
    // unconfigured or the address may bounce, and an account nobody can get
    // into is worse than one whose password was read off the screen by the
    // manager who just created it.
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PartnerUserError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message === 'Username already exists') {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
    }
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  if (body.status && body.status !== 'active' && body.status !== 'inactive') {
    return NextResponse.json({ error: 'Status must be active or inactive' }, { status: 400 });
  }

  try {
    const { id } = await params;
    // Scoped by BOTH ids in the store, so a userId belonging to another
    // partner — or to an internal employee — simply does not resolve here.
    const result = await updatePartnerUser(id, userId, {
      status: body.status,
      resetPassword: body.resetPassword === true
    });
    if (!result) return NextResponse.json({ error: 'Partner login not found' }, { status: 404 });

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner_user',
      entityId: userId,
      action: body.resetPassword ? `Partner login password reset: ${result.record.username}` : `Partner login ${body.status}: ${result.record.username}`,
      previousStatus: '',
      newStatus: result.record.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
