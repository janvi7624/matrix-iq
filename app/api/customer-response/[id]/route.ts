import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { customerResponseStore } from '@/lib/customerResponseStore';
import { apiErrorResponse } from '@/lib/apiError';
import { CustomerResponseRecord, CustomerResponseType } from '@/lib/types';

const VALID_TYPES: (CustomerResponseType | '')[] = ['', 'interested', 'not_interested', 'need_revision', 'need_new_quotation', 'budget_issue', 'competitor'];

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const patch: Partial<CustomerResponseRecord> = {};
  if (typeof body.feedback === 'string') patch.feedback = body.feedback.trim();
  if (VALID_TYPES.includes(body.responseType)) patch.response_type = body.responseType;
  if (typeof body.expectedDecisionDate === 'string') patch.expected_decision_date = body.expectedDecisionDate;
  if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();

  try {
    const records = await customerResponseStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Response not found' }, { status: 404 });
    if (!viewer.isPrivileged && existing.created_by !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updated = await customerResponseStore.update(id, patch);
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const deleted = await customerResponseStore.remove(id, viewer.username, viewer.isPrivileged);
    if (!deleted) return NextResponse.json({ error: 'Response not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
