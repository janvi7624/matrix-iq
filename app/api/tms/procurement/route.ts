import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsProcurementStore, nextTmsProcurementCode } from '@/lib/tmsProcurementStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { tmsBomRequestStore } from '@/lib/tmsBomRequestStore';
import { apiErrorResponse } from '@/lib/apiError';
import { TmsProcurementRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-procurement', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const records = await tmsProcurementStore.list();
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Standalone manual entry, independent of the BOM approval chain — supports
// Procurement being able to create a request directly, not only via
// "send to procurement". bomRequestId is optional.
export async function POST(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-procurement', 'create'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const itemName = typeof body.itemName === 'string' ? body.itemName.trim() : '';
  if (!projectId || !itemName) return NextResponse.json({ error: 'Project and item name are required' }, { status: 400 });

  const project = await tmsProjectStore.findById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const bomRequestId = typeof body.bomRequestId === 'string' ? body.bomRequestId.trim() : '';
  if (bomRequestId && !(await tmsBomRequestStore.findById(bomRequestId))) {
    return NextResponse.json({ error: 'BOM request not found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const record: TmsProcurementRecord = {
    id: `${Date.now()}`,
    procurement_code: await nextTmsProcurementCode(),
    created_at: now,
    created_by: viewer.username,
    project_id: projectId,
    project_name: project.name,
    bom_request_id: bomRequestId,
    bom_request_code: '',
    item_name: itemName,
    part_number: typeof body.partNumber === 'string' ? body.partNumber.trim() : '',
    quantity: typeof body.quantity === 'number' ? body.quantity : Number(body.quantity) || 1,
    vendor: typeof body.vendor === 'string' ? body.vendor.trim() : '',
    estimated_cost: typeof body.estimatedCost === 'number' ? body.estimatedCost : Number(body.estimatedCost) || 0,
    quoted_cost: 0,
    final_cost: 0,
    request_date: typeof body.requestDate === 'string' && body.requestDate ? body.requestDate : now.slice(0, 10),
    required_date: typeof body.requiredDate === 'string' ? body.requiredDate : '',
    expected_delivery_date: '',
    actual_delivery_date: '',
    purchase_status: 'requested',
    delivery_status: 'pending',
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
    documents: [],
    updated_at: now
  };

  try {
    const created = await tmsProcurementStore.create(record);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
