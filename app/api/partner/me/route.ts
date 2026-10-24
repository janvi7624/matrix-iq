import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { apiErrorResponse } from '@/lib/apiError';

// The portal's "who am I" endpoint, and the reference shape every other
// /api/partner/** route follows: resolve through getPartnerViewer (which
// refuses internal accounts and enforces the partner's live status), then
// return only what a partner may see about themselves.
//
// Note what is NOT returned: relationship_manager_id, notes, and the
// internal row ids. The RM's NAME is partner-facing (they need to know who
// their contact is); the internal user id behind it is not.
export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { partner } = viewer;
    return NextResponse.json({
      user: { username: viewer.username, name: viewer.name, role: viewer.role },
      partner: {
        partner_code: partner.partner_code,
        company_name: partner.company_name,
        contact_person: partner.contact_person,
        email: partner.email,
        phone: partner.phone,
        address: partner.address,
        city: partner.city,
        state: partner.state,
        country: partner.country,
        gst_number: partner.gst_number,
        status: partner.status,
        departments: partner.departments,
        product_categories: partner.product_categories,
        territory: partner.territory,
        relationship_manager_name: partner.relationship_manager_name
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
