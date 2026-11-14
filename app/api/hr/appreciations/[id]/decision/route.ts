import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { apiErrorResponse } from '@/lib/apiError';
import { getClientIp } from '@/lib/requestIp';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { findUserById } from '@/lib/userStore';
import { sendEmail } from '@/lib/email/emailService';
import { isAppreciationDecider } from '@/lib/appreciationAccess';
import { AppreciationsUnavailableError, decideAppreciation, findAppreciation } from '@/lib/appreciationStore';

// HR Manager (or admin / superadmin) approves or rejects a pending appreciation.
// Approve → the employee is told (in-app + email) and it appears on the
// dashboard and their profile. Either way the nominating manager is told.

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const decision = body?.decision;
  const remarks = typeof body?.remarks === 'string' ? body.remarks.trim().slice(0, 2000) : '';
  if (decision !== 'approved' && decision !== 'rejected') return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  if (decision === 'rejected' && !remarks) return NextResponse.json({ error: 'Add a remark explaining the rejection' }, { status: 400 });

  try {
    if (!(await isAppreciationDecider(viewer))) {
      return NextResponse.json({ error: 'Only the HR Manager can approve or reject appreciations' }, { status: 403 });
    }
    const existing = await findAppreciation(id);
    if (!existing) return NextResponse.json({ error: 'Appreciation not found' }, { status: 404 });
    if (existing.status !== 'pending') return NextResponse.json({ error: 'This appreciation has already been decided' }, { status: 409 });
    if (existing.nominated_by === viewer.userId && viewer.role !== 'superadmin') {
      return NextResponse.json({ error: 'You cannot decide an appreciation you submitted yourself' }, { status: 403 });
    }

    const me = await findUserById(viewer.userId);
    const updated = await decideAppreciation(id, decision, { id: viewer.userId, name: me?.name || viewer.username }, remarks);
    if (!updated) return NextResponse.json({ error: 'This appreciation was just decided by someone else — refresh' }, { status: 409 });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'employee_appreciation', entityId: id,
      action: decision === 'approved' ? 'appreciation_approve' : 'appreciation_reject',
      previousStatus: 'pending', newStatus: decision, remarks, ip: getClientIp(request)
    });

    const [nominator, employee] = await Promise.all([
      updated.nominated_by ? findUserById(updated.nominated_by) : Promise.resolve(undefined),
      findUserById(updated.employee_id)
    ]);

    if (nominator && nominator.username !== viewer.username) {
      await notifyUsers([nominator.username], {
        title: decision === 'approved' ? 'Appreciation approved' : 'Appreciation not approved',
        body: `Your appreciation for ${updated.employee_name} was ${decision} by HR${remarks ? ': ' + remarks : '.'}`,
        type: 'appreciation_decided',
        entityType: 'employee_appreciation',
        entityId: id
      });
    }

    if (decision === 'approved' && employee) {
      await notifyUsers([employee.username], {
        title: '🎉 You have been appreciated!',
        body: `${updated.nominated_by_name} appreciated you for ${updated.category}.`,
        type: 'appreciation_received',
        entityType: 'employee_appreciation_received',
        entityId: id
      });
      if (employee.email) {
        // Fire-and-forget: a mail failure must not undo an approval already saved.
        sendEmail({
          to: employee.email,
          subject: `You have been appreciated — ${updated.category}`,
          html: `<p>Dear ${escapeHtml(employee.name || employee.username)},</p>
<p>Congratulations! <strong>${escapeHtml(updated.nominated_by_name)}</strong> has appreciated you for
<strong>${escapeHtml(updated.category)}</strong>.</p>
<blockquote style="border-left:3px solid #dc2626;margin:12px 0;padding:4px 12px;color:#334155">${escapeHtml(updated.description).replace(/\n/g, '<br>')}</blockquote>
<p>Keep up the great work!</p><p>— HR Team</p>`,
          text: `Congratulations! ${updated.nominated_by_name} has appreciated you for ${updated.category}.\n\n${updated.description}\n\n— HR Team`
        }).catch((error) => console.error('[appreciation] email failed:', error instanceof Error ? error.message : error));
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof AppreciationsUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    return apiErrorResponse(error);
  }
}
