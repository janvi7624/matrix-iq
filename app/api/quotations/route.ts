import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createQuotation } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Listing/searching quotations requires admin login — see /api/admin/quotations
// (org-wide) and /api/quotations/mine (sales, own-only). This route only
// accepts POST, used by the calculator to log a new quotation.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // Same minimum-identity rule as project creation — without this, the API
  // (unlike the calculator wizard, which always fills these) could log a
  // completely blank ₹0 quotation with a real sequential number.
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const clientCompany = typeof body.clientCompany === 'string' ? body.clientCompany.trim() : '';
  if (!clientName && !clientCompany) {
    return NextResponse.json({ error: 'Client name or company is required' }, { status: 400 });
  }

  try {
    const record = await createQuotation({ ...body, createdBy: session.username });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
