import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManagePartners } from '@/lib/partnerAccess';
import { createPartner, listPartners } from '@/lib/partnerStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Internal partner management. Sits under /api/admin/* so proxy.ts's existing
// isPrivileged gate applies on top of canManagePartners below — note that
// gate alone is NOT sufficient here (every 'manager' account passes it),
// which is why the finer check runs too.
//
// getViewerContext without allowPartner: a partner reaching this route would
// see every other partner in the system. It is refused twice over — by
// proxy.ts (partners never leave /partner/**) and by the deny-by-default
// here — on purpose.

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json(await listPartners());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canManagePartners(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const companyName = typeof body.company_name === 'string' ? body.company_name.trim() : '';
  if (!companyName) return NextResponse.json({ error: 'Company name is required' }, { status: 400 });

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  try {
    const partner = await createPartner(
      {
        company_name: companyName,
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
        relationship_manager_id: str(body.relationship_manager_id) || null,
        notes: str(body.notes)
      },
      viewer.userId
    );

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: partner.id,
      action: `Partner created: ${partner.company_name} (${partner.partner_code})`,
      previousStatus: '',
      newStatus: partner.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(partner, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
