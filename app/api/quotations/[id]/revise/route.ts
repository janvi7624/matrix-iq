import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { createQuotationRevision, findQuotationById } from '@/lib/quotationStore';
import { resolvePreparedBy } from '@/lib/quotationOnBehalf';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { canViewQuotation } from '@/lib/quotationAccess';
import { isUuid } from '@/lib/db';
import { canAccessProject, findProjectById } from '@/lib/projectStore';
import { canActOnBehalf } from '@/lib/quotationOnBehalfAccess';

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
    if (root && !(await canViewQuotation(viewer.username, root))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Same linked-project check as POST /api/quotations, but only when the
    // revision actually CHANGES the link — keeping the root's own project
    // needs no re-check. A blank/omitted projectId keeps the root's link
    // (createQuotationRevision's `??` fallback) rather than writing '' into
    // the uuid column.
    const currentProjectId = (root || source).project_id;
    const requestedProjectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    if (requestedProjectId && requestedProjectId !== currentProjectId) {
      if (!isUuid(requestedProjectId)) return NextResponse.json({ error: 'Invalid project id' }, { status: 400 });
      const project = await findProjectById(requestedProjectId);
      if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      // Same exemption for the on-behalf team as on create (app/api/quotations/route.ts).
      if (!viewer.isPrivileged && !canActOnBehalf(viewer.username) && !(await canAccessProject(viewer.username, project))) {
        return NextResponse.json({ error: "You can't link a quotation to this project" }, { status: 403 });
      }
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
      const resolved = await resolvePreparedBy(viewer.username, requestedPreparedByUserId, { projectId: requestedProjectId || currentProjectId });
      if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
      preparedByOverride = {
        preparedByUserId: resolved.value.userId,
        preparedBy: resolved.value.name,
        preparedByPhone: resolved.value.phone,
        preparedByEmail: resolved.value.email
      };
    }

    // The prepared-by fields are never taken from the request as free text:
    // either they're inherited from the root (unchanged — createQuotation-
    // Revision falls back to the root's) or resolved server-side above. Now
    // that anyone who can open the linked project may revise, a crafted body
    // must not be able to put arbitrary contact details on a client document
    // issued in someone else's name.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { preparedBy: _pb, preparedByPhone: _pbPhone, preparedByEmail: _pbEmail, preparedByUserId: _pbId, ...safeBody } = body;
    const revision = await createQuotationRevision(id, { ...safeBody, projectId: requestedProjectId || undefined, ...preparedByOverride, createdBy: viewer.username }, reason);
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
