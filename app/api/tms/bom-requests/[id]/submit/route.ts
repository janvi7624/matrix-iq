import { NextRequest, NextResponse } from 'next/server';
import { findTechnicalManagers, getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';

// draft -> submitted, and notifies every Technical Manager.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const existing = await tmsBomRequestStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Only a draft request can be submitted' }, { status: 400 });
    }

    const updated = await tmsBomRequestStore.submit(id);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_bom_request',
      entityId: id,
      action: 'BOM request submitted',
      previousStatus: 'draft',
      newStatus: 'submitted',
      remarks: existing.item_name,
      ip: getClientIp(request)
    });

    const managers = await findTechnicalManagers();
    const targets = managers.map((m) => m.username).filter((u) => u && u !== viewer.username);
    if (targets.length) {
      await notifyUsers(targets, {
        title: 'New BOM request awaiting review',
        body: `${viewer.username} submitted "${existing.item_name}" for ${existing.project_name}`,
        type: 'tms_bom_request_submitted',
        entityType: 'tms_bom_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
