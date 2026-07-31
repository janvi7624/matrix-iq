import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { computeEffectiveStatus, searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Dashboard quotation stat cards — admin/manager/superadmin see org-wide
// counts, everyone else sees only their own quotations' counts.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await searchQuotationsFiltered(viewer.isPrivileged ? {} : { ownerUsername: viewer.username });
    const counts = { total: rows.length, draft: 0, sent: 0, approved: 0, rejected: 0, expired: 0 };
    for (const r of rows) {
      const status = computeEffectiveStatus(r);
      if (status === 'draft') counts.draft++;
      else if (status === 'sent') counts.sent++;
      else if (status === 'approved') counts.approved++;
      else if (status === 'rejected') counts.rejected++;
      else if (status === 'expired') counts.expired++;
    }
    return NextResponse.json(counts);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
