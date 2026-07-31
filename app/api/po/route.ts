import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { poStore } from '@/lib/poStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { PoRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await poStore.list(viewer.username, viewer.isPrivileged);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const poNumber = typeof body.poNumber === 'string' ? body.poNumber.trim() : '';
  if (!projectId || !poNumber) {
    return NextResponse.json({ error: 'Project and PO number are required' }, { status: 400 });
  }

  const record: PoRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    po_number: poNumber,
    po_date: typeof body.poDate === 'string' ? body.poDate : '',
    amount: Number(body.amount) || 0,
    attachment_url: typeof body.attachmentUrl === 'string' ? body.attachmentUrl : '',
    advance_received: Number(body.advanceReceived) || 0,
    payment_terms: typeof body.paymentTerms === 'string' ? body.paymentTerms.trim() : ''
  };

  try {
    const created = await poStore.create(record);
    await appendProjectTimeline(
      projectId,
      { by: viewer.username, stage: 'po_received', label: `PO received: ${poNumber}`, remarks: `Amount ${record.amount}` },
      'po_received'
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
