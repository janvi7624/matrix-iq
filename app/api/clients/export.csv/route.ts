import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { clientMasterStore } from '@/lib/clientMasterStore';
import { toCsv } from '@/lib/csv';
import { apiErrorResponse } from '@/lib/apiError';

// Mirrors app/api/leads/export.csv/route.ts's exact pattern. Columns match
// the Client Master spec exactly; no internal database ids are exported.
const HEADERS = ['Sr. No.', 'Name', 'Company Name', 'Mobile Number', 'E-mail ID', 'Product Handlers', 'Projects', 'Whose Client', 'Remarks', 'By Default User ID'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('client-master', viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const clients = await clientMasterStore.list();
    const rows = clients.map((c, i) => {
      const primary = c.contacts[0];
      return [
        i + 1,
        primary?.clientName || '',
        c.displayName,
        primary?.phone || '',
        primary?.email || '',
        c.productHandlers.map((h) => `${h.product} — ${h.handledBy}`).join('; '),
        `${c.projectCount} Project${c.projectCount === 1 ? '' : 's'}`,
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
