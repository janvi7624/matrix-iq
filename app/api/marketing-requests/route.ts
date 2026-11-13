import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager, isModuleActionAllowed } from '@/lib/permissions';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { getAppConfig } from '@/lib/appConfigStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { findUserByUsername } from '@/lib/userStore';
import { listMarketingRoster } from '@/lib/marketingRoster';
import { MARKETING_PRODUCT_CATEGORIES, MarketingProductCategory, MarketingRequestPriority, MarketingRequestRecord, MarketingRequestType } from '@/lib/types';

const VALID_TYPES: MarketingRequestType[] = [
  'brochure_flyer', 'social_media', 'banner_standee', 'video_reel',
  'email_campaign', 'website_update', 'product_photography', 'event_collateral', 'other'
];
const VALID_PRIORITY: MarketingRequestPriority[] = ['low', 'medium', 'high', 'urgent'];

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

async function canSeeAllRequests(viewer: { role: string; isPrivileged: boolean }): Promise<boolean> {
  if (viewer.isPrivileged) return true;
  return isModuleActionAllowed(viewer, 'marketing-requests', 'approve');
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

  const rawProductCategory = typeof body.productCategory === 'string' ? body.productCategory.trim() : '';
  const productCategory: MarketingProductCategory =
    rawProductCategory && (MARKETING_PRODUCT_CATEGORIES as readonly string[]).includes(rawProductCategory)
      ? rawProductCategory
      : rawProductCategory || 'Other';

  const additionalInfo = typeof body.additionalInfo === 'string' ? body.additionalInfo.trim() : '';

  // New tickets default-route to the configured Marketing Owner
  const appConfig = await getAppConfig();

  const record: MarketingRequestRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    assigned_to: appConfig.marketingOwnerUsername || '',
    assigned_to_id: appConfig.marketingOwnerId || '',
    technical_member_id: '',
    technical_member_username: '',
    technical_member_name: '',
    updated_at: new Date().toISOString(),
    project_id: typeof body.projectId === 'string' ? body.projectId.trim() : '',
    title,
    product_category: productCategory,
    request_type: VALID_TYPES.includes(body.requestType) ? body.requestType : 'other',
    description,
    additional_info: additionalInfo,
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    needed_by_date: typeof body.neededByDate === 'string' ? body.neededByDate : '',
    attachments: toStringArray(body.attachments),
    status: 'submitted',
    marketing_prepared_content: '',
    marketing_attachments: [],
    marketing_remarks: '',
    technical_instructions: '',
    technical_review_decision: '',
    technical_remarks: '',
    technical_reviewed_at: '',
    technical_reviewed_by: '',
    final_submission_notes: '',
    final_submission_files: [],
    timeline: null,
    rejection_reason: '',
    completion_notes: '',
    delivered_files: [],
    assignment_status: appConfig.marketingOwnerUsername ? 'pending' : '',
    assignment_decline_reason: '',
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
      remarks: `${title} [Category: ${productCategory}]`,
      ip: getClientIp(request)
    });

    if (created.assigned_to && created.assigned_to !== viewer.username) {
      // An explicit Marketing Owner is still honoured when configured —
      // single-owner notification, same as before.
      await notifyUsers([created.assigned_to], {
        title: 'New marketing request',
        body: `${viewer.username} submitted "${title}" (${productCategory})`,
        type: 'marketing_request_created',
        entityType: 'marketing_request',
        entityId: created.id
      });
      const owner = await findUserByUsername(created.assigned_to);
      if (owner?.email) {
        void sendMarketingRequestLifecycleEmail({
          name: owner.name,
          email: owner.email,
          event: 'created',
          title,
          detail: `Submitted by ${viewer.username} (${productCategory})`
        });
      }
    } else {
      // No single owner configured — every new request goes out to the
      // WHOLE Marketing team at once (e.g. both Divya and Shivam), so
      // whoever's free picks it up first instead of waiting for a manual
      // assignment. They can hand it to each other afterward (see
      // /api/marketing-requests/[id]/exchange).
      const roster = await listMarketingRoster();
      const targets = roster.filter((m) => m.username.toLowerCase() !== viewer.username.toLowerCase());
      if (targets.length) {
        await notifyUsers(targets.map((m) => m.username), {
          title: 'New marketing request',
          body: `${viewer.username} submitted "${title}" (${productCategory}) — first to claim it owns it.`,
          type: 'marketing_request_created',
          entityType: 'marketing_request',
          entityId: created.id
        });
        for (const member of targets) {
          const fullUser = await findUserByUsername(member.username);
          if (fullUser?.email) {
            void sendMarketingRequestLifecycleEmail({
              name: fullUser.name,
              email: fullUser.email,
              event: 'created',
              title,
              detail: `Submitted by ${viewer.username} (${productCategory})`
            });
          }
        }
      }
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
