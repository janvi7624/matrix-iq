import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { logLeadCall, LeadCallError } from '@/lib/leadCall';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// POST — record what came of the qualification call.
// { outcome: 'suitable' | 'not_suitable' | 'callback', remark, callbackAt }
// 'suitable' is the only outcome that creates a Sales project; see
// lib/leadCall.ts for the rules and who may call this.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const result = await logLeadCall(
      id,
      viewer,
      {
        outcome: body.outcome,
        remark: typeof body.remark === 'string' ? body.remark : '',
        callbackAt: typeof body.callbackAt === 'string' ? body.callbackAt : ''
      },
      getClientIp(request)
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof LeadCallError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
