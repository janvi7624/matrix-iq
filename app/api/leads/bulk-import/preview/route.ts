import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { previewBulkLeads, BulkLeadRow } from '@/lib/leadStore';
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

// Preview-only — validates + classifies every row (valid/duplicate/invalid)
// against the DB and against the rest of the batch, writes nothing. Same
// dry-run shape as /api/admin/users/import/preview.
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

  try {
    const rows = (body.rows as unknown[]).map(toRow);
    const results = await previewBulkLeads(rows);
    const summary = {
      total: results.length,
      valid: results.filter((r) => r.status === 'valid').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      invalid: results.filter((r) => r.status === 'invalid').length
    };
    return NextResponse.json({ summary, results });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
