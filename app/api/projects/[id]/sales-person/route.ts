import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { assignSalesPerson, SalesOwnerError } from '@/lib/projectSalesOwner';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// POST — make someone from Sales the project's sales person, i.e. its owner
// (created_by + sales_person), so it moves into their pipeline. Admins, or the
// technical person who created the project; see lib/projectSalesOwner.ts for
// the rules. Unlike "Assign Team" (a label-only correction), this transfers
// ownership, and the sales person is notified.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const salesPersonId = typeof body?.salesPersonId === 'string' ? body.salesPersonId.trim() : '';
  if (!salesPersonId) return NextResponse.json({ error: 'Pick a sales person' }, { status: 400 });

  try {
    const project = await assignSalesPerson(id, salesPersonId, viewer, getClientIp(request));
    return NextResponse.json({ project });
  } catch (error) {
    if (error instanceof SalesOwnerError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
