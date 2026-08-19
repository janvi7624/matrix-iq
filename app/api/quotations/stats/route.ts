import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { computeEffectiveStatus, searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';

// Dashboard quotation stat cards — org-wide counts for Admin/Super Admin (or
// any role granted viewAllDepartments), department-scoped for a department
// manager, own-only otherwise. See lib/departmentScope.ts.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await searchQuotationsFiltered({ viewerUsername: viewer.username });
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
