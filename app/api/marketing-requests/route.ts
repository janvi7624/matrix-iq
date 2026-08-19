import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager } from '@/lib/permissions';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { MarketingRequestPriority, MarketingRequestRecord, MarketingRequestType } from '@/lib/types';

const VALID_TYPES: MarketingRequestType[] = [
  'brochure_flyer', 'social_media', 'banner_standee', 'video_reel',
  'email_campaign', 'website_update', 'product_photography', 'event_collateral', 'other'
];
const VALID_PRIORITY: MarketingRequestPriority[] = ['low', 'medium', 'high', 'urgent'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const seesAll = await isMarketingManager(viewer);
    const records = await marketingRequestStore.list(viewer.username, seesAll);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!title || !description) {
    return NextResponse.json({ error: 'Title and description are required' }, { status: 400 });
  }

  // New tickets start unassigned — a Marketing User must not receive an
  // official assignment before the Marketing Manager reviews and approves
  // the request (see the new /approve route). The Marketing department's
  // manager(s) are notified below instead of a single configured owner.
  const record: MarketingRequestRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    assigned_to: '',
    updated_at: new Date().toISOString(),
    project_id: typeof body.projectId === 'string' ? body.projectId.trim() : '',
    title,
    request_type: VALID_TYPES.includes(body.requestType) ? body.requestType : 'other',
    description,
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    needed_by_date: typeof body.neededByDate === 'string' ? body.neededByDate : '',
    attachments: toStringArray(body.attachments),
    status: 'submitted',
    timeline: null,
    rejection_reason: '',
    completion_notes: '',
    delivered_files: [],
    comments: []
  };

  try {
    const created = await marketingRequestStore.create(record);
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: created.id,
      action: 'Marketing request submitted',
      previousStatus: '',
      newStatus: 'submitted',
      remarks: title,
      ip: getClientIp(request)
    });
    const marketingManagers = (await listDepartmentManagers())['Marketing'] || [];
    const notifyTargets = marketingManagers.map((m) => m.username).filter((u) => u && u !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets, {
        title: 'New marketing request awaiting approval',
        body: `${viewer.username} submitted "${title}"`,
        type: 'marketing_request_created',
        entityType: 'marketing_request',
        entityId: created.id
      });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
