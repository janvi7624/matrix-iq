import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { negotiationStore } from '@/lib/negotiationStore';
import { appendProjectTimeline, findProjectById } from '@/lib/projectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { NegotiationRecord } from '@/lib/types';

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await negotiationStore.list(viewer.username, viewer.isPrivileged);
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
  const discussionDate = typeof body.discussionDate === 'string' ? body.discussionDate : '';
  if (!projectId || !discussionDate) {
    return NextResponse.json({ error: 'Project and discussion date are required' }, { status: 400 });
  }

  const project = await findProjectById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!viewer.isPrivileged && project.created_by !== viewer.username) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const record: NegotiationRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    project_id: projectId,
    discussion_date: discussionDate,
    person: typeof body.person === 'string' && body.person.trim() ? body.person.trim() : viewer.username,
    discussion: typeof body.discussion === 'string' ? body.discussion.trim() : '',
    offer_given: typeof body.offerGiven === 'string' ? body.offerGiven.trim() : '',
    discount: typeof body.discount === 'string' ? body.discount.trim() : '',
    revised_price: Number(body.revisedPrice) || 0,
    expected_closure: typeof body.expectedClosure === 'string' ? body.expectedClosure : ''
  };

  try {
    const created = await negotiationStore.create(record);
    await appendProjectTimeline(
      projectId,
      { by: viewer.username, stage: 'negotiation', label: 'Negotiation discussion logged', remarks: record.discussion },
      'negotiation'
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
