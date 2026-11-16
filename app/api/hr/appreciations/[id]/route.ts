import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { getClientIp } from '@/lib/requestIp';
import { logAudit } from '@/lib/auditLogStore';
import { AppreciationsUnavailableError, deleteAppreciation, findAppreciation, updateAppreciation, validateTaskFields } from '@/lib/appreciationStore';

// The nominating manager's own edit/delete — ONLY while their submission is
// still 'pending'. Once HR has approved or rejected it, it's locked: an
// approved appreciation is already announced on the dashboard/profile, and a
// rejected one is HR's decision on record, so neither should be rewritable
// out from under that. Both store functions re-check ownership+pending in
// their SQL WHERE clause, not just here, so this stays correct even if a
// request raced a decision landing in between.

function unavailable(error: unknown) {
  return error instanceof AppreciationsUnavailableError
    ? NextResponse.json({ error: error.message }, { status: 503 })
    : null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const validated = validateTaskFields(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  try {
    const existing = await findAppreciation(id);
    if (!existing) return NextResponse.json({ error: 'Appreciation not found' }, { status: 404 });
    if (existing.nominated_by !== viewer.userId) return NextResponse.json({ error: 'You can only edit an appreciation you submitted' }, { status: 403 });
    if (existing.status !== 'pending') return NextResponse.json({ error: 'This has already been decided by HR and can no longer be edited' }, { status: 409 });

    const updated = await updateAppreciation(id, viewer.userId, validated.value);
    if (!updated) return NextResponse.json({ error: 'This has already been decided by HR and can no longer be edited' }, { status: 409 });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'employee_appreciation', entityId: id,
      action: 'appreciation_edit', previousStatus: 'pending', newStatus: 'pending',
      remarks: `${updated.employee_name} — edited by nominator`, ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  try {
    const existing = await findAppreciation(id);
    if (!existing) return NextResponse.json({ error: 'Appreciation not found' }, { status: 404 });
    if (existing.nominated_by !== viewer.userId) return NextResponse.json({ error: 'You can only delete an appreciation you submitted' }, { status: 403 });
    if (existing.status !== 'pending') return NextResponse.json({ error: 'This has already been decided by HR and can no longer be deleted' }, { status: 409 });

    const removed = await deleteAppreciation(id, viewer.userId);
    if (!removed) return NextResponse.json({ error: 'This has already been decided by HR and can no longer be deleted' }, { status: 409 });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'employee_appreciation', entityId: id,
      action: 'appreciation_delete', previousStatus: 'pending', newStatus: '',
      remarks: `${existing.employee_name} — deleted by nominator`, ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return unavailable(error) ?? apiErrorResponse(error);
  }
}
