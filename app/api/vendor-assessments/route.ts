import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { getClientIp } from '@/lib/requestIp';
import { logAudit } from '@/lib/auditLogStore';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { VendorAssessmentsUnavailableError, createVendorAssessment, listVendorAssessments, validateVendorInput } from '@/lib/vendorAssessmentStore';
import { canEditVendorRecord, canSeeVendorRecord, notifyVendorStage, vendorViewerScope } from '@/lib/vendorAssessmentAccess';
import { VENDOR_APPROVAL_STAGES } from '@/lib/vendorAssessmentShared';

// Vendor Assessment — list + create.

function unavailable(error: unknown) {
  return error instanceof VendorAssessmentsUnavailableError ? NextResponse.json({ error: error.message }, { status: 503 }) : null;
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('vendor-assessment', { role: viewer.role, isPrivileged: viewer.isPrivileged }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { approvers, myStages, seesAll } = await vendorViewerScope(viewer);
    const rows = (await listVendorAssessments())
      .filter((r) => canSeeVendorRecord(viewer, seesAll, r))
      .map((r) => ({
        ...r,
        can_edit: canEditVendorRecord(viewer, r),
        can_decide: !!r.approval_stage && myStages.includes(r.approval_stage)
      }));
    const approverNames = Object.fromEntries(VENDOR_APPROVAL_STAGES.map((s) => [s, approvers[s].map((a) => a.name)]));
    return NextResponse.json({ rows, approverNames, isPrivileged: viewer.isPrivileged });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('vendor-assessment', { role: viewer.role, isPrivileged: viewer.isPrivileged }))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const validated = validateVendorInput(await request.json().catch(() => null));
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  try {
    const record = await createVendorAssessment(validated.value, { id: viewer.userId, name: viewer.name || viewer.username });
    await notifyVendorStage('sales', record);
    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'vendor_assessment',
      entityId: record.id,
      action: `Vendor assessment created: ${record.company_name}`,
      previousStatus: '',
      newStatus: 'pending',
      ip: getClientIp(request)
    });
    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}
