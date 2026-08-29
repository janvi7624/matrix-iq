import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore } from '@/lib/leadStore';
import { toCsv } from '@/lib/csv';
import { apiErrorResponse } from '@/lib/apiError';

// "Assigned To" sits next to "Captured By" rather than replacing it — who
// captured a lead and who owns working it are different facts, and a sales
// manager exporting the pipeline needs both.
const HEADERS = ['Name', 'Company', 'Designation', 'Mobile', 'Email', 'City', 'Interests', 'Sub-Interests', 'Priority', 'Follow-Up', 'Budget', 'Notes', 'Assigned To', 'Assigned On', 'Captured By', 'Date'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const leads = await leadStore.list(viewer.username, viewer.isPrivileged);
    const rows = leads.map((l) => [
      l.name, l.company, l.designation, l.mobile, l.email, l.city,
      l.interests.join('; '), l.sub_interests.join('; '), l.priority, l.follow_up_actions.join('; '), l.budget, l.notes,
      l.assigned_to_name || l.assigned_to || 'Unassigned', l.assigned_at,
      l.created_by, l.created_at
    ]);
    const csv = toCsv(HEADERS, rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="leads.csv"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
