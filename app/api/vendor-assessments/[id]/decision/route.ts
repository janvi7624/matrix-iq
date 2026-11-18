import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { getClientIp } from '@/lib/requestIp';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { isUuid, db } from '@/lib/db';
import { VendorAssessmentError, VendorAssessmentsUnavailableError, decideVendorAssessment, findVendorAssessment } from '@/lib/vendorAssessmentStore';
import { notifyVendorStage, vendorViewerScope } from '@/lib/vendorAssessmentAccess';
import { VENDOR_STAGE_LABEL, isVendorStage } from '@/lib/vendorAssessmentShared';

// One approver's decision on the current step: VP/GM Sales -> Finance -> MD.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { decision?: string; remarks?: string } | null;
  const decision = body?.decision === 'approved' || body?.decision === 'rejected' ? body.decision : null;
  if (!decision) return NextResponse.json({ error: 'Choose approve or reject.' }, { status: 400 });

  try {
    const existing = await findVendorAssessment(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const stage = existing.approval_stage;
    if (!isVendorStage(stage)) return NextResponse.json({ error: 'Nothing is awaiting approval here.' }, { status: 409 });
    const { myStages } = await vendorViewerScope(viewer);
    if (!myStages.includes(stage)) {
      return NextResponse.json({ error: `Only the ${VENDOR_STAGE_LABEL[stage]} approver can decide this step.` }, { status: 403 });
    }

    const { record, next } = await decideVendorAssessment({
      id,
      stage,
      decision,
      by: { id: viewer.userId, name: viewer.name || viewer.username },
      remarks: typeof body?.remarks === 'string' ? body.remarks : ''
    });

    if (next) await notifyVendorStage(next, record);

    // Tell the creator and initiators the outcome / progress.
    const ids = [record.created_by, ...record.initiated_by_ids].filter((x): x is string => !!x && x !== viewer.userId);
    if (ids.length) {
      const users = await db.User.findAll({ where: { id: [...new Set(ids)] } as never, attributes: ['username'] });
      const title =
        decision === 'rejected'
          ? `Vendor assessment rejected by ${VENDOR_STAGE_LABEL[stage]}`
          : next
            ? `Vendor assessment approved by ${VENDOR_STAGE_LABEL[stage]}`
            : 'Vendor assessment fully approved';
      await notifyUsers(users.map((u) => u.get('username') as string), {
        title,
        body: `${record.company_name}${decision === 'rejected' && record.approval_trail.at(-1)?.remarks ? ` — ${record.approval_trail.at(-1)!.remarks}` : next ? ` — now with ${VENDOR_STAGE_LABEL[next]}.` : ''}`,
        type: 'vendor_assessment_decided',
        entityType: 'vendor_assessment',
        entityId: id
      });
    }

    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'vendor_assessment',
      entityId: id,
      action: `Vendor assessment ${decision} at ${VENDOR_STAGE_LABEL[stage]}: ${record.company_name}`,
      previousStatus: existing.status,
      newStatus: record.status,
      remarks: typeof body?.remarks === 'string' ? body.remarks.slice(0, 500) : '',
      ip: getClientIp(request)
    });
    return NextResponse.json(record);
  } catch (error) {
    if (error instanceof VendorAssessmentError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof VendorAssessmentsUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    return apiErrorResponse(error);
  }
}
