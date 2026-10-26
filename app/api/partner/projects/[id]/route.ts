import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { findPartnerProject, PartnerSubmissionError, respondToInfoRequest, reviseSubmission } from '@/lib/partnerProjectStore';
import { findPartnerById } from '@/lib/partnerStore';
import { notifyUsers } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    // Scoped by partnerId inside the query, so another partner's project is
    // indistinguishable from one that does not exist. 404, never 403 — a 403
    // would confirm the id is real, which is itself a disclosure.
    const project = await findPartnerProject(viewer.partnerId, id);
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(project);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Tell the internal side that the partner has come back.
 *
 * Addressed to the reviewer who actually asked, falling back to the
 * relationship manager — without this the submission silently re-enters the
 * queue and the person waiting on it has no idea. Fire-and-forget, matching
 * every other notifyUsers call site.
 */
async function notifyReviewer(projectId: string, partnerId: string, headline: string, body: string) {
  const project = await db.Project.findByPk(projectId, { attributes: ['partner_reviewed_by'] });
  const reviewerId = project?.get('partner_reviewed_by') as string | null;

  let username: string | undefined;
  if (reviewerId) {
    const reviewer = await db.User.findByPk(reviewerId, { attributes: ['username'] });
    username = reviewer?.get('username') as string | undefined;
  }
  if (!username) {
    const partner = await findPartnerById(partnerId);
    if (partner?.relationship_manager_id) {
      const rm = await db.User.findByPk(partner.relationship_manager_id, { attributes: ['username'] });
      username = rm?.get('username') as string | undefined;
    }
  }
  if (!username) return;

  void notifyUsers([username], {
    title: headline,
    body,
    type: 'partner_submission_revised',
    entityType: 'project',
    entityId: projectId
  });
}

// The partner replying to an information request WITHOUT changing anything —
// answering a question that needed no edit. See PATCH below for a revision.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message : '';

  try {
    const { id } = await params;
    const ok = await respondToInfoRequest(viewer.partnerId, id, message, viewer.username);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await notifyReviewer(id, viewer.partnerId, 'Partner replied to your request', `${viewer.partner.company_name}: ${message.slice(0, 140)}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PartnerSubmissionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}

/**
 * The partner EDITING their submission after Sales asked for changes.
 *
 * Open only while the submission sits at 'info_requested' — the store
 * enforces that, not this route. Once accepted the project belongs to the
 * sales pipeline and nothing external may rewrite it.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  // undefined, not '': an absent key means "leave this field alone". The
  // create path can collapse the two because a new project has nothing to
  // lose; a revision does.
  const str = (v: unknown) => (v === undefined ? undefined : typeof v === 'string' ? v.trim() : '');
  const num = (v: unknown): number | '' | undefined => {
    if (v === undefined) return undefined;
    if (v === '' || v === null) return '';
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : '';
  };
  const list = (v: unknown) =>
    v === undefined ? undefined : Array.isArray(v) ? v.filter((x: unknown): x is string => typeof x === 'string') : [];

  try {
    const { id } = await params;

    // Read one by one off the body, exactly as the create path does — the
    // request is never spread, so a partner cannot smuggle sales_person,
    // stage, status, approx_price or partner_submission_status through a
    // revision any more than through a submission.
    const result = await reviseSubmission(
      viewer.partnerId,
      id,
      {
        project_name: str(body.project_name),
        client_name: str(body.client_name),
        company: str(body.company),
        contact_person: str(body.contact_person),
        alt_contact_phone: str(body.alt_contact_phone),
        phone: str(body.phone),
        email: str(body.email),
        address: str(body.address),
        city: str(body.city),
        state: str(body.state),
        opportunity_type: str(body.opportunity_type),
        departments: list(body.departments),
        priority: str(body.priority),
        expected_closing_date: str(body.expected_closing_date),
        remarks: str(body.remarks),
        partner_submitted_value: num(body.partner_submitted_value),
        partner_expected_timeline: str(body.partner_expected_timeline),
        attachments: list(body.attachments)
      },
      str(body.message) ?? '',
      viewer.username
    );
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const count = result.changes.length;
    await notifyReviewer(
      id,
      viewer.partnerId,
      'Partner updated their submission',
      `${viewer.partner.company_name} changed ${count === 1 ? '1 field' : `${count} fields`} and sent it back for review.`
    );
    return NextResponse.json({ ok: true, changes: result.changes });
  } catch (error) {
    if (error instanceof PartnerSubmissionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
