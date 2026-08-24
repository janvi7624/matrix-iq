import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { deliveryChallanStore, findDeliveryChallanById } from '@/lib/deliveryChallanStore';
import { demoScheduleStore } from '@/lib/demoScheduleStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { sendFieldOpsLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';
import { BackOfficeRemarkTag, DcLineItem, DeliveryChallanRecord, DemoRequestStatus, MaterialReturnChecklist } from '@/lib/types';
import { canAccessOwnedRecord } from '@/lib/departmentScope';

const VALID_REMARK_TAGS: BackOfficeRemarkTag[] = [
  'good_condition',
  'minor_scratch',
  'major_damage',
  'adapter_missing',
  'power_cable_missing',
  'wrong_serial_number',
  'packing_damaged',
  'custom'
];

function toItems(value: unknown): DcLineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map((v) => ({
      product: typeof v.product === 'string' ? v.product.trim() : '',
      hsnCode: typeof v.hsnCode === 'string' ? v.hsnCode.trim() : '',
      serialNumber: typeof v.serialNumber === 'string' ? v.serialNumber.trim() : '',
      quantity: Math.max(1, Number(v.quantity) || 1),
      // Price is Back Office-only — this whole route is already gated to
      // backoffice/privileged (see the PATCH handler below), so no
      // additional per-field check is needed here.
      price: Math.max(0, Number(v.price) || 0)
    }))
    .filter((v) => v.product);
}

async function requireDc(viewer: { username: string; isPrivileged: boolean }, id: string) {
  const dc = await findDeliveryChallanById(id);
  if (!dc) return { error: NextResponse.json({ error: 'Delivery Challan not found' }, { status: 404 }) } as const;
  if (!(await canAccessOwnedRecord(viewer.username, dc.created_by))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  return { dc } as const;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const result = await requireDc(viewer, id);
    if ('error' in result) return result.error;
    return NextResponse.json(result.dc);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Strictly Back Office (or Admin/Super Admin as the org's ultimate
  // override) — Manager is deliberately excluded here.
  if (viewer.role !== 'backoffice' && viewer.role !== 'admin' && viewer.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — Back Office only' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const dc = await findDeliveryChallanById(id);
    if (!dc) return NextResponse.json({ error: 'Delivery Challan not found' }, { status: 404 });

    const patch: Partial<DeliveryChallanRecord> = { updated_at: new Date().toISOString() };
    let demoStatus: DemoRequestStatus | null = null;
    let action = '';
    const previousStatus = dc.status;

    if (body.action === 'updateItems') {
      if (dc.status !== 'prepared') return NextResponse.json({ error: 'Items can only be edited before dispatch' }, { status: 400 });
      patch.items = toItems(body.items);
      if (typeof body.assignedEngineer === 'string') patch.assigned_engineer = body.assignedEngineer.trim();
      if (typeof body.expectedReturnDate === 'string') patch.expected_return_date = body.expectedReturnDate;
      action = 'Updated DC items';
    } else if (body.action === 'dispatch') {
      if (dc.status !== 'prepared') return NextResponse.json({ error: 'This DC has already been dispatched' }, { status: 400 });
      patch.status = 'dispatched';
      demoStatus = 'material_dispatched';
      action = 'Dispatched materials';
    } else if (body.action === 'verifyReturn') {
      if (dc.status !== 'dispatched') return NextResponse.json({ error: 'This DC is not out for a demo yet' }, { status: 400 });
      const checklist: MaterialReturnChecklist = {
        returned: !!body.returned,
        condition: body.condition === 'good' || body.condition === 'minor_damage' || body.condition === 'major_damage' ? body.condition : '',
        missing: !!body.missing,
        damaged: !!body.damaged,
        accessories: {
          powerCable: !!body.accessories?.powerCable,
          remote: !!body.accessories?.remote,
          adapter: !!body.accessories?.adapter,
          stand: !!body.accessories?.stand,
          packing: !!body.accessories?.packing
        },
        serialNumberVerified: !!body.serialNumberVerified,
        remarkTags: Array.isArray(body.remarkTags) ? body.remarkTags.filter((t: unknown): t is BackOfficeRemarkTag => VALID_REMARK_TAGS.includes(t as BackOfficeRemarkTag)) : [],
        remarks: typeof body.remarks === 'string' ? body.remarks.trim() : ''
      };
      patch.material_return = checklist;
      patch.status = 'returned';
      demoStatus = 'material_returned';
      action = 'Verified returned material';
    } else if (body.action === 'close') {
      if (dc.status !== 'returned') return NextResponse.json({ error: 'Materials must be verified as returned before closing' }, { status: 400 });
      patch.status = 'closed';
      demoStatus = 'dc_closed';
      action = 'Closed DC';
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    const updated = await deliveryChallanStore.update(id, patch);

    if (demoStatus && dc.demo_id) {
      await demoScheduleStore.update(dc.demo_id, { status: demoStatus });
    }
    if (dc.project_id) {
      const remarksNote = patch.material_return
        ? `${patch.material_return.remarkTags.join(', ')}${patch.material_return.remarks ? ` — ${patch.material_return.remarks}` : ''}`
        : '';
      await appendProjectTimeline(dc.project_id, { by: viewer.username, stage: 'demo', label: `DC ${dc.dc_number}: ${action}`, remarks: remarksNote });
    }
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'delivery_challan',
      entityId: id,
      action,
      previousStatus,
      newStatus: patch.status || previousStatus,
      remarks: patch.material_return ? patch.material_return.remarks : '',
      ip: getClientIp(request)
    });

    // assigned_engineer is free text on a manually-created DC, but a real
    // username for demo-linked ones (see app/api/delivery-challans/route.ts) —
    // findUserByUsername no-ops harmlessly either way.
    if ((body.action === 'dispatch' || body.action === 'close') && dc.assigned_engineer && dc.assigned_engineer !== viewer.username) {
      const recipient = await findUserByUsername(dc.assigned_engineer);
      if (recipient?.email) {
        void sendFieldOpsLifecycleEmail({
          name: recipient.name,
          email: recipient.email,
          urlPath: '/backoffice',
          event: body.action === 'dispatch' ? 'dc_dispatched' : 'dc_closed',
          subjectLabel: dc.dc_number
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Strictly Back Office (or Admin/Super Admin) — Manager excluded, matching
  // POST/PATCH above.
  const canDelete = viewer.role === 'backoffice' || viewer.role === 'admin' || viewer.role === 'superadmin';
  if (!canDelete) return NextResponse.json({ error: 'Forbidden — Back Office only' }, { status: 403 });

  const { id } = await params;
  try {
    const dc = await findDeliveryChallanById(id);
    if (!dc) return NextResponse.json({ error: 'Delivery Challan not found' }, { status: 404 });
    if (dc.status !== 'prepared') {
      return NextResponse.json({ error: 'Only a not-yet-dispatched DC can be deleted' }, { status: 400 });
    }
    const deleted = await deliveryChallanStore.remove(id, viewer.username, canDelete);
    if (!deleted) return NextResponse.json({ error: 'Delivery Challan not found' }, { status: 404 });

    // Deleting a demo-linked DC must hand the demo back to the "awaiting a
    // Delivery Challan" queue (pending_backoffice) — otherwise it's stuck at
    // dc_generated forever with no DC and no way to generate a new one.
    if (dc.demo_id) {
      await demoScheduleStore.update(dc.demo_id, { status: 'pending_backoffice' });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
