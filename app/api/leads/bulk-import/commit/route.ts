import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { commitBulkLeads, BulkLeadRow } from '@/lib/leadStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

function toRow(raw: unknown): BulkLeadRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    name: str(r.name),
    mobile: str(r.mobile),
    email: str(r.email),
    designation: str(r.designation),
    company: str(r.company),
    city: str(r.city),
    cardImageUrl: str(r.cardImageUrl),
    budget: str(r.budget),
    notes: str(r.notes)
  };
}

const VALID_IMPORT_TYPES = ['csv', 'images'];

// Actually creates/merges the rows the user approved on the review screen
// (the client only sends rows it wants imported — invalid/unwanted rows are
// simply left out, matching the spec's "Import Valid Records" action), then
// writes one summary audit row for the whole batch — same shape as
// lib/userImportStore.ts's bulk employee import, one row per commit rather
// than one per lead.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'rows[] is required' }, { status: 400 });
  }
  if (body.rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
  }
  if (body.rows.length > 500) {
    return NextResponse.json({ error: 'Import is limited to 500 rows at a time' }, { status: 400 });
  }
  const importType = VALID_IMPORT_TYPES.includes(body.importType) ? body.importType : 'csv';

  try {
    const rows = (body.rows as unknown[]).map(toRow);
    const summary = await commitBulkLeads(rows, viewer.username, importType === 'images' ? 'business_card' : 'csv_import');

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'bulk_lead_import',
      entityId: '',
      action: 'bulk_import',
      previousStatus: '',
      newStatus: '',
      remarks: JSON.stringify({ importType, total: rows.length, created: summary.created, merged: summary.merged, failed: summary.failed }),
      ip: getClientIp(request)
    });

    return NextResponse.json(summary);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
