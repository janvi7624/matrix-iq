import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { findUsersByUsernames } from '@/lib/userStore';
import { getAppConfig } from '@/lib/appConfigStore';
import { MarketingRequestPriority } from '@/lib/types';

const VALID_PRIORITY: MarketingRequestPriority[] = ['low', 'medium', 'high', 'urgent'];

// Priority is create-only otherwise — this is the only place it can change
// after a ticket exists.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowed = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'edit'));
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only a marketing reviewer can change priority' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const priority = body?.priority as MarketingRequestPriority | undefined;
  if (!priority || !VALID_PRIORITY.includes(priority)) {
    return NextResponse.json({ error: 'A valid priority is required' }, { status: 400 });
  }

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });
    if (existing.priority === priority) return NextResponse.json(existing);

    const updated = await marketingRequestStore.update(id, { priority, updated_at: new Date().toISOString() });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: `Priority changed: ${existing.priority} -> ${priority}`,
      previousStatus: existing.status,
      newStatus: existing.status,
      remarks: '',
      ip: getClientIp(request)
    });

    if (priority === 'high' || priority === 'urgent') {
      const appConfig = await getAppConfig();
      const targets = Array.from(new Set([existing.assigned_to, appConfig.marketingOwnerUsername].filter((u) => u && u !== viewer.username)));
      if (targets.length) {
        await notifyUsers(targets, {
          title: `Marketing request priority: ${priority.toUpperCase()}`,
          body: `"${existing.title}" was raised to ${priority} priority by ${viewer.username}.`,
          type: 'marketing_request_priority_changed',
          entityType: 'marketing_request',
          entityId: id
        });
        const recipients = await findUsersByUsernames(targets);
        recipients.forEach((recipient) => {
          if (recipient.email) {
            void sendMarketingRequestLifecycleEmail({
              name: recipient.name,
              email: recipient.email,
              event: 'priority_changed',
              title: existing.title,
              detail: `Priority: ${priority.toUpperCase()} — raised by ${viewer.username}`
            });
          }
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
