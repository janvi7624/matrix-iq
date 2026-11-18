import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { buildStaffFeedbackReport, managesMatrixIqProduct } from '@/lib/staffFeedbackReport';
import { apiErrorResponse } from '@/lib/apiError';

// Staff feedback on MatrixIQ, for the MatrixIQ product's Product Manager.
// Same payload as /api/admin/feedback; only the gate differs.
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    if (!(await managesMatrixIqProduct(session.sub))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json(await buildStaffFeedbackReport());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
