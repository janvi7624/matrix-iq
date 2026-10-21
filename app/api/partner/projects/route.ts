import { NextRequest, NextResponse } from 'next/server';
import { getPartnerViewer } from '@/lib/partnerContext';
import { listPartnerProjects, PartnerSubmissionError, submitPartnerProject } from '@/lib/partnerProjectStore';
import { findPartnerById } from '@/lib/partnerStore';
import { notifyUsers } from '@/lib/notificationStore';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const viewer = await getPartnerViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json(await listPartnerProjects(viewer.partnerId));
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
  const num = (v: unknown): number | '' => {
    if (v === '' || v === undefined || v === null) return '';
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : '';
  };

  try {
    // Fields are read one by one off the body — the request object is never
    // spread into the create. That is what stops a partner from posting
    // sales_person, assigned_technical_person_id, project_lead_id, stage,
    // status, approx_price, partner_submission_status or partner_id and
    // having it stick. See PARTNER_SUBMITTABLE_FIELDS and
    // PARTNER_WITHHELD_PROJECT_FIELDS in lib/partnerVisibility.ts, which the
    // test suite asserts against.
    const project = await submitPartnerProject(
      viewer.partnerId,
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
        departments: Array.isArray(body.departments) ? body.departments.filter((d: unknown): d is string => typeof d === 'string') : [],
        priority: str(body.priority),
        expected_closing_date: str(body.expected_closing_date),
        remarks: str(body.remarks),
        partner_submitted_value: num(body.partner_submitted_value),
        partner_expected_timeline: str(body.partner_expected_timeline),
        attachments: Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : []
      },
      viewer.username
    );

    // Tell the relationship manager something is waiting. Fire-and-forget,
    // matching every other notifyUsers call site — a notification failure
    // must never fail the submission the partner just made.
    const partner = await findPartnerById(viewer.partnerId);
    if (partner?.relationship_manager_id) {
      const rm = await db.User.findByPk(partner.relationship_manager_id, { attributes: ['username'] });
      const username = rm?.get('username') as string | undefined;
      if (username) {
        void notifyUsers([username], {
          title: 'New partner submission',
          body: `${partner.company_name} submitted "${project.project_name || project.company || project.client_name}" for review.`,
          type: 'partner_submission',
          entityType: 'project',
          entityId: project.id
        });
      }
    }

    return NextResponse.json({ id: project.id }, { status: 201 });
  } catch (error) {
    if (error instanceof PartnerSubmissionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
