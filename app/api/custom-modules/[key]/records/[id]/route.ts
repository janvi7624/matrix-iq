import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getModuleForViewer } from '@/lib/customModuleStore';
import { deleteCustomModuleRecord, findCustomModuleRecordById, updateCustomModuleRecord } from '@/lib/customModuleRecordStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const { key, id } = await params;
    const module_ = await getModuleForViewer(key, viewer);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });

    const existing = await findCustomModuleRecordById(key, id);
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const moduleKey = `custom:${key}`;
    const isApprover = module_.requiresApproval && module_.approverRole && viewer.role === module_.approverRole;
    const canEdit = existing.created_by === viewer.username || isApprover || (await isModuleActionAllowed(viewer, moduleKey, 'edit'));
    if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (body.action === 'approve' || body.action === 'reject') {
      const allowed = isApprover || (await isModuleActionAllowed(viewer, moduleKey, body.action === 'approve' ? 'approve' : 'reject'));
      if (!allowed) return NextResponse.json({ error: 'Forbidden — not the assigned approver' }, { status: 403 });
      const nextStatus = body.action === 'approve' ? 'approved' : 'rejected';
      const updated = await updateCustomModuleRecord(key, id, { status: nextStatus });
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'custom_module',
        entityId: `${key}:${id}`,
        action: `Custom module "${module_.name}" record ${nextStatus}`,
        previousStatus: existing.status,
        newStatus: nextStatus,
        ip: getClientIp(request)
      });
      return NextResponse.json(updated);
    }

    const values = (body.values && typeof body.values === 'object') ? { ...existing.values, ...body.values } : undefined;
    const attachments = Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : undefined;
    const updated = await updateCustomModuleRecord(key, id, { values, attachments });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ key: string; id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { key, id } = await params;
    const module_ = await getModuleForViewer(key, viewer);
    if (!module_) return NextResponse.json({ error: 'Module not found' }, { status: 404 });
    if (!(await isModuleActionAllowed(viewer, `custom:${key}`, 'delete'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const deleted = await deleteCustomModuleRecord(key, id);
    if (!deleted) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
