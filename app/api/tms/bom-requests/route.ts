import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isBomFinanceStageEnabled, requireTmsAction } from '@/lib/tmsAccess';
import { tmsBomRequestStore, nextTmsBomRequestCode } from '@/lib/tmsBomRequestStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyBomStageOne } from '@/lib/tmsBomStageNotify';
import { TmsBomRequestRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const [records, financeStageEnabled] = await Promise.all([
      tmsBomRequestStore.list(viewer),
      isBomFinanceStageEnabled()
    ]);
    // Stamped on every row so the list can render the same "pending with"
    // line as the detail page — the Finance step only counts when somebody
    // is configured to take it. One config read, not one per row.
    return NextResponse.json(records.map((record) => ({ ...record, finance_stage_enabled: financeStageEnabled })));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-bom-requests', 'create'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
  if (!projectId || !itemName) return NextResponse.json({ error: 'Project and item name are required' }, { status: 400 });

  const project = await tmsProjectStore.findById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Submitted directly, or saved as a draft — `submit: true` (default) moves
  // straight to 'submitted' and notifies the requester's OWN department
  // manager — not every Technical Manager; see findBomStageOneApprovers — matching the
  // "Engineer Creates BOM Request → Technical Manager Reviews" flow; a
  // Technical Manager creating one for record-keeping can pass submit:false
  // to keep it editable as a draft first.
  const submitNow = body.submit !== false;
  const now = new Date().toISOString();
  const record: TmsBomRequestRecord = {
    id: `${Date.now()}`,
    bom_request_code: await nextTmsBomRequestCode(),
    created_at: now,
    created_by: viewer.username,
    project_id: projectId,
    project_name: project.name,
    requested_by_id: viewer.userId,
    requested_by_name: '',
    department_id: typeof body.departmentId === 'string' && body.departmentId.trim() ? body.departmentId.trim() : project.department_id,
    department_name: '',
    request_date: typeof body.requestDate === 'string' && body.requestDate ? body.requestDate : now.slice(0, 10),
    required_date: typeof body.requiredDate === 'string' ? body.requiredDate : '',
    item_name: itemName,
    item_description: typeof body.itemDescription === 'string' ? body.itemDescription.trim() : '',
    part_number: typeof body.partNumber === 'string' ? body.partNumber.trim() : '',
    quantity: typeof body.quantity === 'number' ? body.quantity : Number(body.quantity) || 1,
    specification: typeof body.specification === 'string' ? body.specification.trim() : '',
    preferred_brand: typeof body.preferredBrand === 'string' ? body.preferredBrand.trim() : '',
    estimated_cost: typeof body.estimatedCost === 'number' ? body.estimatedCost : Number(body.estimatedCost) || 0,
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
    attachments: [],
    status: submitNow ? 'submitted' : 'draft',
    rejection_reason: '',
    reviewed_by_id: '',
    reviewed_by_name: '',
    reviewed_at: '',
    admin_reviewed_by_id: '',
    admin_reviewed_by_name: '',
    admin_reviewed_at: '',
    finance_reviewed_by_id: '',
    finance_reviewed_by_name: '',
    finance_reviewed_at: '',
    payment_marked_by_id: '',
    payment_marked_by_name: '',
    payment_marked_at: '',
    payment_proof_attachments: [],
    received_by_id: '',
    received_by_name: '',
    received_at: '',
    updated_at: now
  };

  try {
    const created = await tmsBomRequestStore.create(record);

    if (submitNow) {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'tms_bom_request',
        entityId: created.id,
        action: 'BOM request submitted',
        previousStatus: '',
        newStatus: 'submitted',
        remarks: itemName,
        ip: getClientIp(request)
      });
      await notifyBomStageOne({
        requestId: created.id,
        itemName,
        projectName: project.name,
        departmentId: created.department_id,
        actorUsername: viewer.username
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
