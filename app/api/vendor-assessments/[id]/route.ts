import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { getClientIp } from '@/lib/requestIp';
import { logAudit } from '@/lib/auditLogStore';
import { isUuid } from '@/lib/db';
import {
  VendorAssessmentsUnavailableError,
  deleteVendorAssessment,
  findVendorAssessment,
  updateVendorAssessment,
  validateVendorInput
} from '@/lib/vendorAssessmentStore';
import { canEditVendorRecord, notifyVendorStage } from '@/lib/vendorAssessmentAccess';

// Edit (restarts approval at VP/GM Sales) and delete (privileged only).

function unavailable(error: unknown) {
  return error instanceof VendorAssessmentsUnavailableError ? NextResponse.json({ error: error.message }, { status: 503 }) : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const existing = await findVendorAssessment(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditVendorRecord(viewer, existing)) return NextResponse.json({ error: 'Only the creator can edit this, until it is approved.' }, { status: 403 });
    const validated = validateVendorInput(await request.json().catch(() => null));
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const record = await updateVendorAssessment(id, validated.value);
    if (record) await notifyVendorStage('sales', record);
    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'vendor_assessment',
      entityId: id,
      action: `Vendor assessment edited: ${validated.value.company_name} (approval restarted)`,
      previousStatus: existing.status,
      newStatus: 'pending',
      ip: getClientIp(request)
    });
    return NextResponse.json(record);
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const existing = await findVendorAssessment(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ownPending = existing.created_by === viewer.userId && existing.status === 'pending' && !existing.approval_trail.length;
    if (!viewer.isPrivileged && !ownPending) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await deleteVendorAssessment(id);
    void logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'vendor_assessment',
      entityId: id,
      action: `Vendor assessment deleted: ${existing.company_name}`,
      previousStatus: existing.status,
      newStatus: 'deleted',
      ip: getClientIp(request)
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}
