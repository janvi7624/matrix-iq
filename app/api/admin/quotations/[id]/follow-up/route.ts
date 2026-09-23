import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { findQuotationById, logQuotationFollowUp } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canManageQuotation } from '@/lib/quotationAccess';

// Auth + admin-role enforcement happens in proxy.ts (matcher: /api/admin/:path*)
// — that only confirms the viewer is privileged (e.g. any Manager), not that
// this particular quotation is in their department, so that's checked here
// too, same as the non-admin /api/quotations/[id]/follow-up route.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === 'string' ? body.note.trim() : '';

  try {
    const existing = await findQuotationById(id);
    if (!existing) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    // Same rule as the rep-facing follow-up route — includes a quotation
    // prepared for (or on a project owned by) someone in this viewer's scope.
    if (!(await canManageQuotation(session.username, existing))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await logQuotationFollowUp(id, session.username, note);
    if (!updated) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
