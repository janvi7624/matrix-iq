import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
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

// A reviewer (Manager+ by default, or any role explicitly granted "approve"
// on this module in Role Management) needs to see every ticket, not just
// their own — unlike the plain own-vs-privileged split most other modules
// use, this also checks the module's "approve" capability directly so a
// narrower non-privileged "Marketing" role still sees the full queue.
async function canSeeAllRequests(viewer: { role: string; isPrivileged: boolean }): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  return isModuleActionAllowed(viewer, 'marketing-requests', 'approve');
}

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const seesAll = await canSeeAllRequests(viewer);
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

  const record: MarketingRequestRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
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
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
