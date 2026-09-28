import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { CALL_OUTCOME_LABEL, clientMasterStore } from '@/lib/clientMasterStore';
import { toCsv } from '@/lib/csv';
import { apiErrorResponse } from '@/lib/apiError';

// Mirrors app/api/leads/export.csv/route.ts's exact pattern. Columns match
// the Client Master spec exactly; no internal database ids are exported.
// "Type" was added when the directory started listing prospects (leads with
// no project) beside customers — without it the two are indistinguishable
// once the file leaves the app.
const HEADERS = ['Sr. No.', 'Type', 'Name', 'Company Name', 'Mobile Number', 'E-mail ID', 'Product Handlers', 'Projects', 'Whose Client', 'Remarks', 'By Default User ID'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('client-master', viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const clients = await clientMasterStore.list(viewer.username);
    const rows = clients.map((c, i) => {
      const primary = c.contacts[0];
      // A prospect has no project to count, so "0 Projects" would read as a
      // customer we've never sold to — say what it actually is instead, and
      // carry the call outcome in the Type cell rather than adding a column
      // that is empty for every customer row.
      const isProspect = c.type === 'prospect';
      const typeCell = isProspect
        ? `Prospect${c.callOutcome ? ` — ${CALL_OUTCOME_LABEL[c.callOutcome]}` : ''}`
        : 'Customer';
      return [
        i + 1,
        typeCell,
        primary?.clientName || '',
        c.displayName,
        primary?.phone || '',
        primary?.email || '',
        c.productHandlers.map((h) => `${h.product} — ${h.handledBy}`).join('; '),
        isProspect ? 'No project yet' : `${c.projectCount} Project${c.projectCount === 1 ? '' : 's'}`,
        c.owners.map((o) => o.name).join('; ') || 'Unassigned',
        c.remarks.join(' | '),
        c.owners.map((o) => o.username).join('; ')
      ];
    });
    const csv = toCsv(HEADERS, rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="client-master.csv"'
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
