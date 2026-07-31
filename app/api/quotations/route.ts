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

  try {
    const record = await createQuotation({ ...body, createdBy: session.username });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
