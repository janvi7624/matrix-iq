import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { decideTechnicalRequest, TechnicalRequestError } from '@/lib/projectTechnicalRequest';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// POST — approve or decline a technical-person request. Only the requested
// engineer, their department manager, or an admin may answer (checked in
// decideTechnicalRequest); a manager/admin approving may pass assignUserId to
// send someone else from that team. Declining requires remarks.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== 'approve' && decision !== 'decline') return NextResponse.json({ error: 'decision must be approve or decline' }, { status: 400 });
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  if (!requestId) return NextResponse.json({ error: 'Missing requestId' }, { status: 400 });

  try {
    const project = await decideTechnicalRequest(
      id,
      requestId,
      viewer,
      {
        decision,
        remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
        assignUserId: typeof body.assignUserId === 'string' ? body.assignUserId.trim() : ''
      },
      getClientIp(request)
    );
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    if (error instanceof TechnicalRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
