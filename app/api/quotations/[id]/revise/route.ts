import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { createQuotationRevision, findQuotationById } from '@/lib/quotationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { canAccessOwnedRecord } from '@/lib/departmentScope';

// Creates a new, independent quotation version (QT-00123 -> QT-00123.01) —
// the source quotation is never modified. Same body shape the calculator
// already posts to /api/quotations, plus a required "reason".
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A reason for this revision is required' }, { status: 400 });

  try {
    const source = await findQuotationById(id);
    if (!source) return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    const rootId = source.original_quotation_id || source.id;
    const root = await findQuotationById(rootId);
    if (root && !(await canAccessOwnedRecord(viewer.username, root.created_by))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const revision = await createQuotationRevision(id, { ...body, createdBy: viewer.username }, reason);
    if (!revision) return NextResponse.json({ error: 'Could not create a revision' }, { status: 400 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'quotation',
      entityId: revision.id,
      action: `Quotation revised: ${root?.quotation_number || id} -> ${revision.quotation_number}`,
      previousStatus: root?.quotation_number || '',
      newStatus: revision.quotation_number,
      ip: getClientIp(request)
    });

    return NextResponse.json(revision, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
