import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManagePartners } from '@/lib/partnerAccess';
import { findPartnerById, setPartnerStatus, updatePartner } from '@/lib/partnerStore';
import { listPartnerUsers } from '@/lib/partnerUserStore';
import { PartnerStatus } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

const STATUSES: PartnerStatus[] = ['pending', 'active', 'suspended', 'inactive'];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const { id } = await params;
    const partner = await findPartnerById(id);
    if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });
    // The partner's logins come back with the profile — the detail screen
    // always shows both, and splitting them would cost a second round trip
    // for data that is never wanted separately.
    return NextResponse.json({ partner, users: await listPartnerUsers(id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const { id } = await params;
    const before = await findPartnerById(id);
    if (!before) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

    // Status moves through its own store function, which owns the transition
    // rules — it is never just another patchable field.
    if (typeof body.status === 'string') {
      if (!STATUSES.includes(body.status as PartnerStatus)) {
        return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
      }
      const updated = await setPartnerStatus(id, body.status as PartnerStatus, viewer.userId);
      void logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'partner',
        entityId: id,
        action: `Partner ${body.status}: ${before.company_name} (${before.partner_code})`,
        previousStatus: before.status,
        newStatus: body.status,
        remarks: typeof body.reason === 'string' ? body.reason : '',
        ip: getClientIp(request)
      });
      return NextResponse.json(updated);
    }

    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

    const updated = await updatePartner(
      id,
      {
        company_name: str(body.company_name),
        contact_person: str(body.contact_person),
        email: str(body.email),
        phone: str(body.phone),
        address: str(body.address),
        city: str(body.city),
        state: str(body.state),
        country: str(body.country),
        gst_number: str(body.gst_number),
        departments: list(body.departments),
        product_categories: list(body.product_categories),
        territory: list(body.territory),
        relationship_manager_id: body.relationship_manager_id === undefined ? undefined : str(body.relationship_manager_id) || null,
        notes: str(body.notes)
      },
      viewer.userId
    );

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: id,
      action: `Partner updated: ${updated?.company_name ?? before.company_name}`,
      previousStatus: before.status,
      newStatus: updated?.status ?? before.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    // setPartnerStatus throws on an illegal transition — that is a client
    // error (the UI offered an action it shouldn't have), not a 500.
    if (error instanceof Error && /cannot be moved to/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return apiErrorResponse(error);
  }
}
