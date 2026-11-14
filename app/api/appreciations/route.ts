import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { AppreciationsUnavailableError, listApprovedAppreciations } from '@/lib/appreciationStore';

// APPROVED appreciations only — public within the company by design.
//   GET /api/appreciations          recent ones (dashboard wall)
//   GET /api/appreciations?mine=1   the caller's own (profile)
// Reward details are stripped: they are between the employee, the manager
// and HR, not for the company wall.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (viewer.partnerId) return NextResponse.json([]);

  const mine = request.nextUrl.searchParams.get('mine') === '1';
  try {
    const rows = await listApprovedAppreciations(mine ? { employeeId: viewer.userId, limit: 100 } : { limit: 12 });
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        employee_name: r.employee_name,
        employee_department: r.employee_department,
        employee_designation: r.employee_designation,
        nominated_by_name: r.nominated_by_name,
        category: r.category,
        achievement_date: r.achievement_date,
        description: r.description,
        decided_at: r.decided_at,
        ...(mine ? { reward_type: r.reward_type, reward_amount: r.reward_amount } : {})
      }))
    );
  } catch (error) {
    // Before the migration runs, the wall is simply empty rather than an error
    // on every dashboard load.
    if (error instanceof AppreciationsUnavailableError) return NextResponse.json([]);
    return apiErrorResponse(error);
  }
}
