import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { deliveryChallanStore, nextDcNumber } from '@/lib/deliveryChallanStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { DcLineItem, DeliveryChallanRecord } from '@/lib/types';

function emptyChecklist() {
  return {
    returned: false,
    condition: '' as const,
    missing: false,
    damaged: false,
    accessories: { powerCable: false, remote: false, adapter: false, stand: false, packing: false },
    serialNumberVerified: false,
    remarkTags: [],
    remarks: ''
  };
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await deliveryChallanStore.list(viewer.username, viewer.isPrivileged);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Back Office (or admin/manager/superadmin as a stand-in) turns an
// approved demo request into a Delivery Challan — this is the
// "Approved request automatically goes to Back Office" handoff from the spec.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (viewer.role !== 'backoffice' && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden — Back Office only' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const demoId = typeof body?.demoId === 'string' ? body.demoId.trim() : '';
  if (!demoId) return NextResponse.json({ error: 'Demo request is required' }, { status: 400 });

  try {
    const demos = await demoScheduleStore.list(viewer.username, true);
    const demo = demos.find((d) => d.id === demoId);
    if (!demo) return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });
    if (demo.status !== 'pending_backoffice') {
      return NextResponse.json({ error: 'This demo request has not cleared manager approval yet' }, { status: 400 });
    }

    const items: DcLineItem[] = demo.products_required.map((p) => ({ product: p.product, serialNumber: '', quantity: p.quantity }));
    const dcNumber = await nextDcNumber();
    const now = new Date().toISOString();
    const record: DeliveryChallanRecord = {
      id: `${Date.now()}`,
      dc_number: dcNumber,
      created_at: now,
      created_by: viewer.username,
      project_id: demo.project_id,
      demo_id: demo.id,
      client_name: demo.client_name,
      items,
      issued_by: viewer.username,
      issued_date: now.slice(0, 10),
      expected_return_date: typeof body.expectedReturnDate === 'string' ? body.expectedReturnDate : '',
      assigned_engineer: demo.manager_approval.reassigned_engineer || demo.assigned_technical_person,
      status: 'prepared',
      material_return: emptyChecklist(),
      updated_at: now
    };

    const created = await deliveryChallanStore.create(record);
    await demoScheduleStore.update(demo.id, { status: 'dc_generated' });

    if (demo.project_id) {
      await appendProjectTimeline(demo.project_id, { by: viewer.username, stage: 'demo', label: `Delivery Challan ${dcNumber} generated` });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'delivery_challan',
      entityId: created.id,
      action: `Generated DC ${dcNumber}`,
      previousStatus: '',
      newStatus: 'prepared',
      ip: getClientIp(request)
    });
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'demo',
      entityId: demo.id,
      action: `DC ${dcNumber} generated`,
      previousStatus: 'pending_backoffice',
      newStatus: 'dc_generated',
      ip: getClientIp(request)
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
