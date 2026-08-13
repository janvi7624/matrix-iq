import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { deliveryChallanStore, nextDcNumber } from '@/lib/deliveryChallanStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { findProjectById } from '@/lib/projectStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';
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
    // Same reasoning as demo-schedule's GET — a DC is created by whichever
    // Back Office user generated it, but the whole team needs to see the
    // shared dispatch/return queue, not just DCs they personally made.
    const canSeeQueue = viewer.isPrivileged || viewer.role === 'backoffice';
    const records = await deliveryChallanStore.list(viewer.username, canSeeQueue);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function toManualItems(value: unknown): DcLineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      product: typeof v.product === 'string' ? v.product.trim() : '',
      serialNumber: typeof v.serialNumber === 'string' ? v.serialNumber.trim() : '',
      quantity: Math.max(1, Number(v.quantity) || 1),
      price: Math.max(0, Number(v.price) || 0)
    }))
    .filter((v) => v.product);
}

// Back Office (or admin/manager/superadmin as a stand-in) either turns an
// approved demo request into a Delivery Challan — the "Approved request
// automatically goes to Back Office" handoff from the spec — or creates one
// manually with no demo/approval chain behind it at all (e.g. a walk-in
// dispatch). Both paths converge on the same deliveryChallanStore.create().
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (viewer.role !== 'backoffice' && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Forbidden — Back Office only' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  const demoId = typeof body.demoId === 'string' ? body.demoId.trim() : '';

  try {
    const issuer = await db.User.findOne({ where: { username: viewer.username } as never });
    const issuedByPhone = (issuer?.get('phone') as string | null) || '';
    const dcNumber = await nextDcNumber();
    const now = new Date().toISOString();

    if (demoId) {
      const demos = await demoScheduleStore.list(viewer.username, true);
      const demo = demos.find((d) => d.id === demoId);
      if (!demo) return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });
      if (demo.status !== 'pending_backoffice') {
        return NextResponse.json({ error: 'This demo request has not cleared manager approval yet' }, { status: 400 });
      }

      const project = demo.project_id ? await findProjectById(demo.project_id) : undefined;
      const items: DcLineItem[] = demo.products_required.map((p) => ({ product: p.product, serialNumber: '', quantity: p.quantity, price: 0 }));
      const record: DeliveryChallanRecord = {
        id: `${Date.now()}`,
        dc_number: dcNumber,
        created_at: now,
        created_by: viewer.username,
        project_id: demo.project_id,
        demo_id: demo.id,
        client_name: demo.client_name,
        client_address: project?.address || '',
        client_phone: project?.phone || '',
        items,
        issued_by: viewer.username,
        issued_by_phone: issuedByPhone,
        issued_date: now.slice(0, 10),
        expected_return_date: typeof body.expectedReturnDate === 'string' ? body.expectedReturnDate : '',
        // The name on the DC is the requester (sales rep who owns the deal,
        // or whoever submitted the request if no rep was set) — not the
        // technical person who ran the demo. Displayed as "Requested By".
        assigned_engineer: demo.assigned_rep || demo.created_by,
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
    }

    // Manual path — no demo, no approval chain. Client details are free
    // text unless a Project was optionally picked to prefill from.
    const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
    if (!clientName) return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
    const items = toManualItems(body.items);
    if (!items.length) return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });

    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const project = projectId ? await findProjectById(projectId) : undefined;
    if (projectId && !project) return NextResponse.json({ error: 'Project not found' }, { status: 400 });

    const record: DeliveryChallanRecord = {
      id: `${Date.now()}`,
      dc_number: dcNumber,
      created_at: now,
      created_by: viewer.username,
      project_id: projectId,
      demo_id: '',
      client_name: clientName,
      client_address: typeof body.clientAddress === 'string' ? body.clientAddress.trim() : '',
      client_phone: typeof body.clientPhone === 'string' ? body.clientPhone.trim() : '',
      items,
      issued_by: viewer.username,
      issued_by_phone: issuedByPhone,
      issued_date: now.slice(0, 10),
      expected_return_date: typeof body.expectedReturnDate === 'string' ? body.expectedReturnDate : '',
      assigned_engineer: typeof body.assignedEngineer === 'string' ? body.assignedEngineer.trim() : '',
      status: 'prepared',
      material_return: emptyChecklist(),
      updated_at: now
    };

    const created = await deliveryChallanStore.create(record);

    if (projectId) {
      await appendProjectTimeline(projectId, { by: viewer.username, stage: 'demo', label: `Delivery Challan ${dcNumber} generated (manual)` });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'delivery_challan',
      entityId: created.id,
      action: `Generated DC ${dcNumber} (manual)`,
      previousStatus: '',
      newStatus: 'prepared',
      ip: getClientIp(request)
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
