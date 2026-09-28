import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { replaceMissingBill } from '@/lib/missingBills';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Puts a freshly uploaded file in place of ONE bill on the caller's own claim
// whose original file was lost with the old storage. Deliberately separate from
// PUT /api/reimbursement/[id]: that one edits a claim (and is locked once it's
// approved); this can only swap a bill that is genuinely missing, changes
// nothing else, and only for the claim's owner. See lib/missingBills.ts.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const oldUrl = typeof body?.oldUrl === 'string' ? body.oldUrl : '';
  const newUrl = typeof body?.newUrl === 'string' ? body.newUrl : '';
  if (!oldUrl || !newUrl) return NextResponse.json({ error: 'oldUrl and newUrl are required' }, { status: 400 });

  try {
    const result = await replaceMissingBill({ claimId: id, username: viewer.username, oldUrl, newUrl });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'reimbursement',
      entityId: id,
      action: 'Re-uploaded a missing bill',
      previousStatus: '',
      newStatus: '',
      ip: getClientIp(request)
    });
    return NextResponse.json({ ok: true, attachmentUrls: result.attachmentUrls });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
