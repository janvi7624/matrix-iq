import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { customerResponseStore } from '@/lib/customerResponseStore';
import { appendProjectTimeline } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { CustomerResponseRecord, CustomerResponseType } from '@/lib/types';

const VALID_TYPES: (CustomerResponseType | '')[] = ['', 'interested', 'not_interested', 'need_revision', 'need_new_quotation', 'budget_issue', 'competitor'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await customerResponseStore.list(viewer.username, viewer.isPrivileged);
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
  if (!projectId) return NextResponse.json({ error: 'Project is required' }, { status: 400 });

  const responseType: CustomerResponseType | '' = VALID_TYPES.includes(body.responseType) ? body.responseType : '';

  const record: CustomerResponseRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    demo_id: typeof body.demoId === 'string' ? body.demoId.trim() : '',
    feedback: typeof body.feedback === 'string' ? body.feedback.trim() : '',
    response_type: responseType,
    expected_decision_date: typeof body.expectedDecisionDate === 'string' ? body.expectedDecisionDate : '',
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : ''
  };

  try {
    const created = await customerResponseStore.create(record);
    await appendProjectTimeline(
      projectId,
      { by: viewer.username, stage: 'customer_response', label: `Customer response logged${responseType ? `: ${responseType.replace(/_/g, ' ')}` : ''}`, remarks: record.remarks },
      'customer_response'
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
