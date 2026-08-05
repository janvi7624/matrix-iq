import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { MarketingRequestRecord } from '@/lib/types';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

// Advances a ticket forward once its timeline is committed —
// timeline_set -> in_progress -> completed. Never touches `timeline` itself.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowed = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only a marketing reviewer can update this request’s status' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== 'start' && action !== 'complete') {
    return NextResponse.json({ error: 'A valid action (start or complete) is required' }, { status: 400 });
  }

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    let patch: Partial<MarketingRequestRecord>;
    let newStatus: string;

    if (action === 'start') {
      if (existing.status !== 'timeline_set') {
        return NextResponse.json({ error: 'This request must have a committed timeline before work can start' }, { status: 400 });
      }
      newStatus = 'in_progress';
      patch = { status: 'in_progress', updated_at: new Date().toISOString() };
    } else {
      if (existing.status !== 'in_progress') {
        return NextResponse.json({ error: 'Only a request that is in progress can be marked completed' }, { status: 400 });
      }
      const completionNotes = typeof body?.completionNotes === 'string' ? body.completionNotes.trim() : '';
      newStatus = 'completed';
      patch = {
        status: 'completed',
        completion_notes: completionNotes,
        delivered_files: toStringArray(body?.deliveredFiles),
        updated_at: new Date().toISOString()
      };
    }

    const updated = await marketingRequestStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: action === 'start' ? 'Marketing request marked in progress' : 'Marketing request marked completed',
      previousStatus: existing.status,
      newStatus,
      remarks: '',
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
