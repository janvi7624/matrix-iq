import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { createQuotationRevision, findQuotationById } from '@/lib/quotationStore';
import { resolvePreparedBy } from '@/lib/quotationOnBehalf';
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

    // Only gate/resolve prepared-by when the request is actually CHANGING
    // who it's prepared by (a real delegation) — a revision that leaves it
    // alone must keep inheriting the root's original prepared_by/_phone/
    // _email/_user_id (createQuotationRevision's own `??` fallback below
    // already does that). Resolving unconditionally here — the way POST
    // /api/quotations does — would silently reset every revision's prepared
    // by back to the REVISER's own identity even when nothing about who
    // it's for was meant to change, since the calculator always includes
    // these fields in its payload.
    const requestedPreparedByUserId = typeof body.preparedByUserId === 'string' ? body.preparedByUserId.trim() : undefined;
    const rootPreparedByUserId = (root?.prepared_by_user_id || source.prepared_by_user_id) || undefined;
    const isChangingPreparedBy = requestedPreparedByUserId !== undefined && requestedPreparedByUserId !== rootPreparedByUserId;

    let preparedByOverride: Partial<{ preparedByUserId: string; preparedBy: string; preparedByPhone: string; preparedByEmail: string }> = {};
    if (isChangingPreparedBy) {
      const resolved = await resolvePreparedBy(viewer.username, requestedPreparedByUserId);
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      preparedByOverride = {
        preparedByUserId: resolved.value.userId,
        preparedBy: resolved.value.name,
        preparedByPhone: resolved.value.phone,
        preparedByEmail: resolved.value.email
      };
    }

    const revision = await createQuotationRevision(id, { ...body, ...preparedByOverride, createdBy: viewer.username }, reason);
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
