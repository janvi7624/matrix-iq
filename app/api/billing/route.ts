import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { getBilling } from '@/lib/billingStore';
import { apiErrorResponse } from '@/lib/apiError';

// Won deals and the agreed work behind them.
//
// No role gate beyond "logged in": what a person sees is decided by
// resolveVisibilityScope inside getBilling, which gives a salesperson their
// own deals and a manager their team's. A role check here would be the wrong
// control — it would either lock salespeople out of their own figures or hand
// everyone the whole company's.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const report = await getBilling(viewer.username, {
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      owner: params.get('owner') || undefined,
      query: params.get('q') || undefined
    });
    return NextResponse.json(report);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
