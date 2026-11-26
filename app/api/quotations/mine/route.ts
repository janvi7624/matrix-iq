import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { searchQuotationsFiltered } from '@/lib/quotationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { getListParam } from '@/lib/listParam';
import { QuotationEffectiveStatus } from '@/lib/types';

const VALID_STATUSES: QuotationEffectiveStatus[] = ['draft', 'sent', 'approved', 'rejected', 'expired'];

// Every logged-in role can hit this.
// Privileged viewers (manager, admin, superadmin) see every quotation within
// their department scope by default (org-wide only for Admin/Super Admin —
// see lib/departmentScope.ts), or can filter further by a specific sales
// person. Non-privileged users (sales reps / user) strictly see only their
// own quotations.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  // Several statuses / sales people may be picked (repeated params); unknown
  // statuses are dropped, as a single unknown one always was.
  const statuses = getListParam(params, 'status').filter((s): s is QuotationEffectiveStatus => VALID_STATUSES.includes(s as QuotationEffectiveStatus));
  const salesPeople = getListParam(params, 'salesPerson');

  // A non-privileged viewer's own username always wins — the salesPerson
  // param is ignored for them, whatever it lists.
  const ownerUsername = viewer.isPrivileged ? (salesPeople.length ? salesPeople : undefined) : viewer.username;

  try {
    const rows = await searchQuotationsFiltered({
      ownerUsername,
      viewerUsername: viewer.username,
      query: params.get('q') || undefined,
      projectId: params.get('projectId') || undefined,
      status: statuses.length ? statuses : undefined,
      dateFrom: params.get('dateFrom') || undefined,
      dateTo: params.get('dateTo') || undefined
    });
    return NextResponse.json(rows);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
