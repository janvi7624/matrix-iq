import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore } from '@/lib/leadStore';
import { toCsv } from '@/lib/csv';
import { apiErrorResponse } from '@/lib/apiError';
import { leadOriginLabel } from '@/lib/leadSources';

// "Assigned To" sits next to "Captured By" rather than replacing it — who
// captured a lead and who owns working it are different facts, and a sales
// manager exporting the pipeline needs both.
// The call columns follow the assignment ones because that's the order the
// work happens in: captured -> assigned -> called -> suitable or not. The
// remark is the only record of WHY a contact was ruled out, so it exports
// with the rest rather than staying locked in the app.
const HEADERS = ['Source', 'Name', 'Company', 'Designation', 'Mobile', 'Email', 'City', 'Interests', 'Sub-Interests', 'Priority', 'Follow-Up', 'Budget', 'Notes', 'Assigned To', 'Assigned On', 'Call Outcome', 'Called On', 'Called By', 'Call Remark', 'Call Back On', 'Captured By', 'Date'];

// '' means nobody has called yet — spelled out, since an empty cell in a
// spreadsheet reads as missing data rather than as a state.
const CALL_OUTCOME_LABEL: Record<string, string> = {
  suitable: 'Suitable',
  not_suitable: 'Not suitable',
  callback: 'Call back later'
};

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const leads = await leadStore.list(viewer.username, viewer.isPrivileged);
    const rows = leads.map((l) => [
      leadOriginLabel(l.lead_source), l.name, l.company, l.designation, l.mobile, l.email, l.city,
      l.interests.join('; '), l.sub_interests.join('; '), l.priority, l.follow_up_actions.join('; '), l.budget, l.notes,
      l.assigned_to_name || l.assigned_to || 'Unassigned', l.assigned_at,
      CALL_OUTCOME_LABEL[l.call_outcome] || 'Not called', l.called_at, l.called_by_name, l.call_remark, l.callback_at,
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
