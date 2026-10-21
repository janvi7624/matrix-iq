import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { findPartnerProject, PartnerSubmissionError, respondToInfoRequest } from '@/lib/partnerProjectStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    // Scoped by partnerId inside the query, so another partner's project is
    // indistinguishable from one that does not exist. 404, never 403 — a 403
    // would confirm the id is real, which is itself a disclosure.
    const project = await findPartnerProject(viewer.partnerId, id);
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(project);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// The partner replying to an information request. The ONLY write a partner
// may make to a project — they cannot change stage, value, assignment, or
// anything else about it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message : '';

  try {
    const { id } = await params;
    const ok = await respondToInfoRequest(viewer.partnerId, id, message, viewer.username);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PartnerSubmissionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
