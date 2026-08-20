import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsProcurementStore } from '@/lib/tmsProcurementStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyUsers } from '@/lib/notificationStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { findUserById } from '@/lib/userStore';
import { TmsDeliveryStatus, TmsProcurementRecord, TmsPurchaseStatus } from '@/lib/types';

const VALID_PURCHASE_STATUS: TmsPurchaseStatus[] = ['requested', 'quotation_required', 'quotation_received', 'approval_pending', 'approved', 'po_created', 'ordered', 'cancelled'];
const VALID_DELIVERY_STATUS: TmsDeliveryStatus[] = ['pending', 'partially_received', 'received', 'cancelled'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-procurement', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const record = await tmsProcurementStore.findById(id);
    if (!record) return NextResponse.json({ error: 'Procurement record not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-procurement', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await tmsProcurementStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Procurement record not found' }, { status: 404 });

    if (body.action === 'addDocument') {
      const urls = toStringArray(body.urls);
      if (!urls.length) return NextResponse.json({ error: 'No document URLs provided' }, { status: 400 });
      const updated = await tmsProcurementStore.update(id, { documents: [...existing.documents, ...urls], updated_at: new Date().toISOString() });
      return NextResponse.json(updated);
    }

    const patch: Partial<TmsProcurementRecord> = { updated_at: new Date().toISOString() };
    if (typeof body.vendor === 'string') patch.vendor = body.vendor.trim();
    if (typeof body.partNumber === 'string') patch.part_number = body.partNumber.trim();
    if (typeof body.quantity === 'number') patch.quantity = body.quantity;
    if (typeof body.estimatedCost === 'number') patch.estimated_cost = body.estimatedCost;
    if (typeof body.quotedCost === 'number') patch.quoted_cost = body.quotedCost;
    if (typeof body.finalCost === 'number') patch.final_cost = body.finalCost;
    if (typeof body.requiredDate === 'string') patch.required_date = body.requiredDate;
    if (typeof body.expectedDeliveryDate === 'string') patch.expected_delivery_date = body.expectedDeliveryDate;
    if (typeof body.actualDeliveryDate === 'string') patch.actual_delivery_date = body.actualDeliveryDate;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();

    let purchaseStatusChanged = false;
    if (VALID_PURCHASE_STATUS.includes(body.purchaseStatus) && body.purchaseStatus !== existing.purchase_status) {
      patch.purchase_status = body.purchaseStatus;
      purchaseStatusChanged = true;
    }
    let deliveryStatusChanged = false;
    if (VALID_DELIVERY_STATUS.includes(body.deliveryStatus) && body.deliveryStatus !== existing.delivery_status) {
      patch.delivery_status = body.deliveryStatus;
      deliveryStatusChanged = true;
    }

    const updated = await tmsProcurementStore.update(id, patch);

    if (purchaseStatusChanged || deliveryStatusChanged) {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'tms_procurement',
        entityId: id,
        action: 'Procurement status updated',
        previousStatus: `${existing.purchase_status}/${existing.delivery_status}`,
        newStatus: `${updated?.purchase_status}/${updated?.delivery_status}`,
        remarks: existing.item_name,
        ip: getClientIp(request)
      });
    }

    if (deliveryStatusChanged && body.deliveryStatus === 'received') {
      const [project, bomRequest] = await Promise.all([
        tmsProjectStore.findById(existing.project_id),
        existing.bom_request_id ? tmsBomRequestStore.findById(existing.bom_request_id) : Promise.resolve(undefined)
      ]);
      const projectManager = project?.project_manager_id ? await findUserById(project.project_manager_id) : undefined;
      const usernames = Array.from(new Set([projectManager?.username, bomRequest?.created_by].filter((u): u is string => !!u)));
      if (usernames.length) {
        await notifyUsers(usernames, {
          title: 'Procurement delivered',
          body: `"${existing.item_name}" for ${existing.project_name} has been received`,
          type: 'tms_procurement_received',
          entityType: 'tms_procurement',
          entityId: id
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = await requireTmsAction(viewer, 'tms-procurement', 'delete');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const ok = await tmsProcurementStore.remove(id, allowed);
    if (!ok) return NextResponse.json({ error: 'Procurement record not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
