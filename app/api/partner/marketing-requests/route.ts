import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { toPartnerVisibleMarketingRequest } from '@/lib/partnerMarketingVisibility';
import { listPartnerProjects } from '@/lib/partnerProjectStore';
import { getAppConfig } from '@/lib/appConfigStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import {
  MARKETING_PRODUCT_CATEGORIES,
  MarketingProductCategory,
  MarketingRequestPriority,
  MarketingRequestRecord,
  MarketingRequestType
} from '@/lib/types';

// Same vocabulary as the internal route (app/api/marketing-requests/route.ts).
// Duplicated rather than shared because the internal list is that route's
// local validation detail; if it ever becomes a shared constant, both should
// move to lib/marketingRequestHelpers.ts together.
const VALID_TYPES: MarketingRequestType[] = [
  'brochure_flyer', 'social_media', 'banner_standee', 'video_reel',
  'email_campaign', 'website_update', 'product_photography', 'event_collateral', 'other'
];
const VALID_PRIORITY: MarketingRequestPriority[] = ['low', 'medium', 'high', 'urgent'];

export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const records = await marketingRequestStore.listForPartner(viewer.partnerId);
    return NextResponse.json(records.map(toPartnerVisibleMarketingRequest));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const title = str(body.title);
  const description = str(body.description);
  if (!title || !description) {
    return NextResponse.json({ error: 'Title and description are required' }, { status: 400 });
  }

  // A partner may only attach one of THEIR OWN projects. Without this check a
  // partner could tie a request to any project id they guessed, and the
  // internal screen renders that project's name beside the request.
  let projectId = str(body.projectId);
  if (projectId) {
    const own = await listPartnerProjects(viewer.partnerId);
    if (!own.some((p) => p.id === projectId)) projectId = '';
  }

  const rawCategory = str(body.productCategory);
  const productCategory: MarketingProductCategory =
    rawCategory && (MARKETING_PRODUCT_CATEGORIES as readonly string[]).includes(rawCategory)
      ? (rawCategory as MarketingProductCategory)
      : ((rawCategory || 'Other') as MarketingProductCategory);

  const appConfig = await getAppConfig();

  // Built field by field from the allow-list — the body is never spread. A
  // partner must not be able to post status, assignment, or any workspace
  // field. partner_id comes from the SESSION, never the body.
  const record: MarketingRequestRecord = {
    id: `${Date.now()}`,
    created_at: new Date().toISOString(),
    created_by: viewer.username,
    partner_id: viewer.partnerId,
    assigned_to: appConfig.marketingOwnerUsername || '',
    assigned_to_id: appConfig.marketingOwnerId || '',
    technical_member_id: '',
    technical_member_username: '',
    technical_member_name: '',
    updated_at: new Date().toISOString(),
    project_id: projectId,
    title,
    product_category: productCategory,
    request_type: VALID_TYPES.includes(body.requestType) ? body.requestType : 'other',
    description,
    additional_info: str(body.additionalInfo),
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    needed_by_date: str(body.neededByDate),
    attachments: Array.isArray(body.attachments)
      ? body.attachments.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
      : [],
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
      action: 'Marketing request submitted from Partner Portal',
      previousStatus: '',
      newStatus: 'submitted',
      remarks: `${title} [Partner: ${viewer.partner.company_name}] [Category: ${productCategory}]`,
      ip: getClientIp(request)
    });

    // The Marketing Owner is the default routing target, exactly as for an
    // internal request. The partner's name is in the body so the queue reads
    // as partner work before it is even opened.
    if (appConfig.marketingOwnerUsername) {
      void notifyUsers([appConfig.marketingOwnerUsername], {
        title: 'New marketing request from a partner',
        body: `${viewer.partner.company_name}: ${title}`,
        type: 'marketing_request_created',
        entityType: 'marketing_request',
        entityId: created.id
      });
    }

    return NextResponse.json(toPartnerVisibleMarketingRequest(created), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
