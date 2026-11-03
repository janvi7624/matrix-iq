import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { updatePartner } from '@/lib/partnerStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// The partner's own company profile: PAN number, bank details and website —
// but only when their account's financial_details_scope is 'partner'. For
// 'internal' (the default), this stays admin/RM-only on PartnerDetailView,
// and this route refuses writes even if called directly.
export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { partner } = viewer;
  return NextResponse.json({
    company_name: partner.company_name,
    partner_code: partner.partner_code,
    financial_details_scope: partner.financial_details_scope,
    website: partner.website,
    pan_number: partner.pan_number,
    bank_account_name: partner.bank_account_name,
    bank_account_number: partner.bank_account_number,
    bank_ifsc_code: partner.bank_ifsc_code,
    bank_name: partner.bank_name
  });
}

export async function PUT(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (viewer.partner.financial_details_scope !== 'partner') {
    return NextResponse.json({ error: 'Your account manager maintains these details — contact them for changes.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  try {
    const updated = await updatePartner(
      viewer.partnerId,
      {
        website: str(body.website),
        pan_number: str(body.pan_number).toUpperCase(),
        bank_account_name: str(body.bank_account_name),
        bank_account_number: str(body.bank_account_number),
        bank_ifsc_code: str(body.bank_ifsc_code).toUpperCase(),
        bank_name: str(body.bank_name)
        // financial_details_scope deliberately not accepted here — a partner
        // cannot grant itself this, or revoke it, only an admin/RM can.
      },
      viewer.userId
    );

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'partner',
      entityId: viewer.partnerId,
      action: `Partner updated its own company profile: ${viewer.partner.company_name}`,
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });

    return NextResponse.json({
      website: updated?.website ?? '',
      pan_number: updated?.pan_number ?? '',
      bank_account_name: updated?.bank_account_name ?? '',
      bank_account_number: updated?.bank_account_number ?? '',
      bank_ifsc_code: updated?.bank_ifsc_code ?? '',
      bank_name: updated?.bank_name ?? ''
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
