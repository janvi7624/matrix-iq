import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';

// The manager-approval gate itself — a request must pass through here
// (submitted -> approved) before it can be assigned to a Marketing person
// (see [id]/assign/route.ts's own guard) or have a delivery timeline set
// (see [id]/set-timeline/route.ts). Deliberately no date/timeline required
// here — that's a separate manager action, decoupled from the approval
// decision itself.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowed = await isMarketingManager(viewer);
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only the Marketing manager can approve this request' }, { status: 403 });

  const { id } = await params;

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'Only a request still awaiting review can be approved' }, { status: 400 });
    }

    const updated = await marketingRequestStore.update(id, { status: 'approved', updated_at: new Date().toISOString() });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: 'Marketing request approved',
      previousStatus: 'submitted',
      newStatus: 'approved',
      remarks: '',
      ip: getClientIp(request)
    });

    if (existing.created_by && existing.created_by !== viewer.username) {
      await notifyUsers([existing.created_by], {
        title: 'Marketing request approved',
        body: `"${existing.title}" was approved by ${viewer.username} and will be assigned shortly.`,
        type: 'marketing_request_approved',
        entityType: 'marketing_request',
        entityId: id
      });
      const requester = await findUserByUsername(existing.created_by);
      if (requester?.email) {
        void sendMarketingRequestLifecycleEmail({
          name: requester.name,
          email: requester.email,
          event: 'approved',
          title: existing.title
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
